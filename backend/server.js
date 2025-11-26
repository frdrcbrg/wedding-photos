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
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const dbOps = require('./database');
const s3Ops = require('./s3');
const { generateResizedImages } = require('./thumbnail');
const { testSMTPConnection } = require('./smtp-preflight');

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
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ZIP_CACHE_DIR = '/tmp/zips';
const ZIP_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour in milliseconds
const DOWNLOAD_LINK_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

// Create zip cache directory if it doesn't exist
if (!fs.existsSync(ZIP_CACHE_DIR)) {
  fs.mkdirSync(ZIP_CACHE_DIR, { recursive: true });
  console.log(`📁 Created zip cache directory: ${ZIP_CACHE_DIR}`);
}

// Run preflight checks on startup
(async () => {
  console.log('\n🔍 Running preflight checks...\n');
  await s3Ops.testConnection();
  console.log('\n');
  await testSMTPConnection();
})();

// Cache cleanup service - runs every hour
function cleanupZipCache() {
  try {
    if (!fs.existsSync(ZIP_CACHE_DIR)) {
      return;
    }

    const files = fs.readdirSync(ZIP_CACHE_DIR);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(ZIP_CACHE_DIR, file);
      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;

      // Delete files older than 1 hour
      if (age > ZIP_CACHE_MAX_AGE) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`🗑️  Cleaned up ${deletedCount} expired zip file(s) from cache`);
    }
  } catch (error) {
    console.error('Error cleaning zip cache:', error.message);
  }
}

