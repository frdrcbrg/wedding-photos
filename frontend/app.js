// ===== Configuration =====
const API_BASE = window.location.origin;

// ===== DOM Elements =====
const accessModal = document.getElementById('accessModal');
const mainContent = document.getElementById('mainContent');
const accessForm = document.getElementById('accessForm');
const accessCodeInput = document.getElementById('accessCodeInput');
const accessError = document.getElementById('accessError');

const uploadModal = document.getElementById('uploadModal');
const uploadModalFileCount = document.getElementById('uploadModalFileCount');
const fileInput = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const progressFill = document.getElementById('progressFill');
const uploadStatus = document.getElementById('uploadStatus');

const gallery = document.getElementById('gallery');
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxVideo = document.getElementById('lightboxVideo');
const lightboxDownload = document.getElementById('lightboxDownload');
const closeLightbox = document.getElementById('closeLightbox');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');

const totalUploads = document.getElementById('totalUploads');
const photoCount = document.getElementById('photoCount');
const videoCount = document.getElementById('videoCount');

// ===== State =====
let isAuthenticated = false;
let currentPhotos = [];
let currentPhotoIndex = -1;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
  // Check if access code is required
  try {
    const configResponse = await fetch(`${API_BASE}/api/config`);
    const config = await configResponse.json();

    if (!config.requireAccessCode) {
      // Access code not required, skip login and load content directly
      isAuthenticated = true;
      accessModal.classList.add('hidden');
      mainContent.classList.remove('hidden');
      loadGallery();
      loadStats();
    } else {
      // Check if already authenticated
      const savedCode = sessionStorage.getItem('accessCode');
      if (savedCode) {
        verifyAccess(savedCode, true);
      }
    }
  } catch (error) {
    console.error('Error fetching config:', error);
    // Fall back to checking saved code
    const savedCode = sessionStorage.getItem('accessCode');
    if (savedCode) {
      verifyAccess(savedCode, true);
    }
  }

  // Event listeners
  accessForm.addEventListener('submit', handleAccessSubmit);
  fileInput.addEventListener('change', handleFileSelect);
  closeLightbox.addEventListener('click', closeLightboxModal);
  lightboxPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    previousPhoto();
  });
  lightboxNext.addEventListener('click', (e) => {
    e.stopPropagation();
    nextPhoto();
  });
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightboxModal();
  });
});

// ===== Access Control =====
async function handleAccessSubmit(e) {
  e.preventDefault();
  const code = accessCodeInput.value.trim();
  await verifyAccess(code);
}

