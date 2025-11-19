# GitHub Webhook Auto-Deploy Setup

**Status:** 🔧 Configuration Guide
**Last Updated:** 2025-11-19

---

## Overview

This guide explains how to set up GitHub webhooks to automatically deploy your wedding photos app when you push to the main branch.

**Flow:**
```
Push to GitHub → GitHub Actions builds → Webhook notifies server → Deploy script runs → New version live
```

---

## Step 1: Generate Webhook Secret

Generate a secure random secret for GitHub webhook authentication:

```bash
openssl rand -hex 32
```

Example output:
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Save this value** - you'll need it in the next steps.

---

## Step 2: Set Up Environment Variables on Server

On your DigitalOcean droplet, set the webhook secret:

```bash
# SSH into your server
ssh root@your-server-ip

# Set the webhook secret
export WEBHOOK_SECRET="your-secret-from-above"

# Verify it's set
echo $WEBHOOK_SECRET
```

Or add it to your `.env` file if you have one:
```bash
WEBHOOK_SECRET=your-secret-from-above
WEBHOOK_PORT=9000
```

---

## Step 3: Start Webhook Server on Droplet

The webhook server runs on port 9000 and listens for GitHub events.

### Option A: Run as Background Service (Recommended)

Create a systemd service:

```bash
# Create service file
sudo nano /etc/systemd/system/webhook.service
```

Paste this content:

```ini
[Unit]
Description=GitHub Webhook Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/docker/wedding-photos
Environment="WEBHOOK_SECRET=your-secret-from-above"
Environment="WEBHOOK_PORT=9000"
ExecStart=/usr/bin/node /opt/docker/wedding-photos/webhook-server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable webhook.service
sudo systemctl start webhook.service

# Check status
sudo systemctl status webhook.service

# View logs
sudo journalctl -u webhook.service -f
```

### Option B: Run in Docker (Alternative)

If you prefer Docker, create a `webhook-Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY webhook-server.js .

EXPOSE 9000

CMD ["node", "webhook-server.js"]
```

Then:

```bash
docker build -f webhook-Dockerfile -t wedding-webhook .
docker run -d \
  --name webhook \
  -e WEBHOOK_SECRET=your-secret \
  -p 9000:9000 \
  wedding-webhook
```

### Option C: Manual Test (Debugging)

For testing purposes, run directly:

```bash
cd /opt/docker/wedding-photos
export WEBHOOK_SECRET="your-secret"
node webhook-server.js
```

---

## Step 4: Configure Caddy to Proxy Webhook

Update your Caddy configuration to route `/webhook` requests to port 9000.

