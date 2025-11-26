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
const lightboxDownload = document.getElementById('lightboxDownload');
const lightboxSelect = document.getElementById('lightboxSelect');
const closeLightbox = document.getElementById('closeLightbox');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');

const totalUploads = document.getElementById('totalUploads');
const photoCount = document.getElementById('photoCount');
const videoCount = document.getElementById('videoCount');

// Email modal elements
const emailModal = document.getElementById('emailModal');
const emailForm = document.getElementById('emailForm');
const emailInput = document.getElementById('emailInput');
const emailError = document.getElementById('emailError');
const emailSuccess = document.getElementById('emailSuccess');
const cancelEmailBtn = document.getElementById('cancelEmailBtn');

// Basket elements
const floatingBasket = document.getElementById('floatingBasket');
const basketFab = document.getElementById('basketFab');
const basketBadge = document.getElementById('basketBadge');
const filterSelectedBtn = document.getElementById('filterSelectedBtn');
const requestDownloadBtn = document.getElementById('requestDownloadBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');

// ===== State =====
let isAuthenticated = false;
let allPhotos = [];
let displayedPhotos = [];
let currentPhotoIndex = -1;
let loadedCount = 0;
let isLoading = false;

// Selection state
let selectedPhotos = new Set();
let maxSelection = 50;
let showingSelectedOnly = false;
let basketExpanded = false;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
  // Check if access code is required
  try {
    const configResponse = await fetch(`${API_BASE}/api/config`);
    const config = await configResponse.json();

    // Set max selection from config
    maxSelection = config.maxPhotoSelection || 50;

    if (!config.requireAccessCode) {
      // Access code not required, skip login and load content directly
      isAuthenticated = true;
      accessModal.classList.add('hidden');
      mainContent.classList.remove('hidden');
      await loadGallery();
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

  // Email modal listeners
  emailForm.addEventListener('submit', handleEmailSubmit);
  cancelEmailBtn.addEventListener('click', closeEmailModal);

  // Basket event listeners
  basketFab.addEventListener('click', toggleBasket);
  filterSelectedBtn.addEventListener('click', toggleFilter);
  requestDownloadBtn.addEventListener('click', handleBasketDownload);
  clearSelectionBtn.addEventListener('click', clearAllSelections);

  // Lightbox selection listener
  lightboxSelect.addEventListener('click', toggleLightboxSelection);

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

  // Use filtered photos if in filter mode, otherwise use all photos
  const sourcePhotos = showingSelectedOnly
    ? allPhotos.filter(photo => selectedPhotos.has(photo.id.toString()))
    : allPhotos;

  const photosToLoad = sourcePhotos.slice(loadedCount, loadedCount + ITEMS_PER_PAGE);

  photosToLoad.forEach(photo => {
    const photoElement = createGalleryItem(photo);
    gallery.insertAdjacentHTML('beforeend', photoElement);
  });

  // Update displayedPhotos to match what's actually shown
  if (showingSelectedOnly) {
    displayedPhotos = sourcePhotos.slice(0, loadedCount + photosToLoad.length);
  } else {
    displayedPhotos = sourcePhotos.slice(0, loadedCount + photosToLoad.length);
  }

  loadedCount += photosToLoad.length;

  // Add click listeners to newly added items
  const items = gallery.querySelectorAll('.gallery-item');
  items.forEach((item, index) => {
    if (index >= loadedCount - photosToLoad.length) {
      item.addEventListener('click', (e) => {
        // Always open lightbox when clicking the item
        const photoId = item.dataset.id;
        const photoIndex = displayedPhotos.findIndex(p => p.id == photoId);
        openLightbox(photoIndex);
      });

      // Checkbox click handler
      const checkbox = item.querySelector('.selection-checkbox');
      if (checkbox) {
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          handlePhotoSelection(item.dataset.id, checkbox.checked);
        });
      }
    }
  });

  // Show/hide load more button
  if (loadedCount >= sourcePhotos.length) {
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
  const isSelected = selectedPhotos.has(photo.id.toString());

  const mediaTag = isVideo
    ? `<video src="${thumbnailUrl}" muted></video>`
    : `<img data-src="${thumbnailUrl}" alt="${photo.filename}" class="lazy">`;

  const videoIndicator = isVideo ? '<div class="video-indicator">▶</div>' : '';

  const selectionCheckbox = `
    <div class="selection-overlay">
      <input type="checkbox" class="selection-checkbox" data-photo-id="${photo.id}" ${isSelected ? 'checked' : ''}>
    </div>
  `;

  const checkmarkBadge = `
    <div class="selection-badge">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
  `;

  return `
    <div class="gallery-item ${isSelected ? 'selected' : ''}" data-id="${photo.id}">
      ${videoIndicator}
      ${mediaTag}
      ${selectionCheckbox}
      ${checkmarkBadge}
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
    lightboxVideo.src = photo.preview_url || photo.s3_url;
    lightboxDownload.href = photo.s3_url;
    lightboxDownload.download = photo.filename;
  } else {
    lightboxVideo.style.display = 'none';
    lightboxImage.style.display = 'block';
    lightboxImage.src = photo.preview_url || photo.s3_url;
    lightboxDownload.href = photo.s3_url;
    lightboxDownload.download = photo.filename;
  }

  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Update selection state for lightbox button
  updateLightboxSelectionState();

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
    nextImg.src = displayedPhotos[nextIndex].preview_url || displayedPhotos[nextIndex].s3_url;
  }

  // Preload previous image
  if (displayedPhotos[prevIndex] && displayedPhotos[prevIndex].file_type === 'photo') {
    const prevImg = new Image();
    prevImg.src = displayedPhotos[prevIndex].preview_url || displayedPhotos[prevIndex].s3_url;
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


function handlePhotoSelection(photoId, isSelected) {
  if (isSelected) {
    // Check if max selection reached
    if (selectedPhotos.size >= maxSelection) {
      alert(`You can only select up to ${maxSelection} photos.`);
      // Uncheck the checkbox
      const checkbox = document.querySelector(`.selection-checkbox[data-photo-id="${photoId}"]`);
      if (checkbox) checkbox.checked = false;
      return;
    }
    selectedPhotos.add(photoId);
  } else {
    selectedPhotos.delete(photoId);
  }

  // Update the gallery item visual state
  const galleryItem = document.querySelector(`.gallery-item[data-id="${photoId}"]`);
  if (galleryItem) {
    if (isSelected) {
      galleryItem.classList.add('selected');
    } else {
      galleryItem.classList.remove('selected');
    }
  }

  updateSelectionUI();
  updateBasketUI();
  updateLightboxSelectionState();
}

function updateSelectionUI() {
  // This function is kept for compatibility but does nothing now
  // Selection UI is handled by updateBasketUI()
}

function showEmailModal() {
  if (selectedPhotos.size === 0) return;

  emailModal.classList.remove('hidden');
  emailInput.value = '';
  emailError.textContent = '';
  emailSuccess.textContent = '';
  document.body.style.overflow = 'hidden';
}

function closeEmailModal() {
  emailModal.classList.add('hidden');
  document.body.style.overflow = 'auto';
}

async function handleEmailSubmit(e) {
  e.preventDefault();
  e.stopPropagation();

  const email = emailInput.value.trim();

  if (!email) {
    emailError.textContent = 'Please enter your email address';
    return;
  }

  if (selectedPhotos.size === 0) {
    emailError.textContent = 'No photos selected';
    return;
  }

  emailError.textContent = '';
  emailSuccess.textContent = '';

  // Disable submit button
  const submitBtn = emailForm.querySelector('button[type="submit"]');
  if (!submitBtn) {
    console.error('Submit button not found!');
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  try {
    const response = await fetch(`${API_BASE}/api/request-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        photoIds: Array.from(selectedPhotos),
        email: email,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      emailSuccess.textContent = data.message || 'Download link sent to your email!';
      setTimeout(() => {
        closeEmailModal();
        clearAllSelections();
      }, 2000);
    } else {
      emailError.textContent = data.error || 'Failed to send email. Please try again.';
    }
  } catch (error) {
    console.error('Error requesting download:', error);
    emailError.textContent = 'Connection error. Please try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Download Link';
  }
}

