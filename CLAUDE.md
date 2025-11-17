# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A minimalistic winter-themed wedding photo sharing web application. Guests can upload photos/videos via access code, with direct S3 storage and no complex authentication. Built with vanilla JavaScript frontend and Node.js/Express backend.

## Tech Stack

- **Backend**: Node.js + Express, SQLite (better-sqlite3), AWS SDK v3 for S3
- **Frontend**: Pure HTML/CSS/JavaScript (no frameworks)
- **Storage**: S3-compatible (AWS S3 or DigitalOcean Spaces)
- **Deployment**: Docker with multi-stage builds

## Development Commands

### Local Development

```bash
# Install dependencies
cd backend
npm install

# Run development server with auto-reload
npm run dev

# Run production server
npm start
```

### Docker

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop containers
docker-compose down

# Rebuild after changes
docker-compose build --no-cache
```

### Testing

No automated tests are currently configured. Test manually:
1. Start server: `cd backend && npm start`
2. Open `http://localhost:3000`
3. Enter access code (from `.env`)
4. Upload test image/video
5. Verify S3 upload and database record

## Architecture

### Request Flow

1. **Access Control**: User enters code → `/api/access` validates → sessionStorage stores token
2. **Upload Flow**:
   - Frontend requests presigned URL → `/api/upload-url`
   - Client uploads directly to S3 using presigned URL
   - Client confirms upload → `/api/confirm` saves metadata to SQLite
3. **Gallery**: Frontend fetches from `/api/photos` (metadata only, S3 URLs for media)

### Key Files

- `backend/server.js` - Express app with all API routes
- `backend/database.js` - SQLite operations (uploads table)
- `backend/s3.js` - S3 presigned URL generation and file validation
- `frontend/app.js` - Client-side upload logic, gallery, lightbox
- `frontend/index.html` - Single-page app structure
- `frontend/styles.css` - Winter theme (ice blue, snowflakes, frosted glass)

### Data Flow

```
Browser → Backend (presigned URL) → Direct S3 Upload → Backend (confirm) → SQLite
         ↓                                                                    ↓
    Gallery fetch ←──────────────── API ←─────────────────────── Database
```

### Database Schema

`uploads` table:
- `id` (INTEGER PRIMARY KEY)
- `filename` (TEXT)
- `s3_key` (TEXT) - S3 object key
- `s3_url` (TEXT) - Public/presigned URL
- `file_type` (TEXT) - 'photo' or 'video'
- `uploaded_by` (TEXT) - Optional guest name
- `message` (TEXT) - Optional message
- `uploaded_at` (DATETIME)

## Environment Configuration

Copy `.env.example` to `.env` and configure:

Required:
- `ACCESS_CODE` - Single shared code for guests
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - S3 credentials
- `S3_BUCKET_NAME` - S3 bucket or Space name
- `S3_REGION` - AWS region (default: us-east-1)

For DigitalOcean Spaces:
- `S3_ENDPOINT` - e.g., `https://nyc3.digitaloceanspaces.com`
- `S3_FORCE_PATH_STYLE=true`

## File Upload Details

- **Supported formats**: JPEG, PNG, GIF, WebP, HEIC (photos); MP4, QuickTime, AVI, WebM (videos)
- **Max size**: 100MB (enforced client-side)
- **Upload method**: Direct to S3 via presigned URLs (5-minute expiry)
- **File naming**: `uploads/{timestamp}-{random}-{sanitized_filename}`
- **Validation**: File type checked in `s3.js:validateFileType()`

## Customization Points

- **Access code**: Change `ACCESS_CODE` in `.env`
- **Theme colors**: Edit CSS variables in `frontend/styles.css` (`:root`)
- **Wedding title**: Edit `<h1 class="title">` in `frontend/index.html`
- **Max file size**: Update `MAX_FILE_SIZE` in `frontend/app.js`

## S3 Configuration

CORS must be configured on S3 bucket/Space to allow direct uploads:

**For DigitalOcean Spaces:**
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": [
      "*",
      "x-amz-*",
      "content-type",
      "content-length",
      "x-amz-checksum-crc32",
      "x-amz-sdk-checksum-algorithm"
    ],
    "ExposeHeaders": [
      "ETag",
      "x-amz-version-id"
    ],
    "MaxAgeSeconds": 3000
  }
]
```

**For AWS S3:**
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": [
      "*",
      "x-amz-*",
      "content-type",
      "content-length"
    ],
    "ExposeHeaders": [
      "ETag",
      "x-amz-version-id"
    ]
  }
]
```

Bucket permissions: Either public-read ACL or presigned URLs for downloads.

## Production Deployment

See `DEPLOYMENT.md` for detailed steps. Summary:
1. Set up S3 bucket with CORS
2. Configure `.env` with production values
3. Deploy via Docker on DigitalOcean Droplet or similar
4. Use Nginx/Caddy for HTTPS reverse proxy
5. Database persists via Docker volume `wedding-data`

## Common Issues

**Uploads fail**: Check S3 credentials, bucket CORS, and browser console for errors

**Database locked**: SQLite doesn't support concurrent writes well; use better-sqlite3's synchronous API (already configured)

**CORS errors**: Verify S3 bucket CORS includes PUT method and your origin

**Container won't start**: Check logs with `docker-compose logs`, ensure `.env` exists with all required variables
