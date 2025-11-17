const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
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

/**
 * Log message to file and console
 * @param {string} message - Log message
 * @param {string} level - Log level (INFO, ERROR, SUCCESS)
 */
const logToFile = (message, level = 'INFO') => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  const logPath = path.join(__dirname, 's3-preflight.log');

  // Write to file
  fs.appendFileSync(logPath, logMessage);

  // Also log to console
  console.log(logMessage.trim());
};

/**
 * Test S3 connection and permissions
 * @returns {Promise<boolean>} - True if connection successful
 */
const testS3Connection = async () => {
  logToFile('='.repeat(60), 'INFO');
  logToFile('Starting S3 Preflight Check', 'INFO');
  logToFile('='.repeat(60), 'INFO');

  try {
    // Check if credentials are configured
    if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
      logToFile('S3 credentials not configured in environment variables', 'ERROR');
      return false;
    }

    if (!BUCKET_NAME) {
      logToFile('S3_BUCKET_NAME not configured in environment variables', 'ERROR');
      return false;
    }

    logToFile(`Configuration:`, 'INFO');
    logToFile(`  - Bucket: ${BUCKET_NAME}`, 'INFO');
    logToFile(`  - Region: ${process.env.S3_REGION || 'us-east-1'}`, 'INFO');
    logToFile(`  - Endpoint: ${process.env.S3_ENDPOINT || 'AWS S3 (default)'}`, 'INFO');
    logToFile(`  - Access Key: ${process.env.S3_ACCESS_KEY_ID.substring(0, 8)}...`, 'INFO');

    // Test bucket access
    logToFile('Testing bucket access...', 'INFO');
    const command = new HeadBucketCommand({ Bucket: BUCKET_NAME });
    await s3Client.send(command);

    logToFile('✅ Successfully connected to S3 bucket!', 'SUCCESS');
    logToFile('✅ Bucket is accessible and credentials are valid', 'SUCCESS');

    // Test presigned URL generation
    logToFile('Testing presigned URL generation...', 'INFO');
    const testKey = `test-preflight-${Date.now()}.txt`;
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: testKey,
      ContentType: 'text/plain',
    });
    const presignedUrl = await getSignedUrl(s3Client, putCommand, { expiresIn: 60 });

    logToFile('✅ Presigned URL generation successful', 'SUCCESS');
    logToFile(`  - Test URL generated for key: ${testKey}`, 'INFO');

    logToFile('='.repeat(60), 'INFO');
    logToFile('S3 Preflight Check PASSED', 'SUCCESS');
    logToFile('='.repeat(60), 'INFO');

    return true;
  } catch (error) {
    logToFile('❌ S3 Connection Test FAILED', 'ERROR');
    logToFile(`Error Type: ${error.name}`, 'ERROR');
    logToFile(`Error Message: ${error.message}`, 'ERROR');

    if (error.Code) {
      logToFile(`Error Code: ${error.Code}`, 'ERROR');
    }

    // Provide helpful hints based on error type
    if (error.name === 'NotFound' || error.Code === 'NoSuchBucket') {
      logToFile('Hint: Bucket does not exist or name is incorrect', 'ERROR');
    } else if (error.name === 'InvalidAccessKeyId') {
      logToFile('Hint: Access Key ID is invalid', 'ERROR');
    } else if (error.name === 'SignatureDoesNotMatch') {
      logToFile('Hint: Secret Access Key is incorrect', 'ERROR');
    } else if (error.name === 'AccessDenied' || error.Code === 'Forbidden') {
      logToFile('Hint: Credentials do not have permission to access this bucket', 'ERROR');
    } else if (error.name === 'InvalidBucketName') {
      logToFile('Hint: Bucket name format is invalid', 'ERROR');
    }

    logToFile('='.repeat(60), 'ERROR');

    return false;
  }
};

const s3Ops = {
  /**
   * Run preflight check
   */
  testConnection: testS3Connection,
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

    // Generate presigned URL for upload (valid for 5 minutes)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // Generate presigned URL for download (valid for 7 days)
    // This allows viewing without making the bucket public
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });
    const publicUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 7 * 24 * 60 * 60 });

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
module.exports.s3Client = s3Client;
module.exports.BUCKET_NAME = BUCKET_NAME;
