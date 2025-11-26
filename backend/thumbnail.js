const sharp = require('sharp');
const axios = require('axios');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('./s3');

// Image sizes
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 300;
const PREVIEW_MAX_WIDTH = 1920;
const PREVIEW_MAX_HEIGHT = 1920;

/**
 * Generate thumbnail and preview images from S3 image
 * Downloads original, creates both resized versions, uploads back to S3
 * Returns { thumbnailKey, previewKey }
 */
async function generateResizedImages(originalUrl, originalKey) {
  try {
    // Skip video files
    if (originalKey.includes('.mp4') || originalKey.includes('.mov') ||
        originalKey.includes('.avi') || originalKey.includes('.webm')) {
      return { thumbnailKey: null, previewKey: null };
    }

    console.log(`Generating resized images for ${originalKey}`);

    // Download the original image from S3
    const response = await axios.get(originalUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const imageBuffer = Buffer.from(response.data);

    // Generate thumbnail (300x300 square, cropped)
    const thumbnailBuffer = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .resize(THUMB_WIDTH, THUMB_HEIGHT, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Generate preview (1920px max, maintain aspect ratio)
    const previewBuffer = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .resize(PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true, // Don't upscale smaller images
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Generate S3 keys
    const thumbKey = originalKey.replace('uploads/', 'uploads/thumbs/');
    const previewKey = originalKey.replace('uploads/', 'uploads/previews/');

    // Upload both to S3 in parallel
    await Promise.all([
      s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: thumbKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
      })),
      s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: previewKey,
        Body: previewBuffer,
        ContentType: 'image/jpeg',
      }))
    ]);

    console.log(`Resized images created: ${thumbKey}, ${previewKey}`);

    return { thumbnailKey: thumbKey, previewKey };
  } catch (error) {
    console.error('Error generating resized images:', error);
    // Return null on error, will fall back to original image
    return { thumbnailKey: null, previewKey: null };
  }
}

module.exports = {
  generateResizedImages,
};
