# Photo Selection & Download Feature

## Overview

The gallery now supports multi-select mode where users can select multiple photos and request a zip download via email.

## Features

- **Selection Mode**: Toggle button to enter/exit selection mode
- **Visual Feedback**: Checkboxes appear on photos in selection mode
- **Selection Limit**: Configurable maximum number of photos (default: 50)
- **Email Delivery**: Zip file is created on-the-fly and sent as email attachment
- **Progress Tracking**: Real-time selection counter

## Configuration

### Required Environment Variables

Add these to your `.env` file:

```bash
# Gallery Selection
MAX_PHOTO_SELECTION=50

# Email Configuration (for zip download delivery)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com
```

### SMTP Configuration Examples

#### Gmail
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.email@gmail.com
SMTP_PASS=your_app_password  # Use App Password, not regular password
EMAIL_FROM=your.email@gmail.com
```

**Note**: For Gmail, you need to generate an App Password:
1. Enable 2-factor authentication on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Generate an app password for "Mail"
4. Use that password in SMTP_PASS

#### SendGrid
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key
EMAIL_FROM=noreply@yourdomain.com
```

#### Custom SMTP
```bash
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your_password
EMAIL_FROM=noreply@yourdomain.com
```

## How It Works

### User Flow

1. **Enter Selection Mode**: User clicks "Select Photos" button on gallery page
2. **Select Photos**: Checkboxes appear on all photos; user clicks to select (up to MAX_PHOTO_SELECTION)
3. **Request Download**: User clicks "Request Download" button
4. **Enter Email**: Modal appears asking for email address
5. **Processing**: Server creates zip file and sends email
6. **Receive Email**: User receives email with zip attachment

### Backend Process

1. User submits photo selection with email
2. Server validates selection (max limit, valid photo IDs)
3. Server downloads selected photos from S3 using presigned URLs
4. Server creates zip archive in memory with maximum compression
5. Server sends email with zip as attachment
6. User receives email with all selected photos

### API Endpoint

**POST** `/api/download-zip`

Request body:
```json
{
  "photoIds": ["1", "2", "3"],
  "email": "user@example.com"
}
```

Response (success):
```json
{
  "success": true,
  "message": "Download link sent to your email!",
  "photoCount": 3
}
```

Response (error):
```json
{
  "error": "Error message"
}
```

## Files Modified

### Backend
- `backend/package.json` - Added nodemailer and archiver dependencies
- `backend/server.js` - Added /api/download-zip endpoint and config exposure
- `.env.example` - Added MAX_PHOTO_SELECTION and email config

### Frontend
- `frontend/gallery.html` - Added selection controls and email modal
- `frontend/gallery.js` - Implemented selection mode logic
- `frontend/gallery.css` - Added styling for selection UI

## Testing

### Local Testing

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure `.env` with SMTP credentials

3. Start server:
```bash
npm start
```

4. Test the flow:
   - Go to gallery page
   - Click "Select Photos"
   - Select a few photos
   - Click "Request Download"
   - Enter your email
   - Check your inbox for the zip file

### Testing Checklist

- [ ] Selection mode toggles correctly
- [ ] Checkboxes appear/disappear when toggling mode
- [ ] Selection counter updates correctly
- [ ] Maximum selection limit is enforced
- [ ] Download button is disabled when no photos selected
- [ ] Email modal opens when clicking download
- [ ] Email is sent successfully
- [ ] Zip file contains all selected photos
- [ ] Zip file has correct filenames
- [ ] Error handling works (invalid email, SMTP errors, etc.)

## Deployment

After testing locally:

1. Update production `.env` with SMTP credentials
2. Commit and push changes
3. GitHub Actions will build and deploy automatically
4. Verify SMTP credentials work in production environment

## Troubleshooting

### Email Not Sending

1. Check SMTP credentials in `.env`
2. Verify SMTP_HOST and SMTP_PORT are correct
3. For Gmail, ensure you're using App Password, not regular password
4. Check server logs for detailed error messages
5. Test SMTP connection with a simple nodemailer test script

### Zip Creation Fails

1. Check server memory limits (large selections may require more RAM)
2. Verify S3 presigned URLs are valid
3. Check network connectivity to S3
4. Review server logs for specific photo download errors

### Selection UI Not Working

1. Clear browser cache
2. Check browser console for JavaScript errors
3. Verify gallery.css and gallery.js are loaded correctly
4. Ensure selection mode is properly toggled

## Performance Considerations

- **Memory**: Zip is created in memory; large selections may consume significant RAM
- **Time**: Processing time increases with number of photos selected
- **Network**: Photos are downloaded from S3 to server, then sent via email
- **Email Size Limits**: Most email providers have attachment size limits (typically 25-50MB)

## Future Improvements

- [ ] Add download progress indicator
- [ ] Implement server-side zip caching
- [ ] Add option to upload zip to S3 and send link instead of attachment
- [ ] Support partial downloads (skip failed photos, continue with rest)
- [ ] Add user-friendly error messages for specific SMTP errors
- [ ] Implement rate limiting to prevent abuse
