// ===== Configuration =====
const API_BASE = window.location.origin;

// ===== DOM Elements =====
const adminLoginModal = document.getElementById('adminLoginModal');
const adminContent = document.getElementById('adminContent');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminPassword = document.getElementById('adminPassword');
const adminError = document.getElementById('adminError');
const logoutBtn = document.getElementById('logoutBtn');
const adminGallery = document.getElementById('adminGallery');

const adminTotalCount = document.getElementById('adminTotalCount');
const adminPhotoCount = document.getElementById('adminPhotoCount');
const adminVideoCount = document.getElementById('adminVideoCount');

// ===== State =====
let isAuthenticated = false;
let photos = [];

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  // Check if already authenticated
  const savedToken = sessionStorage.getItem('adminToken');
  if (savedToken) {
    verifyAdmin(savedToken, true);
  }

  // Event listeners
  adminLoginForm.addEventListener('submit', handleAdminLogin);
  logoutBtn.addEventListener('click', handleLogout);
});

// ===== Admin Authentication =====
async function handleAdminLogin(e) {
  e.preventDefault();
  const password = adminPassword.value.trim();
  await verifyAdmin(password);
}

async function verifyAdmin(password, silent = false) {
  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await response.json();

    if (response.ok) {
      // Access granted
      isAuthenticated = true;
      sessionStorage.setItem('adminToken', password);
      adminLoginModal.classList.add('hidden');
      adminContent.classList.remove('hidden');

      // Load content
      loadPhotos();
      loadStats();
    } else {
      if (!silent) {
        adminError.textContent = data.error || 'Invalid admin password';
        adminPassword.value = '';
        adminPassword.focus();
      } else {
        // Silent verification failed, clear stored token
        sessionStorage.removeItem('adminToken');
      }
    }
  } catch (error) {
    console.error('Admin verification error:', error);
    if (!silent) {
      adminError.textContent = 'Connection error. Please try again.';
    }
  }
}

function handleLogout() {
  sessionStorage.removeItem('adminToken');
  isAuthenticated = false;
  adminContent.classList.add('hidden');
  adminLoginModal.classList.remove('hidden');
  adminPassword.value = '';
  adminError.textContent = '';
}

// ===== Load Photos =====
async function loadPhotos() {
  try {
    const response = await fetch(`${API_BASE}/api/photos`);

    if (!response.ok) {
      throw new Error('Failed to load photos');
    }

    photos = await response.json();

    if (photos.length === 0) {
      adminGallery.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--charcoal); opacity: 0.6;">
          <p style="font-size: 1.2em;">No photos uploaded yet</p>
        </div>
      `;
      return;
    }

    adminGallery.innerHTML = photos.map(photo => createAdminItem(photo)).join('');

    // Add delete listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });

  } catch (error) {
    console.error('Error loading photos:', error);
    adminGallery.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: red;">
        Failed to load photos. Please refresh the page.
      </div>
    `;
  }
}

function createAdminItem(photo) {
  const isVideo = photo.file_type === 'video';
  const thumbnailUrl = photo.thumbnail_url || photo.s3_url;

  const mediaTag = isVideo
    ? `<video src="${thumbnailUrl}" muted class="admin-item-image"></video>`
    : `<img src="${thumbnailUrl}" alt="${photo.filename}" class="admin-item-image">`;

  const displayName = photo.uploaded_by || 'Anonymous';
  const displayMessage = photo.message || 'No message';
  const displayDate = formatDate(photo.uploaded_at);

  return `
    <div class="admin-item" data-id="${photo.id}">
      ${mediaTag}
      <div class="admin-item-info">
        <div class="admin-item-name">${escapeHtml(displayName)}</div>
        <div class="admin-item-date">${displayDate}</div>
        <div class="admin-item-message">${escapeHtml(displayMessage)}</div>
        <button class="delete-btn" data-id="${photo.id}">Delete</button>
      </div>
    </div>
  `;
}

// ===== Delete Photo =====
async function handleDelete(photoId) {
  if (!confirm('Are you sure you want to delete this photo? This cannot be undone.')) {
    return;
  }

  const btn = document.querySelector(`button[data-id="${photoId}"]`);
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    const adminToken = sessionStorage.getItem('adminToken');
    const response = await fetch(`${API_BASE}/api/admin/delete/${photoId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
    });

    if (response.ok) {
      // Remove from UI
      const item = document.querySelector(`.admin-item[data-id="${photoId}"]`);
      item.style.opacity = '0';
      setTimeout(() => {
        item.remove();
        // Reload to update counts
        loadPhotos();
        loadStats();
      }, 300);
    } else {
      const data = await response.json();
      alert(`Failed to delete: ${data.error || 'Unknown error'}`);
      btn.disabled = false;
      btn.textContent = 'Delete';
    }
  } catch (error) {
    console.error('Delete error:', error);
    alert('Failed to delete photo. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

// ===== Load Stats =====
async function loadStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`);

    if (!response.ok) {
      throw new Error('Failed to load stats');
    }

    const stats = await response.json();

    adminTotalCount.textContent = stats.total_uploads || 0;
    adminPhotoCount.textContent = stats.photo_count || 0;
    adminVideoCount.textContent = stats.video_count || 0;

  } catch (error) {
    console.error('Stats loading error:', error);
  }
}

// ===== Utility Functions =====
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
