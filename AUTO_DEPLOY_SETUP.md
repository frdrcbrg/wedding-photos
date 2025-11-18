# Automatic Deployment with GitHub Webhooks

This setup allows GitHub Actions to automatically trigger deployment on your droplet after a successful build.

## How It Works

1. You push code to GitHub
2. GitHub Actions builds and pushes Docker image
3. GitHub sends webhook to your droplet
4. Webhook server runs `deploy.sh` automatically
5. New version is deployed!

## Setup Instructions

### Step 1: Generate a Webhook Secret

On your local machine or droplet:

```bash
openssl rand -hex 32
```

Copy this secret - you'll need it for both GitHub and the server.

### Step 2: Configure the Webhook Server on Droplet

1. Add to your `.env` file on the droplet:

```bash
WEBHOOK_PORT=9000
WEBHOOK_SECRET=your_generated_secret_here
```

2. Start the webhook server as a systemd service:

```bash
# Create systemd service file
sudo nano /etc/systemd/system/wedding-webhook.service
```

Paste this content (adjust paths if needed):

```ini
[Unit]
Description=Wedding Photos Webhook Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/wedding-photos
ExecStart=/usr/bin/node /path/to/wedding-photos/webhook-server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/path/to/wedding-photos/.env

[Install]
WantedBy=multi-user.target
```

3. Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable wedding-webhook
sudo systemctl start wedding-webhook
sudo systemctl status wedding-webhook
```

4. Check logs:

```bash
sudo journalctl -u wedding-webhook -f
```

### Step 3: Configure Caddy Reverse Proxy

Add this to your Caddyfile to expose the webhook endpoint:

```
webhook.fredericberg.de {
    reverse_proxy localhost:9000
}
```

Or add to your existing domain configuration:

```
fredericberg.de {
    # Existing config...

    # Webhook endpoint
    handle /webhook {
        reverse_proxy localhost:9000
    }
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

### Step 4: Configure GitHub Webhook

1. Go to your GitHub repository: https://github.com/frdrcbrg/wedding-photos
2. Click **Settings** → **Webhooks** → **Add webhook**
3. Configure:
   - **Payload URL**: `https://fredericberg.de/webhook` (or `https://webhook.fredericberg.de/webhook`)
   - **Content type**: `application/json`
   - **Secret**: (paste the secret you generated in Step 1)
   - **Which events**: Select "Let me select individual events"
     - Check only: **Workflow runs**
   - **Active**: ✓ Checked
4. Click **Add webhook**

### Step 5: Test the Setup

1. Make a small change to your code and push:

```bash
# Make a small change
echo "# Test auto-deploy" >> README.md
git add README.md
git commit -m "test: Auto-deploy webhook"
git push origin main
```

2. Watch the deployment:

On your droplet:
```bash
# Watch webhook server logs
sudo journalctl -u wedding-webhook -f

# Watch container logs
docker compose logs -f
```

3. Verify:
   - GitHub Actions completes successfully
   - Webhook server receives the event
   - Deploy script runs automatically
   - New version is deployed

## Troubleshooting

### Webhook not triggered

1. Check GitHub webhook deliveries:
   - Go to Settings → Webhooks → Your webhook
   - Click on "Recent Deliveries"
   - Check if requests are being sent and their responses

2. Check webhook server is running:
```bash
sudo systemctl status wedding-webhook
```

3. Check Caddy is routing correctly:
```bash
curl -X POST http://localhost:9000/webhook
```

### Deployment fails

Check logs:
```bash
sudo journalctl -u wedding-webhook -f
```

Common issues:
- Deploy script not executable: `chmod +x deploy.sh webhook-deploy.sh`
- Wrong working directory in systemd service
- Docker permissions issues

### Security

The webhook endpoint is protected by:
1. **GitHub signature verification** - Only valid GitHub webhooks are processed
2. **Secret token** - Must match between GitHub and server
3. **HTTPS** - All communication is encrypted via Caddy

## Manual Deployment

You can still deploy manually anytime:

```bash
cd /path/to/wedding-photos
./deploy.sh
```

## Disable Auto-Deploy

If you want to disable automatic deployment:

```bash
sudo systemctl stop wedding-webhook
sudo systemctl disable wedding-webhook
```

Or just disable the webhook in GitHub Settings.

## Monitoring

View webhook activity:

```bash
# Real-time logs
sudo journalctl -u wedding-webhook -f

# Last 100 lines
sudo journalctl -u wedding-webhook -n 100

# Logs from today
sudo journalctl -u wedding-webhook --since today
```

## Architecture

```
GitHub Push
    ↓
GitHub Actions (Build & Push Image)
    ↓
GitHub Webhook → Caddy → Webhook Server (port 9000)
    ↓
webhook-deploy.sh → deploy.sh
    ↓
git pull → docker compose pull → docker compose up
    ↓
✅ Deployed!
```
