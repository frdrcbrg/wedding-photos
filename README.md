# ❄️ Winter Wedding Photo Sharing App

A beautiful, minimalistic web application for sharing wedding photos and videos with guests. Features a Winter Wedding theme with snowflake animations, frosted glass effects, and a clean, elegant design.

![Winter Wedding Theme](https://img.shields.io/badge/Theme-Winter_Wedding-2196F3?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

## ✨ Features

- **🎨 Beautiful Winter Theme** - Ice blue colors, snowflake animations, and frosted glass effects
- **📸 Photo & Video Upload** - Support for images and videos up to 100MB
- **🔒 Access Code Protection** - Simple access control without complex authentication
- **☁️ S3 Storage** - Direct uploads to AWS S3 or DigitalOcean Spaces
- **📱 Responsive Design** - Works perfectly on all devices
- **🎯 Lightweight** - No frontend frameworks, pure vanilla JavaScript
- **🐳 Docker Ready** - Easy deployment with Docker
- **💾 SQLite Database** - No external database needed
- **⚡ Real-time Stats** - Track total uploads, photos, and videos

## 🏗️ Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Browser   │────────▶│   Backend   │────────▶│  S3 Bucket  │
│  (Frontend) │◀────────│   (Node.js) │◀────────│  (Storage)  │
└─────────────┘         └─────────────┘         └─────────────┘
                              │
                              ▼
                        ┌──────────┐
                        │  SQLite  │
                        │ Database │
                        └──────────┘
```

### Tech Stack

**Backend:**
- Node.js + Express
- SQLite (better-sqlite3)
- AWS SDK for S3
- Presigned URLs for direct uploads

**Frontend:**
- HTML5 + CSS3
- Vanilla JavaScript
- Modern CSS (Grid/Flexbox)
- Progressive enhancement

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (for local development)
- Docker & Docker Compose (for containerized deployment)
- S3-compatible storage (AWS S3 or DigitalOcean Spaces)

### Local Development

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd wedding-photos
   ```

2. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your settings:
   ```env
   PORT=3000
   ACCESS_CODE=WINTER2025

   # AWS S3 or DigitalOcean Spaces
   S3_ACCESS_KEY_ID=your_access_key
   S3_SECRET_ACCESS_KEY=your_secret_key
   S3_BUCKET_NAME=your_bucket_name
   S3_REGION=us-east-1

   # For DigitalOcean Spaces (optional):
   # S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
   # S3_FORCE_PATH_STYLE=true
   ```

4. **Run the server:**
   ```bash
   npm start
   ```

5. **Open your browser:**
   ```
   http://localhost:3000
   ```

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

1. **Create `.env` file** in the project root:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

2. **Build and run:**
   ```bash
   docker-compose up -d
   ```

3. **View logs:**
   ```bash
   docker-compose logs -f
   ```

4. **Stop the container:**
   ```bash
   docker-compose down
   ```

### Using Docker Directly

```bash
# Build image
docker build -t winter-wedding-app .

# Run container
docker run -d \
  --name winter-wedding \
  -p 3000:3000 \
  -e ACCESS_CODE=WINTER2025 \
  -e S3_ACCESS_KEY_ID=your_key \
  -e S3_SECRET_ACCESS_KEY=your_secret \
  -e S3_BUCKET_NAME=your_bucket \
  -e S3_REGION=us-east-1 \
  -v wedding-data:/app/backend \
  winter-wedding-app
```

## ☁️ DigitalOcean Deployment

### Deploy to DigitalOcean Droplet

1. **Create a droplet** (Ubuntu 22.04, min 1GB RAM)

2. **SSH into your droplet:**
   ```bash
   ssh root@your_droplet_ip
   ```

3. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   ```

4. **Clone your repository:**
   ```bash
   git clone <your-repo-url>
   cd wedding-photos
   ```

5. **Configure environment:**
   ```bash
   nano .env
   # Add your settings
   ```

6. **Deploy with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

7. **Access your app:**
   ```
   http://your_droplet_ip:3000
   ```

### Using DigitalOcean Spaces

1. **Create a Space** in DigitalOcean control panel
2. **Generate API keys** (Spaces access key & secret)
3. **Update `.env`:**
   ```env
   S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
   S3_BUCKET_NAME=your-space-name
   S3_REGION=us-east-1
   S3_FORCE_PATH_STYLE=true
   S3_ACCESS_KEY_ID=your_spaces_key
   S3_SECRET_ACCESS_KEY=your_spaces_secret
   ```

4. **Set Space permissions** to allow public read (or use presigned URLs)

## 📱 QR Code Sharing

To share the app with wedding guests via QR code:

1. **Get your app's URL:**
   - Local: `http://localhost:3000`
   - Droplet: `http://your_droplet_ip:3000`
   - Domain: `http://yourwedding.com`

2. **Generate QR code** using online tools:
   - [QR Code Generator](https://www.qr-code-generator.com/)
   - [QRCode Monkey](https://www.qrcode-monkey.com/)

3. **Print and display** at your wedding venue!

**Pro tip:** Add a custom domain using Cloudflare or DigitalOcean DNS for a cleaner URL.

## 🎨 Customization

### Change Access Code

Edit `.env`:
```env
ACCESS_CODE=YOUR_CUSTOM_CODE
```

### Modify Theme Colors

Edit `frontend/styles.css`:
```css
:root {
  --ice-blue: #E3F2FD;
  --deep-blue: #2196F3;
  /* Customize colors here */
}
```

### Update Wedding Title

Edit `frontend/index.html`:
```html
<h1 class="title">Your Names Wedding</h1>
<p class="subtitle">Your custom subtitle</p>
```

## 📊 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/access` | Verify access code |
| POST | `/api/upload-url` | Get presigned S3 URL |
| POST | `/api/confirm` | Confirm upload & save metadata |
| GET | `/api/photos` | List all uploads |
| GET | `/api/stats` | Upload statistics |
| GET | `/api/health` | Health check |

## 🔒 Security Considerations

- **Access Code:** Change default code in production
- **HTTPS:** Use reverse proxy (Nginx/Caddy) with SSL certificate
- **S3 Bucket:** Configure CORS and appropriate permissions
- **Rate Limiting:** Consider adding rate limiting for production
- **File Validation:** File types and sizes are validated

## 🐛 Troubleshooting

### Uploads failing?
- Check S3 credentials in `.env`
- Verify bucket CORS settings
- Check browser console for errors

### Can't access the app?
- Verify Docker container is running: `docker ps`
- Check logs: `docker-compose logs`
- Ensure port 3000 is not in use

### Database issues?
- SQLite database is created automatically
- Check volume permissions: `ls -la backend/`

## 📄 License

MIT License - feel free to use for your wedding!

## 🙏 Credits

Built with ❄️ for magical winter weddings.

---

**Enjoy your special day! 💍✨**

---

## 🚀 Automatic Deployment

This repository is configured with automatic deployment via GitHub webhooks. Every push to `main` automatically triggers deployment to the production server - no manual intervention required!

**How it works:**
1. Push code to `main` branch
2. GitHub Actions builds Docker image
3. Webhook triggers deployment on server
4. Latest version goes live automatically

For setup instructions, see [AUTO_DEPLOY_SETUP.md](AUTO_DEPLOY_SETUP.md)