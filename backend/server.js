const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const exifParser = require('exif-parser');
require('dotenv').config();

const dbOps = require('./database');
const s3Ops = require('./s3');
const { generateThumbnail } = require('./thumbnail');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Access code from environment variable
const ACCESS_CODE = process.env.ACCESS_CODE || 'WINTER2025';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Run S3 preflight check on startup
(async () => {
  console.log('\n🔍 Running S3 preflight check...\n');
  await s3Ops.testConnection();
  console.log('\n');
})();

// ===== Helper Functions =====

/**
 * Extract EXIF date from image file
 * Returns ISO timestamp or null if not available
 */
async function extractExifDate(s3Url, fileType) {
  // Only process images, not videos
  if (fileType !== 'photo') {
    return null;
  }

  try {
    // Download first 64KB of file (EXIF data is in header)
    const response = await axios.get(s3Url, {
      responseType: 'arraybuffer',
      headers: {
        'Range': 'bytes=0-65535' // First 64KB should contain EXIF
      },
      timeout: 10000,
    });

    const buffer = Buffer.from(response.data);

    // Parse EXIF data
    const parser = exifParser.create(buffer);
    const result = parser.parse();

    // Try to get the date photo was taken
    // DateTimeOriginal is when the photo was taken
    // CreateDate is when the file was created
    // ModifyDate is when the file was modified
    const timestamp = result.tags?.DateTimeOriginal ||
                     result.tags?.CreateDate ||
                     result.tags?.ModifyDate;

    if (timestamp) {
      // EXIF timestamps are in seconds, convert to milliseconds
      const date = new Date(timestamp * 1000);
      console.log(`📅 EXIF date found: ${date.toISOString()}`);
      return date.toISOString();
    }

    console.log('⚠️  No EXIF date found in image');
    return null;
  } catch (error) {
    console.error('Error extracting EXIF date:', error.message);
    return null;
  }
}

// ===== API Routes =====

/**
 * POST /api/access
 * Verify access code
 */
app.post('/api/access', (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Access code is required' });
  }

  if (code === ACCESS_CODE) {
    return res.json({ success: true, message: 'Access granted' });
  } else {
    return res.status(401).json({ error: 'Invalid access code' });
  }
});

/**
 * POST /api/upload-url
 * Generate presigned S3 URL for upload
 */
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'Filename and content type are required' });
    }

    // Validate file type
    const fileType = s3Ops.validateFileType(contentType);

    // Generate presigned URL
    const { uploadUrl, s3Key, publicUrl } = await s3Ops.getPresignedUploadUrl(
      filename,
      contentType
    );

    res.json({
      uploadUrl,
      s3Key,
      publicUrl,
      fileType,
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate upload URL' });
  }
});

/**
 * POST /api/confirm
 * Confirm upload and save metadata to database
 */
app.post('/api/confirm', async (req, res) => {
  try {
    const { filename, s3Key, s3Url, fileType, uploadedBy, message } = req.body;

    if (!filename || !s3Key || !s3Url || !fileType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Extract EXIF date from the uploaded file
    const takenAt = await extractExifDate(s3Url, fileType);

    // Insert into database
    const result = await dbOps.insertUpload({
      filename,
      s3_key: s3Key,
      s3_url: s3Url,
      file_type: fileType,
      uploaded_by: uploadedBy,
      message: message,
      taken_at: takenAt,
    });

    const uploadId = result.lastInsertRowid;

    // Generate thumbnail asynchronously (don't block response)
    if (fileType === 'photo') {
      generateThumbnail(s3Url, s3Key)
        .then(async (thumbnailKey) => {
          if (thumbnailKey) {
            await dbOps.updateThumbnailKey(uploadId, thumbnailKey);
            console.log(`Thumbnail generated for upload ${uploadId}`);
          }
        })
        .catch((error) => {
          console.error(`Failed to generate thumbnail for upload ${uploadId}:`, error);
        });
    }

    res.json({
      success: true,
      uploadId: uploadId,
      message: 'Upload confirmed successfully',
    });
  } catch (error) {
    console.error('Error confirming upload:', error);
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
});

/**
 * GET /api/photos
 * Get all uploaded photos and videos with fresh presigned URLs
 */
app.get('/api/photos', async (req, res) => {
  try {
    const uploads = await dbOps.getAllUploads();

    // Generate fresh presigned URLs for each upload (full image and thumbnail)
    const uploadsWithFreshUrls = await Promise.all(
      uploads.map(async (upload) => {
        try {
          const freshUrl = await s3Ops.getPresignedDownloadUrl(upload.s3_key);

          // Generate thumbnail URL if thumbnail exists
          let thumbnailUrl = freshUrl; // Default to full image
          if (upload.thumbnail_key) {
            try {
              thumbnailUrl = await s3Ops.getPresignedDownloadUrl(upload.thumbnail_key);
            } catch (thumbError) {
              console.error(`Error generating thumbnail URL for ${upload.thumbnail_key}:`, thumbError);
              // Fall back to full image
            }
          }

          return {
            ...upload,
            s3_url: freshUrl, // Full image URL
            thumbnail_url: thumbnailUrl, // Thumbnail URL (or full image if no thumbnail)
          };
        } catch (error) {
          console.error(`Error generating URL for ${upload.s3_key}:`, error);
          return upload; // Return original if URL generation fails
        }
      })
    );

    res.json(uploadsWithFreshUrls);
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

/**
 * GET /api/stats
 * Get upload statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await dbOps.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// ===== Admin Routes =====

/**
 * POST /api/admin/login
 * Verify admin password
 */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, message: 'Admin access granted' });
  } else {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
});

/**
 * DELETE /api/admin/delete/:id
 * Delete a photo/video by ID
 */
app.delete('/api/admin/delete/:id', async (req, res) => {
  try {
    // Verify admin authorization
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer token

    if (!token || token !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const photoId = req.params.id;

    // Delete from database
    await dbOps.deleteUpload(photoId);

    res.json({
      success: true,
      message: 'Photo deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

/**
 * DELETE /api/admin/delete-all
 * Delete all photos/videos
 */
app.delete('/api/admin/delete-all', async (req, res) => {
  try {
    // Verify admin authorization
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer token

    if (!token || token !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Delete all uploads
    const deletedCount = await dbOps.deleteAllUploads();

    res.json({
      success: true,
      deletedCount: deletedCount,
      message: 'All photos deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting all photos:', error);
    res.status(500).json({ error: 'Failed to delete all photos' });
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   ❄️  Winter Wedding Photo App Server  ❄️    ║
╚═══════════════════════════════════════════════╝

🚀 Server running on port ${PORT}
🌐 Access at: http://localhost:${PORT}
🔒 Access code: ${ACCESS_CODE}

📊 API Endpoints:
   - POST /api/access       - Verify access code
   - POST /api/upload-url   - Get presigned S3 URL
   - POST /api/confirm      - Confirm upload
   - GET  /api/photos       - List all uploads
   - GET  /api/stats        - Upload statistics
   - GET  /api/health       - Health check
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
