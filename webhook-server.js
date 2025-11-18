const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const DEPLOY_SCRIPT = path.join(__dirname, 'webhook-deploy.sh');

// Create HTTP server
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        console.log(`\n📨 Webhook received at ${new Date().toISOString()}`);
        console.log(`   Headers: ${JSON.stringify(req.headers, null, 2)}`);

        // Verify GitHub signature
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
          console.log('❌ No signature provided');
          res.writeHead(401);
          res.end('No signature provided');
          return;
        }

        const hmac = crypto.createHmac('sha256', SECRET);
        const digest = 'sha256=' + hmac.update(body).digest('hex');

        if (signature !== digest) {
          console.log('❌ Invalid signature');
          console.log(`   Expected: ${digest}`);
          console.log(`   Received: ${signature}`);
          res.writeHead(401);
          res.end('Invalid signature');
          return;
        }

        console.log('✅ Signature verified');

        // Parse payload
        const payload = JSON.parse(body);
        console.log(`   Event: ${req.headers['x-github-event']}`);
        console.log(`   Action: ${payload.action}`);
        console.log(`   Workflow: ${payload.workflow_run?.name}`);
        console.log(`   Conclusion: ${payload.workflow_run?.conclusion}`);

        // Only trigger on successful workflow runs
        if (payload.action === 'completed' && payload.workflow_run?.conclusion === 'success') {
          console.log(`✅ Workflow "${payload.workflow_run.name}" completed successfully`);
          console.log(`🚀 Triggering deployment...`);

          // Execute deploy script
          exec(`${DEPLOY_SCRIPT} WEBHOOK_TRIGGERED`, (error, stdout, stderr) => {
            if (error) {
              console.error(`❌ Deploy failed: ${error.message}`);
              console.error(stderr);
            } else {
              console.log(`✅ Deploy completed successfully`);
              console.log(stdout);
            }
          });

          res.writeHead(200);
          res.end('Deployment triggered');
        } else {
          res.writeHead(200);
          res.end('Event ignored');
        }
      } catch (error) {
        console.error('Error processing webhook:', error);
        res.writeHead(500);
        res.end('Internal server error');
      }
    });
  } else {
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