// ===== Basket Functions =====
function updateBasketUI() {
  const count = selectedPhotos.size;
  basketBadge.textContent = count;

  if (count > 0) {
    floatingBasket.classList.remove('hidden');
  } else {
    floatingBasket.classList.add('hidden');
    basketExpanded = false;
    floatingBasket.classList.remove('expanded');
  }
}

function toggleBasket() {
  basketExpanded = !basketExpanded;
  if (basketExpanded) {
    floatingBasket.classList.add('expanded');
  } else {
    floatingBasket.classList.remove('expanded');
  }
}

function toggleFilter() {
  showingSelectedOnly = !showingSelectedOnly;

  if (showingSelectedOnly) {
    filterSelectedBtn.classList.add('active');
    filterSelectedBtn.querySelector('span').textContent = 'Show All';
  } else {
    filterSelectedBtn.classList.remove('active');
    filterSelectedBtn.querySelector('span').textContent = 'Show Selected';
  }

  // Reload gallery with filtered/all photos
  loadedCount = 0;
  displayedPhotos = [];
  gallery.innerHTML = '';

  if (showingSelectedOnly && selectedPhotos.size === 0) {
    gallery.innerHTML = '<div class="empty-gallery"><p>No photos selected yet</p></div>';
  } else {
    loadMorePhotos();
  }

  // Close basket menu
  basketExpanded = false;
  floatingBasket.classList.remove('expanded');
}

