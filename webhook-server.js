const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const DEPLOY_SCRIPT = path.join(__dirname, 'webhook-deploy.sh');

// Verify deploy script exists
if (!fs.existsSync(DEPLOY_SCRIPT)) {
  console.error(`❌ Deploy script not found: ${DEPLOY_SCRIPT}`);
  process.exit(1);
}

// Make deploy script executable
try {
  fs.chmodSync(DEPLOY_SCRIPT, 0o755);
  console.log(`✅ Deploy script permissions set`);
} catch (err) {
  console.error(`⚠️  Could not set script permissions: ${err.message}`);
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Log all requests
  console.log(`\n📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);

  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    console.log('✅ Health check');
    res.writeHead(200);
    res.end('Webhook server is running');
    return;
  }

  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        console.log(`   Received webhook payload (${body.length} bytes)`);
        console.log(`   GitHub Event: ${req.headers['x-github-event']}`);

        // Check if SECRET is still default
        if (SECRET === 'change-me-in-production') {
          console.warn('⚠️  WEBHOOK_SECRET is still set to default! This is a security risk.');
        }

        // Verify GitHub signature
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
          console.log('❌ No signature provided - rejecting webhook');
          res.writeHead(401);
          res.end('No signature provided');
          return;
        }

        const hmac = crypto.createHmac('sha256', SECRET);
        const digest = 'sha256=' + hmac.update(body).digest('hex');

        if (signature !== digest) {
          console.log('❌ Invalid signature - rejecting webhook');
          console.log(`   Expected: ${digest.substring(0, 20)}...`);
          console.log(`   Received: ${signature.substring(0, 20)}...`);
          console.log(`   Hint: Check that WEBHOOK_SECRET matches GitHub webhook secret`);
          res.writeHead(401);
          res.end('Invalid signature');
          return;
        }

        console.log('✅ Signature verified');

        // Parse payload
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (e) {
          console.error('❌ Failed to parse JSON payload:', e.message);
          res.writeHead(400);
          res.end('Invalid JSON');
          return;
        }

        console.log(`   Event Action: ${payload.action}`);
        console.log(`   Workflow: ${payload.workflow_run?.name}`);
        console.log(`   Conclusion: ${payload.workflow_run?.conclusion}`);
        console.log(`   Branch: ${payload.workflow_run?.head_branch}`);

        // Only trigger on successful workflow runs
        if (payload.action === 'completed' && payload.workflow_run?.conclusion === 'success') {
          console.log(`✅ Workflow "${payload.workflow_run.name}" completed successfully`);
          console.log(`🚀 Triggering deployment script...`);

          // Execute deploy script with proper error handling
          const child = exec(`bash ${DEPLOY_SCRIPT} WEBHOOK_TRIGGERED`, {
            cwd: __dirname,
            timeout: 300000 // 5 minute timeout
          }, (error, stdout, stderr) => {
            if (error) {
              console.error(`❌ Deploy script failed with exit code ${error.code}`);
              if (stderr) console.error(`stderr: ${stderr}`);
              if (stdout) console.log(`stdout: ${stdout}`);
            } else {
              console.log(`✅ Deploy script completed successfully`);
              if (stdout) console.log(stdout);
            }
          });

          // Log deployment start
          console.log(`   Process PID: ${child.pid}`);

          res.writeHead(200);
          res.end('Deployment triggered');
        } else {
          console.log(`⏭️  Event ignored (action: ${payload.action}, conclusion: ${payload.workflow_run?.conclusion})`);
          res.writeHead(200);
          res.end('Event ignored');
        }
      } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.writeHead(500);
        res.end('Internal server error');
      }
    });
  } else {
    console.log(`⚠️  Unknown endpoint`);
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  const secretPreview = SECRET.substring(0, 10);
  console.log(`
╔═══════════════════════════════════════════════╗
║       🪝 Webhook Server Running               ║
╚═══════════════════════════════════════════════╝

📡 Listening on port ${PORT}
🔒 Using secret: ${secretPreview}...

Waiting for GitHub webhooks...
  `);
});
