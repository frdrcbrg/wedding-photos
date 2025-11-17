# 🚀 Deployment Guide

Complete step-by-step guide for deploying your Winter Wedding Photo App.

## Table of Contents

1. [S3 Setup (AWS or DigitalOcean)](#s3-setup)
2. [Local Testing](#local-testing)
3. [DigitalOcean Droplet Deployment](#digitalocean-droplet)
4. [Domain & SSL Setup](#domain--ssl)
5. [Production Checklist](#production-checklist)

---

## S3 Setup

### Option A: AWS S3

1. **Create S3 Bucket:**
   - Go to AWS S3 Console
   - Click "Create bucket"
   - Bucket name: `your-wedding-photos` (must be globally unique)
   - Region: Choose closest to your users
   - Uncheck "Block all public access" (we'll use presigned URLs)
   - Click "Create bucket"

2. **Configure CORS:**
   - Select your bucket
   - Go to "Permissions" tab
   - Scroll to "CORS configuration"
   - Add this configuration:

   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST"],
       "AllowedOrigins": ["*"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```

3. **Create IAM User:**
   - Go to IAM Console
   - Click "Users" → "Add user"
   - Username: `wedding-photos-app`
   - Access type: "Programmatic access"
   - Attach policy: `AmazonS3FullAccess` (or create custom policy)
   - Save Access Key ID and Secret Access Key

4. **Custom IAM Policy (Recommended):**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject"
         ],
         "Resource": "arn:aws:s3:::your-wedding-photos/*"
       }
     ]
   }
   ```

### Option B: DigitalOcean Spaces

1. **Create Space:**
   - Go to DigitalOcean Control Panel
   - Click "Spaces" → "Create Space"
   - Choose datacenter region
   - Name: `wedding-photos`
   - Enable CDN (recommended)
   - Click "Create Space"

2. **Configure CORS:**
   - Select your Space
   - Go to "Settings" tab
   - Add CORS configuration:

   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST"],
       "AllowedOrigins": ["*"],
       "MaxAgeSeconds": 3000
     }
   ]
   ```

3. **Generate API Keys:**
   - Go to "API" → "Spaces Keys"
   - Click "Generate New Key"
   - Name: `Wedding Photos App`
   - Save the Access Key and Secret Key

4. **Update `.env`:**
   ```env
   S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
   S3_BUCKET_NAME=wedding-photos
   S3_REGION=us-east-1
   S3_FORCE_PATH_STYLE=true
   S3_ACCESS_KEY_ID=DO00XXXXXXXXXXX
   S3_SECRET_ACCESS_KEY=your_secret_key
   ```

---

## Local Testing

1. **Clone and setup:**
   ```bash
   git clone <your-repo>
   cd wedding-photos
   cp .env.example .env
   ```

2. **Configure `.env`:**
   ```env
   PORT=3000
   ACCESS_CODE=WINTER2025
   S3_ACCESS_KEY_ID=your_key
   S3_SECRET_ACCESS_KEY=your_secret
   S3_BUCKET_NAME=your_bucket
   S3_REGION=us-east-1
   ```

3. **Install and run:**
   ```bash
   cd backend
   npm install
   npm start
   ```

4. **Test:**
   - Open `http://localhost:3000`
   - Enter access code: `WINTER2025`
   - Try uploading a test image
   - Verify it appears in gallery
   - Check S3 bucket for uploaded file

---

## DigitalOcean Droplet

### Step 1: Create Droplet

1. **Choose Image:**
   - OS: Ubuntu 22.04 LTS
   - Plan: Basic ($6/month - 1GB RAM is sufficient)
   - Datacenter: Choose closest to your location
   - Authentication: SSH keys (recommended)

2. **Create and get IP:**
   ```
   Your droplet IP: 123.45.67.89
   ```

### Step 2: Initial Server Setup

```bash
# SSH into droplet
ssh root@123.45.67.89

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Create app directory
mkdir -p /opt/wedding-photos
cd /opt/wedding-photos
```

### Step 3: Deploy Application

```bash
# Clone repository (or upload files)
git clone <your-repo-url> .

# Create .env file
nano .env
```

Paste your configuration:
```env
PORT=3000
ACCESS_CODE=WINTER2025
S3_ACCESS_KEY_ID=your_key
S3_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=your_bucket
S3_REGION=us-east-1
# Add S3_ENDPOINT if using DigitalOcean Spaces
```

```bash
# Build and run
docker-compose up -d

# Check status
docker-compose logs -f
```

### Step 4: Configure Firewall

```bash
# Allow SSH, HTTP, HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw enable
```

### Step 5: Test

Open in browser:
```
http://123.45.67.89:3000
```

---

## Domain & SSL

### Option A: Nginx Reverse Proxy with Let's Encrypt

1. **Install Nginx and Certbot:**
   ```bash
   apt install nginx certbot python3-certbot-nginx -y
   ```

2. **Configure Nginx:**
   ```bash
   nano /etc/nginx/sites-available/wedding
   ```

   ```nginx
   server {
       listen 80;
       server_name yourwedding.com www.yourwedding.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

3. **Enable site:**
   ```bash
   ln -s /etc/nginx/sites-available/wedding /etc/nginx/sites-enabled/
   nginx -t
   systemctl reload nginx
   ```

4. **Get SSL certificate:**
   ```bash
   certbot --nginx -d yourwedding.com -d www.yourwedding.com
   ```

5. **Auto-renewal:**
   ```bash
   certbot renew --dry-run
   ```

### Option B: Caddy (Easier)

1. **Install Caddy:**
   ```bash
   apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
   apt update
   apt install caddy
   ```

2. **Configure Caddy:**
   ```bash
   nano /etc/caddy/Caddyfile
   ```

   ```
   yourwedding.com {
       reverse_proxy localhost:3000
   }
   ```

3. **Restart Caddy:**
   ```bash
   systemctl restart caddy
   ```

That's it! Caddy automatically handles SSL certificates.

---

## Production Checklist

### Security

- [ ] Change default access code
- [ ] Enable HTTPS
- [ ] Configure firewall (UFW)
- [ ] Disable root SSH login
- [ ] Set up fail2ban
- [ ] Review S3 bucket permissions
- [ ] Enable CloudFlare (optional but recommended)

### Performance

- [ ] Enable S3/Spaces CDN
- [ ] Configure Nginx/Caddy caching
- [ ] Set appropriate S3 lifecycle rules
- [ ] Monitor disk space (SQLite database)

### Monitoring

- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)
- [ ] Configure log rotation
- [ ] Monitor Docker container health
- [ ] Set up backup for SQLite database

### Backup

```bash
# Backup SQLite database
docker cp winter-wedding-app:/app/backend/uploads.db ./uploads-backup.db

# Or use volume backup
docker run --rm \
  -v wedding-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/wedding-data-backup.tar.gz /data
```

### Auto-restart on reboot

```bash
# Docker Compose auto-starts by default with restart: unless-stopped
# To ensure Docker starts on boot:
systemctl enable docker
```

---

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs

# Check if port is in use
netstat -tulpn | grep 3000

# Restart container
docker-compose restart
```

### Database permission errors
```bash
# Fix permissions
docker-compose down
sudo chown -R 1000:1000 backend/
docker-compose up -d
```

### S3 upload errors
```bash
# Test S3 credentials
aws s3 ls s3://your-bucket --profile wedding

# Check CORS
# Verify in browser console network tab
```

---

## Updating the App

```bash
cd /opt/wedding-photos

# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Check logs
docker-compose logs -f
```

---

**Need help?** Open an issue on GitHub or check the main README.md.

Happy wedding! 🎉
