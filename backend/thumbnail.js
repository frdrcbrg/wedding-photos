const sharp = require('sharp');
const axios = require('axios');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('./s3');

// Thumbnail size (for gallery grid)
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 300;

/**
 * Generate thumbnail from S3 image
 * Downloads original, creates thumbnail, uploads back to S3
 */
async function generateThumbnail(originalUrl, originalKey) {
  try {
    // Skip video files
    if (originalKey.includes('.mp4') || originalKey.includes('.mov') ||
        originalKey.includes('.avi') || originalKey.includes('.webm')) {
      return null;
    }

    console.log(`Generating thumbnail for ${originalKey}`);

    // Download the original image from S3
    const response = await axios.get(originalUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const imageBuffer = Buffer.from(response.data);

    // Generate thumbnail using sharp
    const thumbnailBuffer = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .resize(THUMB_WIDTH, THUMB_HEIGHT, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Generate thumbnail S3 key
    const thumbKey = originalKey.replace('uploads/', 'uploads/thumbs/');

    // Upload thumbnail to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: thumbKey,
      Body: thumbnailBuffer,
      ContentType: 'image/jpeg',
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    console.log(`Thumbnail created: ${thumbKey}`);

    return thumbKey;
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    // Return null on error, will fall back to original image
    return null;
  }
}

module.exports = {
  generateThumbnail,
};