async function verifyAccess(code, silent = false) {
  try {
    const response = await fetch(`${API_BASE}/api/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = await response.json();

    if (response.ok) {
      // Access granted
      isAuthenticated = true;
      sessionStorage.setItem('accessCode', code);
      accessModal.classList.add('hidden');
      mainContent.classList.remove('hidden');

      // Load content
      loadGallery();
      loadStats();
    } else {
      if (!silent) {
        accessError.textContent = data.error || 'Invalid access code';
        accessCodeInput.value = '';
        accessCodeInput.focus();
      }
    }
  } catch (error) {
    console.error('Access verification error:', error);
    if (!silent) {
      accessError.textContent = 'Connection error. Please try again.';
    }
  }
}

// ===== File Selection =====
async function handleFileSelect(e) {
  const files = Array.from(e.target.files);

  if (files.length === 0) {
    return;
  }

  // Validate file sizes (max 100MB per file)
  const maxSize = 100 * 1024 * 1024; // 100MB
  const oversizedFiles = files.filter(file => file.size > maxSize);
  if (oversizedFiles.length > 0) {
    alert('Some files are too large. Maximum file size is 100MB.');
    fileInput.value = '';
    return;
  }

  // Start upload immediately
  await startUploadProcess(files);
}

async function startUploadProcess(files) {
  // Show upload modal with progress
  const fileCount = files.length === 1 ? 'Uploading 1 file...' : `Uploading ${files.length} files...`;
  uploadModalFileCount.textContent = fileCount;
  uploadModal.classList.remove('hidden');
  progressFill.style.width = '0%';
  document.body.style.overflow = 'hidden';

  try {
    const totalFiles = files.length;
    let completedFiles = 0;

    for (const file of files) {
      uploadStatus.textContent = `Uploading ${completedFiles + 1} of ${totalFiles}...`;

      await uploadFile(file);

      completedFiles++;
      const progress = (completedFiles / totalFiles) * 100;
      progressFill.style.width = `${progress}%`;
    }

    // Success!
    uploadStatus.textContent = '✨ Upload complete! Thank you for sharing.';
    progressFill.style.width = '100%';

    // Reset and close modal
    setTimeout(() => {
      uploadModal.classList.add('hidden');
      document.body.style.overflow = 'auto';
      fileInput.value = '';

      // Reload gallery
      loadGallery();
      loadStats();
    }, 2000);

  } catch (error) {
    console.error('Upload error:', error);
    uploadStatus.textContent = '❌ Upload failed. Please try again.';

    setTimeout(() => {
      uploadModal.classList.add('hidden');
      document.body.style.overflow = 'auto';
      fileInput.value = '';
    }, 3000);
  }
}

// ===== Upload Handling =====
async function uploadFile(file) {
  // Step 1: Get presigned URL from backend
  const urlResponse = await fetch(`${API_BASE}/api/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
    }),
  });

  if (!urlResponse.ok) {
    const error = await urlResponse.json();
    throw new Error(error.error || 'Failed to get upload URL');
  }

  const { uploadUrl, s3Key, publicUrl, fileType } = await urlResponse.json();

  // Step 2: Upload file directly to S3
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error('Failed to upload file to storage');
  }

  // Step 3: Confirm upload with backend
  const confirmResponse = await fetch(`${API_BASE}/api/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      s3Key: s3Key,
      s3Url: publicUrl,
      fileType: fileType,
      uploadedBy: null,
      message: null,
    }),
  });

  if (!confirmResponse.ok) {
    throw new Error('Failed to confirm upload');
  }

  return await confirmResponse.json();
}

// ===== Gallery Loading =====
async function loadGallery() {
  try {
    const response = await fetch(`${API_BASE}/api/photos`);

    if (!response.ok) {
      throw new Error('Failed to load gallery');
    }

    const photos = await response.json();
    currentPhotos = photos; // Store for navigation

    // Create camera tile as first item
    const cameraTile = `
      <div class="gallery-item camera-tile" id="cameraTile">
        <div class="camera-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          <p>Add Photos</p>
        </div>
      </div>
    `;

    if (photos.length === 0) {
      gallery.innerHTML = cameraTile + `
        <div class="empty-gallery" style="grid-column: 1 / -1;">
          <p>No memories shared yet</p>
          <p style="font-size: 0.9em; margin-top: 10px;">Be the first to share a special moment!</p>
        </div>
      `;
    } else {
      gallery.innerHTML = cameraTile + photos.map(photo => createGalleryItem(photo)).join('');
    }

    // Add camera tile click listener
    const cameraTileEl = document.getElementById('cameraTile');
    cameraTileEl.addEventListener('click', () => {
      fileInput.click();
    });

    // Add click listeners for photos
    document.querySelectorAll('.gallery-item:not(.camera-tile)').forEach(item => {
      item.addEventListener('click', () => {
        const photoId = item.dataset.id;
        const photoIndex = photos.findIndex(p => p.id == photoId);
        openLightbox(photoIndex);
      });
    });

  } catch (error) {
    console.error('Gallery loading error:', error);
    gallery.innerHTML = `
      <div class="loading">
        Failed to load gallery. Please refresh the page.
      </div>
    `;
  }
}

function createGalleryItem(photo) {
  const isVideo = photo.file_type === 'video';

  // Use thumbnail URL for gallery, full URL for lightbox
  const thumbnailUrl = photo.thumbnail_url || photo.s3_url;

  const mediaTag = isVideo
    ? `<video src="${thumbnailUrl}" muted></video>`
    : `<img src="${thumbnailUrl}" alt="${photo.filename}" loading="lazy">`;

  const videoIndicator = isVideo ? '<div class="video-indicator">▶</div>' : '';

  const displayName = photo.uploaded_by || 'Anonymous';
  const displayMessage = photo.message || '';
  const displayDate = formatDate(photo.uploaded_at);

  return `
    <div class="gallery-item" data-id="${photo.id}">
      ${videoIndicator}
      ${mediaTag}
      <div class="gallery-item-overlay">
        <div class="gallery-item-name">${escapeHtml(displayName)}</div>
        ${displayMessage ? `<div class="gallery-item-message">${escapeHtml(displayMessage)}</div>` : ''}
        <div class="gallery-item-date">${displayDate}</div>
      </div>
    </div>
  `;
}

// ===== Stats Loading =====
async function loadStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`);

    if (!response.ok) {
      throw new Error('Failed to load stats');
    }

    const stats = await response.json();

    // Force numeric conversion and default to 0
    const totalCount = parseInt(stats.total_uploads) || 0;
    const photosCnt = parseInt(stats.photo_count) || 0;
    const videosCnt = parseInt(stats.video_count) || 0;

    totalUploads.textContent = totalCount;
    photoCount.textContent = photosCnt;
    videoCount.textContent = videosCnt;

  } catch (error) {
    console.error('Stats loading error:', error);
    // Set to 0 on error
    totalUploads.textContent = 0;
    photoCount.textContent = 0;
    videoCount.textContent = 0;
  }
}

