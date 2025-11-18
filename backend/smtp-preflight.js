const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/**
 * Test SMTP connection on startup
 */
async function testSMTPConnection() {
  const logFile = path.join(__dirname, 'smtp-preflight.log');
  const logs = [];

  function log(message) {
    console.log(message);
    logs.push(message);
  }

  try {
    log('═══════════════════════════════════════════════');
    log('📧 Email Preflight Check');
    log('═══════════════════════════════════════════════');

    // Check if Resend API is configured (preferred)
    if (process.env.RESEND_API_KEY) {
      log('\n📋 Configuration:');
      log('   Method: Resend API');
      log(`   API Key: ${process.env.RESEND_API_KEY.substring(0, 10)}...`);
      log(`   From: ${process.env.EMAIL_FROM || 'noreply@fredericberg.de'}`);

      log('\n✅ Resend API configured!');
      log('   Email delivery is ready (HTTP API - bypasses SMTP port blocking).');
      log('═══════════════════════════════════════════════\n');

      fs.writeFileSync(logFile, logs.join('\n'));
      return;
    }

    // Check if SMTP is configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      log('⚠️  Email not configured');
      log('   Missing required environment variables.');
      log('\n   Option 1 (Recommended): Use Resend API');
      log('   - RESEND_API_KEY');
      log('   - EMAIL_FROM');
      log('\n   Option 2: Use SMTP');
      if (!process.env.SMTP_HOST) log('   - SMTP_HOST');
      if (!process.env.SMTP_USER) log('   - SMTP_USER');
      if (!process.env.SMTP_PASS) log('   - SMTP_PASS');
      log('\n   Photo download feature will not work.');
      log('   See PHOTO_SELECTION_FEATURE.md for setup instructions.');
      log('═══════════════════════════════════════════════\n');

      fs.writeFileSync(logFile, logs.join('\n'));
      return;
    }

    log(`\n📋 Configuration:`);
    log('   Method: SMTP');
    log(`   Host: ${process.env.SMTP_HOST}`);
    log(`   Port: ${process.env.SMTP_PORT || '587'}`);
    log(`   Secure: ${process.env.SMTP_SECURE || 'false'}`);
    log(`   User: ${process.env.SMTP_USER}`);
    log(`   From: ${process.env.EMAIL_FROM || process.env.SMTP_USER}`);

    // Create transporter
    log(`\n🔌 Testing SMTP connection...`);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    // Verify connection
    await transporter.verify();

    log('✅ SMTP connection successful!');
    log('   Email delivery is ready.');
    log('═══════════════════════════════════════════════\n');

    fs.writeFileSync(logFile, logs.join('\n'));
  } catch (error) {
    log(`\n❌ SMTP connection failed!`);
    log(`   Error: ${error.message}`);

    // Provide helpful hints based on error
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      log('\n💡 Troubleshooting:');
      log('   - SMTP port may be blocked by firewall');
      log('   - DigitalOcean blocks ports 25, 465, 587 by default');
      log('   - Try using SendGrid or another service');
      log('   - Contact your hosting provider to unblock SMTP ports');
    } else if (error.code === 'EAUTH' || error.message.includes('authentication')) {
      log('\n💡 Troubleshooting:');
      log('   - Check SMTP_USER and SMTP_PASS are correct');
      log('   - For Gmail, use App Password (not regular password)');
      log('   - Verify your email provider allows SMTP access');
    } else if (error.code === 'ECONNREFUSED') {
      log('\n💡 Troubleshooting:');
      log('   - Check SMTP_HOST and SMTP_PORT are correct');
      log('   - Verify SMTP_SECURE matches your port (true for 465, false for 587)');
    } else if (error.code === 'ENOTFOUND') {
      log('\n💡 Troubleshooting:');
      log('   - SMTP_HOST domain not found');
      log('   - Check for typos in SMTP_HOST');
    }

    log('\n   Photo download feature will not work until SMTP is configured correctly.');
    log('   See PHOTO_SELECTION_FEATURE.md for detailed setup instructions.');
    log('═══════════════════════════════════════════════\n');

    fs.writeFileSync(logFile, logs.join('\n'));
  }
}

module.exports = { testSMTPConnection };