function handleBasketDownload() {
  // Close basket menu
  basketExpanded = false;
  floatingBasket.classList.remove('expanded');
  // Show email modal
  showEmailModal();
}

function clearAllSelections() {
  selectedPhotos.clear();

  // Uncheck all checkboxes and remove selected class
  document.querySelectorAll('.selection-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  document.querySelectorAll('.gallery-item.selected').forEach(item => {
    item.classList.remove('selected');
  });

  // If showing selected only, exit filter mode
  if (showingSelectedOnly) {
    toggleFilter();
  }

  updateSelectionUI();
  updateBasketUI();
  updateLightboxSelectionState();

  // Close basket menu
  basketExpanded = false;
  floatingBasket.classList.remove('expanded');
}

// ===== Lightbox Selection Functions =====
function updateLightboxSelectionState() {
  if (currentPhotoIndex < 0 || currentPhotoIndex >= displayedPhotos.length) return;

  const photo = displayedPhotos[currentPhotoIndex];
  const isSelected = selectedPhotos.has(photo.id.toString());

  if (isSelected) {
    lightboxSelect.classList.add('selected');
  } else {
    lightboxSelect.classList.remove('selected');
  }
}

function toggleLightboxSelection() {
  if (currentPhotoIndex < 0 || currentPhotoIndex >= displayedPhotos.length) return;

  const photo = displayedPhotos[currentPhotoIndex];
  const photoId = photo.id.toString();
  const isCurrentlySelected = selectedPhotos.has(photoId);

  // Toggle selection
  const newState = !isCurrentlySelected;

  // Check max selection
  if (newState && selectedPhotos.size >= maxSelection) {
    alert(`You can only select up to ${maxSelection} photos.`);
    return;
  }

  if (newState) {
    selectedPhotos.add(photoId);
  } else {
    selectedPhotos.delete(photoId);
  }

  // Update checkbox in gallery
  const checkbox = document.querySelector(`.selection-checkbox[data-photo-id="${photoId}"]`);
  if (checkbox) {
    checkbox.checked = newState;
  }

  // Update gallery item visual state
  const galleryItem = document.querySelector(`.gallery-item[data-id="${photoId}"]`);
  if (galleryItem) {
    if (newState) {
      galleryItem.classList.add('selected');
    } else {
      galleryItem.classList.remove('selected');
    }
  }

  updateSelectionUI();
  updateBasketUI();
  updateLightboxSelectionState();
}