// Run cleanup every hour
setInterval(cleanupZipCache, 60 * 60 * 1000); // 1 hour
console.log('🧹 Cache cleanup service started (runs every hour)');

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

    // Generate resized images (thumbnail + preview) asynchronously (don't block response)
    if (fileType === 'photo') {
      generateResizedImages(s3Url, s3Key)
        .then(async ({ thumbnailKey, previewKey }) => {
          if (thumbnailKey) {
            await dbOps.updateThumbnailKey(uploadId, thumbnailKey);
            console.log(`Thumbnail generated for upload ${uploadId}`);
          }
          if (previewKey) {
            await dbOps.updatePreviewKey(uploadId, previewKey);
            console.log(`Preview generated for upload ${uploadId}`);
          }
        })
        .catch((error) => {
          console.error(`Failed to generate resized images for upload ${uploadId}:`, error);
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

    // Generate fresh presigned URLs for each upload (full image, preview, and thumbnail)
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

          // Generate preview URL if preview exists
          let previewUrl = freshUrl; // Default to full image
          if (upload.preview_key) {
            try {
              previewUrl = await s3Ops.getPresignedDownloadUrl(upload.preview_key);
            } catch (previewError) {
              console.error(`Error generating preview URL for ${upload.preview_key}:`, previewError);
              // Fall back to full image
            }
          }

          return {
            ...upload,
            s3_url: freshUrl, // Full image URL (for download)
            preview_url: previewUrl, // Preview URL (for lightbox)
            thumbnail_url: thumbnailUrl, // Thumbnail URL (for gallery grid)
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
      console.error('Archive error:', err);
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
      } catch (error) {
        console.error(`Failed to add ${photo.filename}:`, error.message);
        // Continue with other photos
      }
    }

    // Finalize the archive and wait for it to finish
    const finalizePromise = new Promise((resolve, reject) => {
      archive.on('finish', resolve);
      archive.on('error', reject);
    });

    archive.finalize();
    await finalizePromise;

    const zipBuffer = Buffer.concat(chunks);
    console.log(`Zip created: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Check if using Resend API (preferred for DigitalOcean)
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'noreply@fredericberg.de',
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
          },
        ],
      });
    } else {
      // Fallback to SMTP
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
      } catch (verifyError) {
        console.error('SMTP connection failed:', verifyError.message);
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
    }

    console.log(`✅ Email sent successfully to ${email}`);

    res.json({
      success: true,
      message: 'Download link sent to your email!',
      photoCount: selectedPhotos.length,
    });
  } catch (error) {
    console.error('Error creating zip and sending email:', error.message);

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
 * POST /api/request-download
 * Generate signed download token and send link via email
 */
app.post('/api/request-download', async (req, res) => {
  try {
    const { photoIds, email } = req.body;

    // Validation
    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).json({ error: 'No photos selected' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    if (photoIds.length > MAX_PHOTO_SELECTION) {
      return res.status(400).json({ error: `Maximum ${MAX_PHOTO_SELECTION} photos allowed` });
    }

    // Verify photos exist
    const uploads = await dbOps.getAllUploads();
    const selectedPhotos = uploads.filter(photo => photoIds.includes(photo.id.toString()));

    if (selectedPhotos.length === 0) {
      return res.status(400).json({ error: 'No valid photos found' });
    }

    console.log(`🔗 Generating download link for ${selectedPhotos.length} photos, sending to ${email}`);

    // Create JWT token with photo IDs
    const token = jwt.sign(
      {
        photoIds: photoIds,
        timestamp: Date.now(),
      },
      JWT_SECRET,
      { expiresIn: DOWNLOAD_LINK_EXPIRY }
    );

    // Build download URL
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = process.env.PUBLIC_URL || req.get('host');
    const downloadUrl = `${protocol}://${host}/api/download/${token}`;

    console.log(`📧 Download URL: ${downloadUrl}`);

    // Send email with download link
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'noreply@fredericberg.de',
        to: email,
        subject: 'Eure Hochzeitsfotos - Martha & Frédéric',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ae9883;">Eure Hochzeitsfotos</h2>
            <p>Vielen Dank, dass ihr dabei wart!</p>
            <p>Ihr habt ${selectedPhotos.length} ${selectedPhotos.length === 1 ? 'Foto' : 'Fotos'} von unserer Hochzeit ausgewählt.</p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${downloadUrl}"
                 style="background-color: #ae9883; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Fotos herunterladen
              </a>
            </div>

            <p style="color: #666; font-size: 0.9em;">
              ⏰ Dieser Download-Link läuft in 7 Tagen ab.
            </p>

            <p style="color: #888; font-size: 0.85em; margin-top: 10px;">
              💡 Der erste Download kann 30-60 Sekunden dauern, während die ZIP-Datei vorbereitet wird. Nachfolgende Downloads sind sofort verfügbar.
            </p>

            <p style="margin-top: 30px; color: #666; font-size: 0.9em;">
              Martha & Frédéric<br>
              29. November 2025
            </p>
          </div>
        `,
      });
    } else {
      // Fallback to SMTP
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
      });

      await transporter.verify();

      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Eure Hochzeitsfotos - Martha & Frédéric',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ae9883;">Eure Hochzeitsfotos</h2>
            <p>Vielen Dank, dass ihr dabei wart!</p>
            <p>Ihr habt ${selectedPhotos.length} ${selectedPhotos.length === 1 ? 'Foto' : 'Fotos'} von unserer Hochzeit ausgewählt.</p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${downloadUrl}"
                 style="background-color: #ae9883; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Fotos herunterladen
              </a>
            </div>

            <p style="color: #666; font-size: 0.9em;">
              ⏰ Dieser Download-Link läuft in 7 Tagen ab.
            </p>

            <p style="color: #888; font-size: 0.85em; margin-top: 10px;">
              💡 Der erste Download kann 30-60 Sekunden dauern, während die ZIP-Datei vorbereitet wird. Nachfolgende Downloads sind sofort verfügbar.
            </p>

            <p style="margin-top: 30px; color: #666; font-size: 0.9em;">
              Martha & Frédéric<br>
              29. November 2025
            </p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
    }

    console.log(`✅ Download link sent to ${email}`);

    res.json({
      success: true,
      message: 'Download link sent to your email!',
      photoCount: selectedPhotos.length,
    });
  } catch (error) {
    console.error('Error generating download link:', error.message);

    let errorMessage = 'Failed to send download link. Please try again.';

    if (error.name === 'JsonWebTokenError') {
      errorMessage = 'Failed to generate download token. Please contact administrator.';
    } else if (error.message.includes('SMTP connection failed')) {
      errorMessage = 'Email server connection failed. Please contact the administrator.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Email server timeout. The server may be blocking SMTP ports.';
    }

    res.status(500).json({ error: errorMessage });
  }
});

/**
 * GET /api/download/:token
 * Download photos as zip using signed token
 * Implements hybrid caching: stores zip for 1 hour, regenerates if needed
 */
app.get('/api/download/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Verify and decode JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(410).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Link Expired</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
              h1 { color: #ae9883; }
              p { color: #666; line-height: 1.6; }
            </style>
          </head>
          <body>
            <h1>⏰ Download Link Expired</h1>
            <p>This download link has expired. Download links are valid for 7 days.</p>
            <p>Please request a new download link from the gallery.</p>
          </body>
          </html>
        `);
      }
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Invalid Link</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            h1 { color: #ae9883; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <h1>❌ Invalid Download Link</h1>
          <p>This download link is invalid or has been tampered with.</p>
          <p>Please request a new download link from the gallery.</p>
        </body>
        </html>
      `);
    }

    const { photoIds } = decoded;

    if (!photoIds || !Array.isArray(photoIds) || photoIds.length === 0) {
      return res.status(400).send('Invalid token: no photos specified');
    }

    console.log(`📥 Download request for ${photoIds.length} photos`);

    // Generate cache filename based on token hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const cacheFilePath = path.join(ZIP_CACHE_DIR, `${tokenHash}.zip`);

    // Check if cached zip exists and is fresh (< 1 hour old)
    if (fs.existsSync(cacheFilePath)) {
      const stats = fs.statSync(cacheFilePath);
      const age = Date.now() - stats.mtimeMs;

      if (age < ZIP_CACHE_MAX_AGE) {
        console.log(`✨ Serving cached zip (${Math.round(age / 1000 / 60)} minutes old)`);

        // Stream cached file
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="wedding-photos-${Date.now()}.zip"`);

        const fileStream = fs.createReadStream(cacheFilePath);
        fileStream.pipe(res);
        return;
      } else {
        console.log(`🗑️  Cache expired, regenerating zip`);
        // Delete expired cache
        fs.unlinkSync(cacheFilePath);
      }
    }

    // Generate fresh zip
    console.log(`🔨 Generating fresh zip for ${photoIds.length} photos`);

    // Get photo details from database
    const uploads = await dbOps.getAllUploads();
    const selectedPhotos = uploads.filter(photo => photoIds.includes(photo.id.toString()));

    if (selectedPhotos.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Photos Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
            h1 { color: #ae9883; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <h1>📷 Photos Not Found</h1>
          <p>The requested photos could not be found. They may have been deleted.</p>
        </body>
        </html>
      `);
    }

    // Create zip archive and stream to temp file
    const archive = archiver('zip', {
      zlib: { level: 6 } // Balanced compression (faster than level 9, minimal size difference for images)
    });

    // Stream to temporary file instead of memory
    const tempZipPath = path.join(ZIP_CACHE_DIR, `temp-${tokenHash}.zip`);
    const output = fs.createWriteStream(tempZipPath);

    archive.pipe(output);

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      // Clean up temp file
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
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
      } catch (error) {
        console.error(`Failed to add ${photo.filename}:`, error.message);
        // Continue with other photos
      }
    }

    // Finalize the archive
    const finalizePromise = new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.finalize();
    await finalizePromise;

    const stats = fs.statSync(tempZipPath);
    console.log(`📦 Zip created: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Move temp file to cache location
    fs.renameSync(tempZipPath, cacheFilePath);
    console.log(`💾 Cached zip for future requests`);

    // Stream zip to client
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="wedding-photos-${Date.now()}.zip"`);

    const fileStream = fs.createReadStream(cacheFilePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error processing download:', error.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Download Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
          h1 { color: #ae9883; }
          p { color: #666; line-height: 1.6; }
        </style>
      </head>
      <body>
        <h1>❌ Download Failed</h1>
        <p>An error occurred while preparing your download. Please try again later.</p>
        <p>If the problem persists, please request a new download link.</p>
      </body>
      </html>
    `);
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
