# CI/CD Setup Guide

This project uses GitHub Actions for automated building and deployment.

## How It Works

1. **Push to main** → GitHub Actions builds Docker image
2. **Image pushed** to GitHub Container Registry (ghcr.io)
3. **Automatic SSH** to your server and deploys the new image

## Initial Setup

### 1. Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

- `SERVER_HOST` - Your DigitalOcean droplet IP (e.g., `129.212.193.226`)
- `SERVER_USER` - SSH user (usually `root`)
- `SSH_PRIVATE_KEY` - Your SSH private key

#### Getting Your SSH Private Key

On your local machine:
```bash
# If you already have an SSH key
cat ~/.ssh/id_rsa

# Or create a new one specifically for GitHub Actions
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions_key

# Copy the private key
cat ~/.ssh/github_actions_key

# Add the public key to your server
ssh-copy-id -i ~/.ssh/github_actions_key.pub root@YOUR_SERVER_IP
```

Copy the entire private key (including `-----BEGIN` and `-----END` lines) and paste it as the `SSH_PRIVATE_KEY` secret.

### 2. Make GitHub Container Registry Public (Optional)

To avoid authentication issues when pulling images:

1. Go to your repository on GitHub
2. Click on "Packages" (right side)
3. Click on your package (wedding-photos)
4. Click "Package settings"
5. Scroll down to "Danger Zone"
6. Click "Change visibility" → Make public

Alternatively, set up authentication on your server (see below).

### 3. Server Setup for Private Registry

If keeping the registry private, authenticate on your server:

```bash
# On your server
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

You can create a Personal Access Token (PAT) at:
GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)

Required scopes: `read:packages`, `write:packages`

## How to Deploy

### Automatic Deployment

Simply push to the main branch:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

GitHub Actions will:
1. Build the Docker image
2. Push to ghcr.io
3. SSH into your server
4. Pull the new image
5. Restart the container

### Manual Deployment

You can also trigger deployment manually:
1. Go to GitHub → Actions tab
2. Click "Build and Deploy" workflow
3. Click "Run workflow" → Select branch → Run

### Viewing Deployment Status

1. Go to GitHub → Actions tab
2. Click on the latest workflow run
3. Watch the logs in real-time

## Server Deployment Commands

If you prefer manual deployment on the server:

```bash
# Pull latest code
cd /opt/docker/wedding-photos
git pull

# Pull pre-built image from GitHub
docker pull ghcr.io/frdrcbrg/wedding-photos:latest

# Restart with new image
docker compose down
docker compose up -d

# View logs
docker compose logs -f wedding-photos
```

## Advantages of This Setup

✅ **No building on server** - Faster deployments, less resource usage
✅ **Consistent builds** - Same environment every time
✅ **Automatic deployment** - Push to main = automatic deploy
✅ **Build artifacts stored** - Can rollback to any previous version
✅ **Free for public repos** - GitHub Actions and Container Registry are free

## Rollback to Previous Version

If something goes wrong:

```bash
# List available image tags
docker images ghcr.io/frdrcbrg/wedding-photos

# Use a specific version (by commit SHA)
docker pull ghcr.io/frdrcbrg/wedding-photos:main-abc1234

# Update docker-compose.yml to use that tag temporarily
# Then restart
docker compose up -d
```

## Troubleshooting

### Build fails on GitHub
- Check the Actions tab for error logs
- Ensure Dockerfile is correct
- Check if dependencies are available

### Deployment fails (SSH issues)
- Verify `SERVER_HOST` and `SERVER_USER` secrets are correct
- Verify `SSH_PRIVATE_KEY` is the complete private key
- Test SSH manually: `ssh -i ~/.ssh/your_key root@YOUR_SERVER_IP`

### Image pull fails on server
- Ensure package is public OR
- Authenticate: `docker login ghcr.io`
- Check if image exists: `docker pull ghcr.io/frdrcbrg/wedding-photos:latest`

### Container won't start
- Check logs: `docker compose logs wedding-photos`
- Verify `.env` file exists with all required variables
- Ensure database is running and accessible

## Disabling Auto-Deployment

If you want to build on GitHub but NOT auto-deploy:

1. Edit `.github/workflows/deploy.yml`
2. Remove or comment out the entire `deploy` job
3. Manually pull and restart when ready

## Alternative: Webhook Deployment

For even simpler deployment without SSH, consider using:
- [Watchtower](https://github.com/containrrr/watchtower) - Automatically updates containers
- [Webhook](https://github.com/adnanh/webhook) - Trigger deployments via HTTP

Let me know if you want to set up either of these!
