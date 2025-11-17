const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

// Initialize S3 client (works with AWS S3 or DigitalOcean Spaces)
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined, // For DigitalOcean Spaces
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  // Note: forcePathStyle should be false for DigitalOcean Spaces
  forcePathStyle: false,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

const s3Ops = {
  /**
   * Generate presigned URL for uploading to S3
   * @param {string} filename - Original filename
   * @param {string} contentType - MIME type of the file
   * @returns {Promise<{uploadUrl: string, s3Key: string, publicUrl: string}>}
   */
  getPresignedUploadUrl: async (filename, contentType) => {
    // Generate unique key for S3
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `uploads/${timestamp}-${randomString}-${sanitizedFilename}`;

    // Create command for putting object
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
      // ACL: 'public-read', // Uncomment if you want files to be publicly readable
    });

    // Generate presigned URL (valid for 5 minutes)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // Generate public URL (adjust based on your S3 configuration)
    let publicUrl;
    if (process.env.S3_ENDPOINT) {
      // For DigitalOcean Spaces or custom S3 endpoint
      const endpointUrl = process.env.S3_ENDPOINT.replace('https://', '');
      publicUrl = `https://${BUCKET_NAME}.${endpointUrl}/${s3Key}`;
    } else {
      // For AWS S3
      publicUrl = `https://${BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${s3Key}`;
    }

    return {
      uploadUrl,
      s3Key,
      publicUrl,
    };
  },

  /**
   * Generate presigned URL for downloading from S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<string>} - Presigned URL
   */
  getPresignedDownloadUrl: async (s3Key) => {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    // Generate presigned URL (valid for 1 hour)
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  },

  /**
   * Validate file type
   * @param {string} contentType - MIME type
   * @returns {string} - 'photo' or 'video'
   */
  validateFileType: (contentType) => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'];
    const videoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];

    if (imageTypes.includes(contentType)) {
      return 'photo';
    } else if (videoTypes.includes(contentType)) {
      return 'video';
    } else {
      throw new Error('Unsupported file type. Please upload images or videos only.');
    }
  },
};

module.exports = s3Ops;
