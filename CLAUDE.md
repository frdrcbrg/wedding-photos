# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Recent Session Summary (2025-11-20)

**Webhook Integration Completed:**
- Configured `wedding-webhook.service` systemd service running on port 9000
- Updated Caddy configuration to proxy `/webhook` and `/health` endpoints to `host.docker.internal:9000`
- GitHub webhook configured to trigger on successful workflow runs
- Webhook secret stored in `/opt/docker/wedding-photos/.env`

## Recent Session Summary (2025-11-19)

**Working Configuration:**
- Deployed on DigitalOcean droplet
- Using Docker Compose V2 (use `docker compose` not `docker-compose`)
- Connected to existing PostgreSQL database via `caddy` network
- DigitalOcean Spaces for storage (bucket: `comfyoutput`, region: `fra1`)
- Caddy reverse proxy on `caddy` network

**Key Fixes Applied:**
1. Fixed Docker npm build: Changed `npm ci` to `npm install` (no package-lock.json)
2. Fixed S3 endpoint: Must use region endpoint only (`https://fra1.digitaloceanspaces.com`), not bucket URL
3. Fixed CORS: Added `x-amz-*` headers and HEAD method for AWS SDK v3 compatibility
4. Fixed presigned URLs: Generate fresh presigned download URLs (7-day expiry) on `/api/photos` requests
5. Migrated from SQLite to PostgreSQL with async operations
6. Added S3 preflight check on startup (logs to `backend/s3-preflight.log`)
7. Added automatic database initialization: `init-db.js` creates database and tables on startup
8. Added swipe navigation to photo lightbox with keyboard and touch support
9. Refactored download system from email attachments to download links (2025-11-18)
   - Emails now contain download links instead of large zip attachments
   - Download links expire after 7 days (JWT-based, stateless)
   - Hybrid caching: zip files cached for 1 hour, regenerated on demand
   - Automatic cache cleanup runs every hour
10. **NEW**: Major gallery redesign for photo download experience (2025-11-19)
   - Renamed gallery page to download.html (photo download focus)
   - Uniform CSS Grid layout with square tiles (object-fit: cover)
   - Floating basket button (bottom-right FAB) for selection management
   - Checkmark badges on selected photos
   - Always-available selection (no mode toggle needed)
   - Lightbox selection integration (select while viewing full-size)
   - Filter toggle: "Show Selected Only" / "Show All"
   - Removed "Back to Main" navigation (standalone download page)

**Environment Setup:**
- `.env` must include: PostgreSQL credentials, S3 credentials, ACCESS_CODE, JWT_SECRET
- S3_ENDPOINT format: `https://fra1.digitaloceanspaces.com` (region only)
- POSTGRES_HOST: `db` (connects to external PostgreSQL container)
- JWT_SECRET: Generate with `openssl rand -hex 32` for download link signing
- PUBLIC_URL: Set to production domain for download link generation (e.g., `wedding.fredericberg.de`)

**Important Notes:**
- Docker Compose V2 syntax: `docker compose` (not `docker-compose`)
- App connects to external `db` PostgreSQL container on `caddy` network
- No local database volume needed (uses external PostgreSQL)
- Presigned URLs refresh on every gallery fetch to prevent expiration issues
- Database is automatically initialized on container startup via `init-db.js` script
- If database doesn't exist, it will be created automatically (requires CREATE DATABASE permission)

## Project Overview

A minimalistic winter-themed wedding photo sharing web application with two main pages:

1. **Upload Page (index.html)**: Guests can upload photos/videos during the wedding via access code
2. **Download Page (download.html)**: Post-event page for guests to browse and download their favorite photos

Features direct S3 storage, no complex authentication, and JWT-based download links. Built with vanilla JavaScript frontend and Node.js/Express backend.

## Tech Stack

- **Backend**: Node.js + Express, PostgreSQL (pg), AWS SDK v3 for S3
- **Frontend**: Pure HTML/CSS/JavaScript (no frameworks)
- **Database**: PostgreSQL 15
- **Storage**: S3-compatible (AWS S3 or DigitalOcean Spaces)
- **Deployment**: Docker with multi-stage builds

## Development Commands

### Local Development

```bash
# Install dependencies
cd backend
npm install

# Initialize database (creates database and tables if needed)
npm run init-db

# Run development server with auto-reload
npm run dev

# Run production server
npm start
```

### Docker

```bash
# Build and run with Docker Compose
docker compose up -d

# View logs
docker compose logs -f

# Stop containers
docker compose down

# Rebuild after changes (local build)
docker compose build --no-cache
```

## CI/CD Deployment

The project uses GitHub Actions for automated builds and deployment:

- **On push to main**: Builds Docker image and pushes to GitHub Container Registry (ghcr.io)
- **Auto-deploy**: SSHs to server and deploys the new image automatically
- **No server building**: Pre-built images are pulled, saving server resources

See `CI_CD_SETUP.md` for complete setup instructions.

### Quick Deploy

```bash
# Simply push to main
git push origin main

# GitHub Actions handles the rest:
# 1. Builds image on GitHub
# 2. Pushes to ghcr.io/frdrcbrg/wedding-photos:latest
# 3. SSHs to server and restarts with new image
```