```bash
# Edit Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Add this to your `fredericberg.de` block:

```caddy
fredericberg.de {
    # Webhook endpoint for GitHub
    handle /webhook {
        reverse_proxy localhost:9000
    }

    # Your existing configuration...
    # (main app, etc.)
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

---

## Step 5: Configure GitHub Webhook

1. Go to your GitHub repository: `https://github.com/frdrcbrg/wedding-photos`
2. Click **Settings** → **Webhooks** → **Add webhook**
3. Fill in the form:

| Field | Value |
|-------|-------|
| **Payload URL** | `https://fredericberg.de/webhook` |
| **Content type** | `application/json` |
| **Secret** | Your secret from Step 1 |
| **Events** | `Workflow runs` |
| **Active** | ✅ Checked |

4. Click **Add webhook**

---

## Step 6: Test the Webhook

### Health Check

```bash
curl https://fredericberg.de/webhook/health
```

Should return: `Webhook server is running`

### Manual Webhook Test (from GitHub)

1. Go to your webhook settings on GitHub
2. Scroll to the webhook you created
3. Click **Recent Deliveries**
4. Click the most recent delivery
5. Click **Redeliver**

Check the webhook server logs:

```bash
# If using systemd
sudo journalctl -u webhook.service -f

# If running manually, check the console output
```

You should see:
```
📨 [timestamp] - POST /webhook
   Received webhook payload (XXXX bytes)
   GitHub Event: workflow_run
   Event Action: completed
   Workflow: Build and Deploy
   Conclusion: success
✅ Signature verified
✅ Workflow "Build and Deploy" completed successfully
🚀 Triggering deployment script...
```

---

## Troubleshooting

### Webhook Not Triggering

**Symptom:** Webhook appears in "Recent Deliveries" but nothing happens

**Solutions:**
1. Check that `WEBHOOK_SECRET` matches GitHub's secret exactly
2. Verify webhook server is running: `curl https://fredericberg.de/webhook/health`
3. Check logs for signature mismatch errors
4. Ensure the workflow is completing successfully (check GitHub Actions tab)

### "Invalid Signature" Error

**Symptom:** Logs show `Invalid signature - rejecting webhook`

**Cause:** The `WEBHOOK_SECRET` environment variable doesn't match the GitHub webhook secret

**Fix:**
1. Generate new secret: `openssl rand -hex 32`
2. Update GitHub webhook with new secret
3. Update server environment variable
4. Restart webhook server: `sudo systemctl restart webhook.service`

### Deploy Script Not Executing

**Symptom:** Webhook shows success but `deploy.sh` doesn't run

**Solutions:**
1. Check `webhook-deploy.sh` exists: `ls -la webhook-deploy.sh`
2. Verify executable: `chmod +x webhook-deploy.sh`
3. Check `deploy.sh` exists and is executable
4. Check logs for deploy script errors

### Port 9000 Already in Use

**Symptom:** Error binding to port 9000

**Solution:**
```bash
# Find process using port 9000
sudo lsof -i :9000

# Kill it
sudo kill -9 <PID>

# Or change WEBHOOK_PORT in environment
export WEBHOOK_PORT=9001
```

---

## Monitoring

### Check Webhook Server Status

```bash
# Using systemd
sudo systemctl status webhook.service

# Check if port is listening
netstat -tulpn | grep 9000

# Test health endpoint
curl -v https://fredericberg.de/webhook/health
```

### View Recent Deployments

```bash
# Check recent systemd logs
sudo journalctl -u webhook.service -n 50

# Or check deployment logs
cat deploy.log
```

---

## Security Notes

⚠️ **Important:**

1. **Always use a strong secret** - don't use `change-me-in-production`
2. **Keep secret in `.env` file** - don't commit to git
3. **Use HTTPS only** - GitHub webhooks will fail if not HTTPS
4. **Validate signatures** - webhook server already does this
5. **Set proper permissions** - `chmod 755 webhook-deploy.sh`

---

## Full Setup Checklist

- [ ] Generated webhook secret with `openssl rand -hex 32`
- [ ] Set `WEBHOOK_SECRET` environment variable on server
- [ ] Started webhook server (systemd or Docker)
- [ ] Configured Caddy to proxy `/webhook` to port 9000
- [ ] Reloaded Caddy configuration
- [ ] Created webhook in GitHub with correct URL and secret
- [ ] Tested health endpoint: `curl https://fredericberg.de/webhook/health`
- [ ] Tested webhook delivery from GitHub
- [ ] Verified deployment log shows success
- [ ] Confirmed new app version is live

---

## Quick Reference

### View webhook server logs
```bash
sudo journalctl -u webhook.service -f
```

### Restart webhook server
```bash
sudo systemctl restart webhook.service
```

### Check if port 9000 is listening
```bash
sudo netstat -tulpn | grep 9000
```

### Test webhook manually
```bash
curl -X POST https://fredericberg.de/webhook/health
```

### View recent deployments
```bash
tail -50 /var/log/deployment.log
```

---

## GitHub Actions Workflow Integration

Your `.github/workflows/deploy.yml` already triggers this webhook on successful builds. The workflow:

1. Builds Docker image
2. Pushes to GitHub Container Registry
3. **Sends workflow_run webhook** ← Triggers your webhook server
4. Webhook server runs `deploy.sh`
5. Deploy script pulls new image and restarts containers

No additional GitHub Actions configuration needed!

---

## Next Steps

Once the webhook is working:

1. Push a change to main branch
2. Watch GitHub Actions build
3. Webhook automatically deploys on success
4. Check your live site for updates

You should never need to manually deploy again!
