// ===== Configuration =====
const API_BASE = window.location.origin;
const ITEMS_PER_PAGE = 20;

// ===== DOM Elements =====
const accessModal = document.getElementById('accessModal');
const mainContent = document.getElementById('mainContent');
const accessForm = document.getElementById('accessForm');
const accessCodeInput = document.getElementById('accessCodeInput');
const accessError = document.getElementById('accessError');

const gallery = document.getElementById('gallery');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const loadMoreBtn = document.getElementById('loadMoreBtn');

const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxVideo = document.getElementById('lightboxVideo');
const lightboxName = document.getElementById('lightboxName');
const lightboxMessage = document.getElementById('lightboxMessage');
const lightboxDate = document.getElementById('lightboxDate');
const closeLightbox = document.getElementById('closeLightbox');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');

const totalUploads = document.getElementById('totalUploads');
const photoCount = document.getElementById('photoCount');
const videoCount = document.getElementById('videoCount');

// ===== State =====
let isAuthenticated = false;
let allPhotos = [];
let displayedPhotos = [];
let currentPhotoIndex = -1;
let loadedCount = 0;
let isLoading = false;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  // Check if already authenticated
  const savedCode = sessionStorage.getItem('accessCode');
  if (savedCode) {
    verifyAccess(savedCode, true);
  }

  // Event listeners
  accessForm.addEventListener('submit', handleAccessSubmit);
  loadMoreBtn.addEventListener('click', loadMorePhotos);
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

  // Intersection Observer for lazy loading images
  setupLazyLoading();
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
      await loadGallery();
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

// ===== Gallery Loading =====
async function loadGallery() {
  try {
    const response = await fetch(`${API_BASE}/api/photos`);

    if (!response.ok) {
      throw new Error('Failed to load gallery');
    }

    allPhotos = await response.json();
    displayedPhotos = [];
    loadedCount = 0;

    if (allPhotos.length === 0) {
      gallery.innerHTML = `
        <div class="empty-gallery">
          <p>No memories shared yet</p>
          <p style="font-size: 0.9em; margin-top: 10px;">Upload some photos to get started!</p>
        </div>
      `;
      return;
    }

    // Initial load
    gallery.innerHTML = '';
    loadMorePhotos();

  } catch (error) {
    console.error('Gallery loading error:', error);
    gallery.innerHTML = `
      <div class="loading">
        Failed to load gallery. Please refresh the page.
      </div>
    `;
  }
}

function loadMorePhotos() {
  if (isLoading) return;

  isLoading = true;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';

  const photosToLoad = allPhotos.slice(loadedCount, loadedCount + ITEMS_PER_PAGE);

  photosToLoad.forEach(photo => {
    const photoElement = createGalleryItem(photo);
    gallery.insertAdjacentHTML('beforeend', photoElement);
    displayedPhotos.push(photo);
  });

  loadedCount += photosToLoad.length;

  // Add click listeners to newly added items
  const items = gallery.querySelectorAll('.gallery-item');
  items.forEach((item, index) => {
    if (index >= loadedCount - photosToLoad.length) {
      item.addEventListener('click', () => {
        const photoId = item.dataset.id;
        const photoIndex = displayedPhotos.findIndex(p => p.id == photoId);
        openLightbox(photoIndex);
      });
    }
  });

  // Show/hide load more button
  if (loadedCount >= allPhotos.length) {
    loadMoreContainer.classList.add('hidden');
  } else {
    loadMoreContainer.classList.remove('hidden');
  }

  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = 'Load More';
  isLoading = false;
}

function createGalleryItem(photo) {
  const isVideo = photo.file_type === 'video';
  const thumbnailUrl = photo.thumbnail_url || photo.s3_url;

  const mediaTag = isVideo
    ? `<video src="${thumbnailUrl}" muted></video>`
    : `<img data-src="${thumbnailUrl}" alt="${photo.filename}" class="lazy">`;

  const videoIndicator = isVideo ? '<div class="video-indicator">▶</div>' : '';

  return `
    <div class="gallery-item" data-id="${photo.id}">
      ${videoIndicator}
      ${mediaTag}
    </div>
  `;
}

// ===== Lazy Loading Setup =====
function setupLazyLoading() {
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const src = img.dataset.src;

        if (src) {
          img.src = src;
          img.classList.remove('lazy');
          img.classList.add('loaded');
          observer.unobserve(img);
        }
      }
    });
  }, {
    rootMargin: '50px' // Start loading 50px before image enters viewport
  });

  // Observe all lazy images
  const observeLazyImages = () => {
    document.querySelectorAll('img.lazy').forEach(img => {
      imageObserver.observe(img);
    });
  };

  // Initial observation
  observeLazyImages();

  // Re-observe when new images are added
  const mutationObserver = new MutationObserver(() => {
    observeLazyImages();
  });

  mutationObserver.observe(gallery, {
    childList: true,
    subtree: true
  });
}

// ===== Stats Loading =====
async function loadStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`);

    if (!response.ok) {
      throw new Error('Failed to load stats');
    }

    const stats = await response.json();

    totalUploads.textContent = stats.total_uploads || 0;
    photoCount.textContent = stats.photo_count || 0;
    videoCount.textContent = stats.video_count || 0;

  } catch (error) {
    console.error('Stats loading error:', error);
  }
}

// ===== Lightbox =====
function openLightbox(photoIndex) {
  if (photoIndex < 0 || photoIndex >= displayedPhotos.length) return;

  currentPhotoIndex = photoIndex;
  const photo = displayedPhotos[photoIndex];
  const isVideo = photo.file_type === 'video';

  if (isVideo) {
    lightboxImage.style.display = 'none';
    lightboxVideo.style.display = 'block';
    lightboxVideo.src = photo.s3_url;
  } else {
    lightboxVideo.style.display = 'none';
    lightboxImage.style.display = 'block';
    lightboxImage.src = photo.s3_url;
  }

  lightboxName.textContent = photo.uploaded_by || 'Anonymous';
  lightboxMessage.textContent = photo.message || '';
  lightboxDate.textContent = formatDate(photo.uploaded_at);

  // Hide message if empty
  if (!photo.message) {
    lightboxMessage.style.display = 'none';
  } else {
    lightboxMessage.style.display = 'block';
  }

  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Preload next and previous images for faster navigation
  preloadAdjacentImages(photoIndex);
}

// Preload next and previous images
function preloadAdjacentImages(currentIndex) {
  const nextIndex = (currentIndex + 1) % displayedPhotos.length;
  const prevIndex = currentIndex === 0 ? displayedPhotos.length - 1 : currentIndex - 1;

  // Preload next image
  if (displayedPhotos[nextIndex] && displayedPhotos[nextIndex].file_type === 'photo') {
    const nextImg = new Image();
    nextImg.src = displayedPhotos[nextIndex].s3_url;
  }

  // Preload previous image
  if (displayedPhotos[prevIndex] && displayedPhotos[prevIndex].file_type === 'photo') {
    const prevImg = new Image();
    prevImg.src = displayedPhotos[prevIndex].s3_url;
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
  if (displayedPhotos.length === 0) return;

  let newIndex = currentPhotoIndex + direction;

  // Wrap around
  if (newIndex < 0) {
    newIndex = displayedPhotos.length - 1;
  } else if (newIndex >= displayedPhotos.length) {
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
  const swipeThreshold = 50;
  const diff = touchStartX - touchEndX;

  if (Math.abs(diff) > swipeThreshold) {
    if (diff > 0) {
      nextPhoto();
    } else {
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
