const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const exifParser = require('exif-parser');
const nodemailer = require('nodemailer');
const archiver = require('archiver');
const fs = require('fs');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);
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
const REQUIRE_ACCESS_CODE = process.env.REQUIRE_ACCESS_CODE !== 'false';
const MAX_PHOTO_SELECTION = parseInt(process.env.MAX_PHOTO_SELECTION || '50', 10);

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
 * GET /api/config
 * Get public configuration settings
 */
app.get('/api/config', (req, res) => {
  res.json({
    requireAccessCode: REQUIRE_ACCESS_CODE,
    maxPhotoSelection: MAX_PHOTO_SELECTION,
  });
});

/**
 * POST /api/access
 * Verify access code
 */
app.post('/api/access', (req, res) => {
  // If access code is not required, always grant access
  if (!REQUIRE_ACCESS_CODE) {
    return res.json({ success: true, message: 'Access granted' });
  }

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
 * POST /api/download-zip
 * Create zip of selected photos and send download link via email
 */
app.post('/api/download-zip', async (req, res) => {
  try {
    const { photoIds, email } = req.body;

    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: 'No photos selected' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    if (photoIds.length > MAX_PHOTO_SELECTION) {
      return res.status(400).json({ error: `Maximum ${MAX_PHOTO_SELECTION} photos allowed` });
    }

    // Get photo details from database
    const uploads = await dbOps.getAllUploads();
    const selectedPhotos = uploads.filter(photo => photoIds.includes(photo.id.toString()));

    if (selectedPhotos.length === 0) {
      return res.status(400).json({ error: 'No valid photos found' });
    }

    console.log(`📦 Creating zip for ${selectedPhotos.length} photos, sending to ${email}`);

    // Create zip archive in memory
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', (err) => {
      throw err;
    });

    // Download each photo and add to zip
    for (const photo of selectedPhotos) {
      try {
        // Generate fresh presigned URL
        const freshUrl = await s3Ops.getPresignedDownloadUrl(photo.s3_key);

        // Download photo from S3
        const response = await axios.get(freshUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        // Add to zip with original filename
        archive.append(Buffer.from(response.data), { name: photo.filename });
        console.log(`  ✓ Added ${photo.filename} to zip`);
      } catch (error) {
        console.error(`  ✗ Failed to add ${photo.filename}:`, error.message);
        // Continue with other photos
      }
    }

    // Finalize the archive
    await archive.finalize();

    // Wait for all data to be collected
    await new Promise((resolve) => {
      archive.on('end', resolve);
    });

    const zipBuffer = Buffer.concat(chunks);
    console.log(`📦 Zip created: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Create email transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000,
      socketTimeout: 30000, // 30 seconds
    });

    // Test connection before sending
    try {
      await transporter.verify();
      console.log('✓ SMTP connection verified');
    } catch (verifyError) {
      console.error('✗ SMTP connection failed:', verifyError.message);
      throw new Error(`SMTP connection failed: ${verifyError.message}`);
    }

    // Send email with zip as attachment
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Your Wedding Photos - Martha & Frédéric',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ae9883;">Your Wedding Photos</h2>
          <p>Thank you for attending our special day!</p>
          <p>Your selected photos (${selectedPhotos.length} ${selectedPhotos.length === 1 ? 'photo' : 'photos'}) are attached to this email.</p>
          <p style="margin-top: 30px; color: #666; font-size: 0.9em;">
            Martha & Frédéric<br>
            29. November 2025
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `wedding-photos-${Date.now()}.zip`,
          content: zipBuffer,
          contentType: 'application/zip',
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    console.log(`✉️  Email sent successfully to ${email}`);

    res.json({
      success: true,
      message: 'Download link sent to your email!',
      photoCount: selectedPhotos.length,
    });
  } catch (error) {
    console.error('Error creating zip and sending email:', error);

    // Provide more specific error messages
    let errorMessage = 'Failed to send download link. Please try again.';

    if (error.message.includes('SMTP connection failed')) {
      errorMessage = 'Email server connection failed. Please contact the administrator.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Email server timeout. The server may be blocking SMTP ports.';
    } else if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check SMTP credentials.';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Email server refused connection. Check SMTP settings.';
    }

    res.status(500).json({ error: errorMessage });
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
${REQUIRE_ACCESS_CODE ? `🔒 Access code: ${ACCESS_CODE}` : '🔓 Public access (no code required)'}

📊 API Endpoints:
   - GET  /api/config       - Get configuration
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