// ===== Lightbox =====
function openLightbox(photoIndex) {
  if (photoIndex < 0 || photoIndex >= currentPhotos.length) return;

  currentPhotoIndex = photoIndex;
  const photo = currentPhotos[photoIndex];
  const isVideo = photo.file_type === 'video';

  if (isVideo) {
    lightboxImage.style.display = 'none';
    lightboxVideo.style.display = 'block';
    lightboxVideo.src = photo.s3_url;
    lightboxDownload.href = photo.s3_url;
    lightboxDownload.download = photo.filename;
  } else {
    lightboxVideo.style.display = 'none';
    lightboxImage.style.display = 'block';
    lightboxImage.src = photo.s3_url;
    lightboxDownload.href = photo.s3_url;
    lightboxDownload.download = photo.filename;
  }

  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Preload next and previous images for faster navigation
  preloadAdjacentImages(photoIndex);
}

// Preload next and previous images
function preloadAdjacentImages(currentIndex) {
  const nextIndex = (currentIndex + 1) % currentPhotos.length;
  const prevIndex = currentIndex === 0 ? currentPhotos.length - 1 : currentIndex - 1;

  // Preload next image
  if (currentPhotos[nextIndex] && currentPhotos[nextIndex].file_type === 'photo') {
    const nextImg = new Image();
    nextImg.src = currentPhotos[nextIndex].s3_url;
  }

  // Preload previous image
  if (currentPhotos[prevIndex] && currentPhotos[prevIndex].file_type === 'photo') {
    const prevImg = new Image();
    prevImg.src = currentPhotos[prevIndex].s3_url;
  }
}

function closeLightboxModal() {
  lightbox.classList.add('hidden');
  lightboxVideo.pause();
  lightboxVideo.src = '';
  document.body.style.overflow = 'auto';
  currentPhotoIndex = -1;
}

function navigateToPhoto(direction) {
  if (currentPhotos.length === 0) return;

  let newIndex = currentPhotoIndex + direction;

  // Wrap around
  if (newIndex < 0) {
    newIndex = currentPhotos.length - 1;
  } else if (newIndex >= currentPhotos.length) {
    newIndex = 0;
  }

  openLightbox(newIndex);
}

function nextPhoto() {
  navigateToPhoto(1);
}

function previousPhoto() {
  navigateToPhoto(-1);
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('hidden')) return;

  if (e.key === 'Escape') {
    closeLightboxModal();
  } else if (e.key === 'ArrowLeft') {
    previousPhoto();
  } else if (e.key === 'ArrowRight') {
    nextPhoto();
  }
});

// Touch/Swipe support
let touchStartX = 0;
let touchEndX = 0;

lightbox.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

lightbox.addEventListener('touchend', (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
}, { passive: true });

function handleSwipe() {
  const swipeThreshold = 50; // Minimum swipe distance in pixels
  const diff = touchStartX - touchEndX;

  if (Math.abs(diff) > swipeThreshold) {
    if (diff > 0) {
      // Swiped left - show next
      nextPhoto();
    } else {
      // Swiped right - show previous
      previousPhoto();
    }
  }
}

// ===== Utility Functions =====
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Service Worker (Optional - for offline support) =====
if ('serviceWorker' in navigator) {
  // Uncomment to enable service worker
  // navigator.serviceWorker.register('/sw.js');
}