### Manual Server Deploy (using pre-built image)

```bash
cd /opt/docker/wedding-photos
git pull
docker pull ghcr.io/frdrcbrg/wedding-photos:latest
docker compose up -d
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
   - Client confirms upload → `/api/confirm` saves metadata to PostgreSQL
3. **Gallery**: Frontend fetches from `/api/photos` (metadata with fresh presigned URLs generated on each request)

### Key Files

**Backend:**
- `backend/server.js` - Express app with all API routes
- `backend/database.js` - PostgreSQL operations with connection pooling (uploads table)
- `backend/s3.js` - S3 presigned URL generation and file validation

**Frontend - Upload Page:**
- `frontend/index.html` - Upload page for guests during wedding
- `frontend/app.js` - Client-side upload logic
- `frontend/styles.css` - Winter theme (ice blue, snowflakes, frosted glass)

**Frontend - Download Page:**
- `frontend/download.html` - Post-event photo download gallery
- `frontend/download.js` - Photo browsing, selection, and download logic
- `frontend/download.css` - Gallery grid, floating basket, lightbox styles

### Data Flow

```
Browser → Backend (presigned URL) → Direct S3 Upload → Backend (confirm) → PostgreSQL
         ↓                                                                      ↓
    Gallery fetch ←──────────────── API ←─────────────────────────── Database
```

### Database Schema

`uploads` table (PostgreSQL):
- `id` (SERIAL PRIMARY KEY)
- `filename` (TEXT NOT NULL)
- `s3_key` (TEXT NOT NULL) - S3 object key
- `s3_url` (TEXT NOT NULL) - Stored presigned URL (refreshed on fetch)
- `file_type` (TEXT NOT NULL) - 'photo' or 'video'
- `uploaded_by` (TEXT) - Optional guest name
- `message` (TEXT) - Optional message
- `uploaded_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)

**Note**: All database operations are async using `pg` connection pool.

## Environment Configuration

Copy `.env.example` to `.env` and configure:

Required:
- `ACCESS_CODE` - Single shared code for guests
- `POSTGRES_HOST` - Database host (default: db)
- `POSTGRES_PORT` - Database port (default: 5432)
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password
- `POSTGRES_DB` - Database name
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - S3 credentials
- `S3_BUCKET_NAME` - S3 bucket or Space name
- `S3_REGION` - AWS region (default: us-east-1)

For DigitalOcean Spaces:
- `S3_ENDPOINT` - e.g., `https://fra1.digitaloceanspaces.com` (region endpoint only, not bucket URL)

## File Upload Details

- **Supported formats**: JPEG, PNG, GIF, WebP, HEIC (photos); MP4, QuickTime, AVI, WebM (videos)
- **Max size**: 100MB (enforced client-side)
- **Upload method**: Direct to S3 via presigned URLs (5-minute expiry)
- **File naming**: `uploads/{timestamp}-{random}-{sanitized_filename}`
- **Validation**: File type checked in `s3.js:validateFileType()`

## Photo Download Feature

The app allows users to select multiple photos and receive a download link via email.

### Download Flow

1. **Selection**: User clicks "Select Photos" in gallery, selects photos (max 50)
2. **Request**: User clicks "Request Download", enters email address
3. **Token Generation**: Backend creates JWT token containing photo IDs (7-day expiry)
4. **Email Delivery**: User receives email with download link (no attachment)
5. **Download**: Clicking link generates zip file on-demand (or serves from cache)

### Key Implementation Details

- **Stateless**: No database tracking - all info stored in JWT token
- **Hybrid Caching**:
  - First download generates zip and caches in `/tmp/zips/` for 1 hour
  - Subsequent downloads within 1 hour serve cached file (faster)
  - Cache automatically cleaned every hour
- **Security**:
  - JWT tokens signed with `JWT_SECRET`
  - Links expire after 7 days
  - Token hash used for cache filename
- **Email Size**: Emails stay small (just link, no attachment)

### API Endpoints

- `POST /api/request-download` - Generate token, send email with link
- `GET /api/download/:token` - Verify token, generate/serve zip file

### Environment Variables

- `JWT_SECRET` - Secret for signing tokens (generate with `openssl rand -hex 32`)
- `PUBLIC_URL` - Production domain for link generation (optional, defaults to request host)
- `NODE_ENV` - Set to `production` for HTTPS links

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
2. Set up PostgreSQL database (or use existing)
3. Configure `.env` with production values (database credentials, S3, access code)
4. Deploy via Docker on DigitalOcean Droplet or similar
5. Use Nginx/Caddy for HTTPS reverse proxy
6. Application connects to external PostgreSQL database via `POSTGRES_HOST`

## Common Issues

**Uploads fail**: Check S3 credentials, bucket CORS, and browser console for errors

**Database connection fails**: Verify PostgreSQL credentials and that the `db` container is running on the same network

**CORS errors**: Verify S3 bucket CORS includes PUT, HEAD methods and x-amz-* headers

**Container won't start**: Check logs with `docker compose logs`, ensure `.env` exists with all required variables including PostgreSQL credentials

**Presigned URLs not working**: Check that S3_ENDPOINT is the region endpoint only (e.g., `https://fra1.digitaloceanspaces.com`), not including the bucket name
