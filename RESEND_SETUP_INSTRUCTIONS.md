# Resend Email Setup Instructions

## Why Resend?

DigitalOcean blocks SMTP ports (25, 465, 587) by default to prevent spam. Resend uses HTTP APIs instead, completely bypassing this limitation.

## Setup Steps

### 1. Create Resend Account

1. Go to [resend.com](https://resend.com)
2. Sign up for a free account
3. Verify your email address

### 2. Add Your Domain

1. In Resend dashboard, go to **Domains**
2. Click **Add Domain**
3. Enter your domain: `fredericberg.de`
4. Resend will provide DNS records to add

### 3. Configure DNS (Cloudflare)

Add these DNS records in your Cloudflare dashboard for `fredericberg.de`:

Resend will show you records similar to these (use the exact values from Resend):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| TXT | `@` or `fredericberg.de` | `resend-verification-code-here` | Auto |
| MX | `@` or `fredericberg.de` | `feedback-smtp.resend.com` | Auto |
| TXT | `resend._domainkey` | `resend-dkim-key-here` | Auto |

**Note:**
- Set **Proxy status** to **DNS only** (gray cloud) for all Resend records
- DNS propagation can take a few minutes

### 4. Verify Domain in Resend

1. After adding DNS records, go back to Resend dashboard
2. Click **Verify** on your domain
3. Wait for verification to complete (usually instant if DNS is set up correctly)

### 5. Generate API Key

1. In Resend dashboard, go to **API Keys**
2. Click **Create API Key**
3. Name it: `wedding-photos-production`
4. Select permissions: **Sending access**
5. Click **Create**
6. **Copy the API key** (starts with `re_...`)
   - You won't be able to see it again!

### 6. Update .env on Droplet

SSH into your droplet:

```bash
ssh root@your_droplet_ip
cd /opt/docker/wedding-photos
```

Edit the `.env` file:

```bash
nano .env
```

Add or update these lines:

```env
# Resend API Configuration
RESEND_API_KEY=re_your_actual_api_key_here
EMAIL_FROM=noreply@fredericberg.de
```

**Important:**
- Replace `re_your_actual_api_key_here` with your actual Resend API key
- You can use any email address at your domain for `EMAIL_FROM`, but `noreply@` is recommended

Save the file (Ctrl+O, Enter, Ctrl+X)

### 7. Deploy the Changes

The latest code already includes Resend support. Just restart the containers:

```bash
./deploy.sh
```

Or manually:

```bash
docker compose down
docker compose up -d
```

### 8. Verify Email is Working

Check the startup logs:

```bash
docker compose logs | grep "Email Preflight"
```

You should see:

```
📧 Email Preflight Check
═══════════════════════════════════════════════

📋 Configuration:
   Method: Resend API
   API Key: re_xxxxxxx...
   From: noreply@fredericberg.de

✅ Resend API configured!
   Email delivery is ready (HTTP API - bypasses SMTP port blocking).
═══════════════════════════════════════════════
```

### 9. Test Photo Download Feature

1. Go to your wedding app gallery
2. Enable selection mode
3. Select a few photos
4. Click "Request Download"
5. Enter your email address
6. Check your inbox for the zip file

## Troubleshooting

### "Domain not verified" error

- Check DNS records in Cloudflare
- Ensure records are set to **DNS only** (not proxied)
- Wait a few minutes for DNS propagation
- Try verifying again in Resend dashboard

### "Invalid API key" error

- Make sure you copied the full API key (starts with `re_`)
- Check for extra spaces in the `.env` file
- Regenerate a new API key if needed

### Email not arriving

- Check spam folder
- Verify domain is fully verified in Resend
- Check Resend dashboard for delivery logs
- Check container logs: `docker compose logs -f`

### Still showing "SMTP not configured"

- Make sure `RESEND_API_KEY` is in your `.env` file
- Verify it's passed to container: `docker compose config | grep RESEND`
- Restart containers: `docker compose restart`

## Free Tier Limits

Resend free tier includes:
- **3,000 emails per month**
- **100 emails per day**
- **1 verified domain**

This should be more than enough for a wedding photo app!

## Next Steps After Setup

Once Resend is configured, you can:
- Remove SMTP settings from `.env` (they won't be used)
- Test the photo download feature thoroughly
- Invite guests to use the app

## Support

If you need help:
- Resend docs: [resend.com/docs](https://resend.com/docs)
- Resend support: support@resend.com
- Domain verification guide: [resend.com/docs/dashboard/domains/introduction](https://resend.com/docs/dashboard/domains/introduction)
