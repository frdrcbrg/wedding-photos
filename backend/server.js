const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const dbOps = require('./database');
const s3Ops = require('./s3');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Access code from environment variable
const ACCESS_CODE = process.env.ACCESS_CODE || 'WINTER2025';

// Run S3 preflight check on startup
(async () => {
  console.log('\n🔍 Running S3 preflight check...\n');
  await s3Ops.testConnection();
  console.log('\n');
})();

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
app.post('/api/confirm', (req, res) => {
  try {
    const { filename, s3Key, s3Url, fileType, uploadedBy, message } = req.body;

    if (!filename || !s3Key || !s3Url || !fileType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Insert into database
    const result = dbOps.insertUpload({
      filename,
      s3_key: s3Key,
      s3_url: s3Url,
      file_type: fileType,
      uploaded_by: uploadedBy,
      message: message,
    });

    res.json({
      success: true,
      uploadId: result.lastInsertRowid,
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
    const uploads = dbOps.getAllUploads();

    // Generate fresh presigned URLs for each upload
    const uploadsWithFreshUrls = await Promise.all(
      uploads.map(async (upload) => {
        try {
          const freshUrl = await s3Ops.getPresignedDownloadUrl(upload.s3_key);
          return {
            ...upload,
            s3_url: freshUrl, // Replace with fresh presigned URL
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
app.get('/api/stats', (req, res) => {
  try {
    const stats = dbOps.getStats();
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
