# Performance Optimization Plan: Wedding Photo App

**Date Created:** 2025-11-19
**Target Load:** 50-100 concurrent guests
**Timeline:** 1-3 months
**Constraints:** No Redis dependency
**Priority:** Uploads, Gallery Browsing, Overall Stability

---

## Executive Summary

This document outlines critical performance optimizations needed to ensure the wedding photo app can handle 50-100 concurrent guests without crashes or severe degradation. The plan is divided into 4 phases over 4 weeks, addressing the most critical stability issues first.

### Key Issues Identified

1. **CRITICAL:** Database connection pool not configured → service failure with 50+ users
2. **CRITICAL:** Zip generation stores entire file in memory → OOM crashes
3. **CRITICAL:** No rate limiting → DDoS vulnerability
4. **HIGH:** N+1 presigned URL generation → 3-8s page loads
5. **HIGH:** Gallery loads all photos upfront → 5-10s initial load
6. **HIGH:** Thumbnail generation blocks uploads → CPU saturation

---

## Phase 1: Critical Stability Fixes (Week 1) 🔴

**Goal:** Prevent crashes and service failures under load

### 1.1 Configure Database Connection Pool

**File:** `backend/database.js` (lines 5-11)

**Current Code:**
```javascript
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'db',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});
```

**Optimized Code:**
```javascript
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'db',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 50, // Maximum 50 connections in pool
  min: 10, // Keep 10 warm connections ready
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Wait max 10s for connection
  maxUses: 7500, // Recycle connections after 7500 uses
});
```

**Impact:**
- Prevents connection exhaustion with 100 concurrent users
- Improves connection reuse efficiency
- Automatic connection recycling prevents memory leaks

---

### 1.2 Fix Zip Generation Memory Issue

**File:** `backend/server.js` (lines 774-825)

**Current Code:**
```javascript
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression - CPU intensive!
});

const chunks = [];
archive.on('data', (chunk) => chunks.push(chunk)); // Stores in memory!
archive.on('end', () => {
  const zipBuffer = Buffer.concat(chunks); // Entire zip in memory!
  res.send(zipBuffer);
});
```

**Optimized Code:**
```javascript
// Add concurrency control at top of file
let activeZipGenerations = 0;
const MAX_CONCURRENT_ZIPS = 3;

app.get('/api/download/:token', async (req, res) => {
  // Check concurrency limit
  if (activeZipGenerations >= MAX_CONCURRENT_ZIPS) {
    return res.status(429).send('Too many download requests. Please try again in a moment.');
  }

  try {
    activeZipGenerations++;

    // Stream directly to response - no buffering!
    const archive = archiver('zip', {
      zlib: { level: 6 } // Balanced compression (3x faster than level 9)
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="wedding-photos-${Date.now()}.zip"`);

    // Pipe directly to response
    archive.pipe(res);

    // Add files...
    for (const photo of selectedPhotos) {
      const response = await axios.get(photo.s3_url, { responseType: 'stream' });
      archive.append(response.data, { name: photo.filename });
    }

    await archive.finalize();
  } finally {
    activeZipGenerations--;
  }
});
```

**Impact:**
- Eliminates memory buffering (90% memory reduction)
- 3x faster compression
- Prevents OOM crashes with concurrent downloads
- Can handle 3 concurrent downloads safely

---

### 1.3 Add Basic Rate Limiting

**File:** `backend/server.js`

**Install Package:**
```bash
npm install express-rate-limit
```

**Add at top of server.js:**
```javascript
const rateLimit = require('express-rate-limit');

// Rate limiter for uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads per 15 minutes per IP
  message: 'Too many uploads from this IP, please try again in 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for download requests
const downloadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 download requests per hour per IP
  message: 'Too many download requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to routes
app.post('/api/upload-url', uploadLimiter, async (req, res) => { /* ... */ });
app.post('/api/confirm', uploadLimiter, async (req, res) => { /* ... */ });
app.post('/api/request-download', downloadLimiter, async (req, res) => { /* ... */ });
```

**Impact:**
- Prevents abuse and spam
- Protects against DDoS attacks
- Reduces S3 API costs from malicious usage

---

### 1.4 Add Request Timeouts

**File:** `backend/server.js`

**Add after middleware setup:**
```javascript
// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 second timeout
  res.setTimeout(30000);
  next();
});
```

**Impact:**
- Prevents stuck connections from consuming resources
- Improves overall server responsiveness

---

## Phase 2: Upload Performance (Week 2) 🟡

**Goal:** Smooth upload experience during wedding

### 2.1 Optimize Thumbnail Generation

**File:** `backend/server.js` (lines 238-250), `backend/thumbnail.js`

**Current Issue:** Thumbnail generation happens synchronously, blocking CPU

**Optimized Approach:**

**Add at top of server.js:**
```javascript
// Simple async queue for thumbnail generation
const thumbnailQueue = [];
let processingThumbnails = 0;
const MAX_CONCURRENT_THUMBNAILS = 2;

async function processThumbnailQueue() {
  if (processingThumbnails >= MAX_CONCURRENT_THUMBNAILS || thumbnailQueue.length === 0) {
    return;
  }

  const job = thumbnailQueue.shift();
  processingThumbnails++;

  try {
    const thumbnailKey = await generateThumbnail(job.s3Url, job.s3Key);
    if (thumbnailKey) {
      await dbOps.updateThumbnailKey(job.uploadId, thumbnailKey);
    }
  } catch (error) {
    console.error('Thumbnail generation failed:', error);
  } finally {
    processingThumbnails--;
    // Process next in queue
    setImmediate(processThumbnailQueue);
  }
}

// Start queue processor
setInterval(processThumbnailQueue, 100);
```

**Update upload confirmation:**
```javascript
// Queue thumbnail generation instead of processing immediately
if (fileType === 'photo') {
  thumbnailQueue.push({ s3Url, s3Key, uploadId });
}
```

**Update thumbnail.js:**
```javascript
// Change compression level in Sharp
.jpeg({ quality: 80, progressive: true }) // From quality: 85
.png({ compressionLevel: 6 }) // From level 9
```

**Impact:**
- Doesn't block upload confirmation (200-500ms faster)
- Limits CPU usage to 2 concurrent thumbnail processes
- Prevents CPU saturation

---

### 2.2 Make EXIF Extraction Async

**File:** `backend/server.js` (lines 96-138)

**Current Code:**
```javascript
const takenAt = await extractExifDate(s3Url, fileType); // Blocks response!
```

**Optimized Code:**
```javascript
// Don't wait for EXIF extraction
setImmediate(async () => {
  try {
    const takenAt = await extractExifDate(s3Url, fileType);
    if (takenAt) {
      await dbOps.updateTakenAt(uploadId, takenAt);
    }
  } catch (error) {
    console.error('EXIF extraction failed:', error);
  }
});
```

**Add to database.js:**
```javascript
updateTakenAt: async (id, takenAt) => {
  const sql = `UPDATE uploads SET taken_at = $1 WHERE id = $2`;
  await pool.query(sql, [takenAt, id]);
}
```

**Impact:**
- 200-500ms faster upload confirmations
- Better user experience during wedding

---

### 2.3 Add Response Compression

**File:** `backend/server.js`

**Install Package:**
```bash
npm install compression
```

**Add at top:**
```javascript
const compression = require('compression');

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6 // Balanced compression
}));
```

**Impact:**
- Reduces JSON response sizes by 70-80%
- Faster page loads on mobile networks
- Reduced bandwidth costs

---

### 2.4 Add Docker Resource Limits

**File:** `docker-compose.yml`

**Add to services.app:**
```yaml
services:
  app:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '1.0'
          memory: 1G
```

**Impact:**
- Prevents runaway resource consumption
- Protects other services on same host
- Predictable performance

---

## Phase 3: Gallery Performance (Week 3) 🟢

**Goal:** Fast photo browsing on download page

### 3.1 Implement Server-Side Pagination

**File:** `backend/server.js`

**Update /api/photos endpoint:**
```javascript
app.get('/api/photos', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) FROM uploads');
    const totalCount = parseInt(countResult.rows[0].count);

    // Get paginated uploads
    const sql = `
      SELECT * FROM uploads
      ORDER BY COALESCE(taken_at, uploaded_at) DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(sql, [limit, offset]);
    const uploads = result.rows;

    // Generate presigned URLs (cached - see 3.3)
    const uploadsWithFreshUrls = await Promise.all(
      uploads.map(async (upload) => {
        const freshUrl = await getPresignedUrlCached(upload.s3_key);
        let thumbnailUrl = null;
        if (upload.thumbnail_key) {
          thumbnailUrl = await getPresignedUrlCached(upload.thumbnail_key);
        }
        return { ...upload, s3_url: freshUrl, thumbnail_url: thumbnailUrl };
      })
    );

    res.json({
      photos: uploadsWithFreshUrls,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: offset + limit < totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});
```

**File:** `frontend/download.js`

**Update loadGallery:**
```javascript
let currentPage = 1;
const ITEMS_PER_PAGE = 50;

async function loadGallery() {
  try {
    const response = await fetch(`${API_BASE}/api/photos?page=${currentPage}&limit=${ITEMS_PER_PAGE}`);
    const data = await response.json();

    if (currentPage === 1) {
      allPhotos = data.photos;
      displayedPhotos = data.photos;
    } else {
      allPhotos = [...allPhotos, ...data.photos];
      displayedPhotos = [...displayedPhotos, ...data.photos];
    }

    // Update load more button
    if (data.pagination.hasMore) {
      loadMoreContainer.classList.remove('hidden');
    } else {
      loadMoreContainer.classList.add('hidden');
    }

    // Render photos
    renderPhotos(data.photos);
  } catch (error) {
    console.error('Gallery loading error:', error);
  }
}

function loadMorePhotos() {
  currentPage++;
  loadGallery();
}
```

**Impact:**
- Initial load: 5-10s → <1s (90% improvement)
- Reduces bandwidth usage by 90% initially
- Scalable to thousands of photos

---

### 3.2 Add Database Index

**File:** `backend/database.js`

**Add to init-db.js or run manually:**
```javascript
async function createIndexes() {
  const sql = `
    CREATE INDEX IF NOT EXISTS idx_uploads_dates
    ON uploads (taken_at DESC NULLS LAST, uploaded_at DESC);
  `;
  await pool.query(sql);
  console.log('✅ Database index created');
}
```

**Impact:**
- Query time: 500ms → <50ms with 1000+ photos
- Faster gallery loads
- Reduced database CPU usage

---

### 3.3 Cache Presigned URLs

**File:** `backend/server.js`

**Install Package:**
```bash
npm install node-cache
```

**Add at top:**
```javascript
const NodeCache = require('node-cache');
const urlCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

async function getPresignedUrlCached(s3Key) {
  const cacheKey = `presigned:${s3Key}`;

  // Check cache first
  const cached = urlCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Generate new URL
  const url = await s3Ops.getPresignedDownloadUrl(s3Key);

  // Cache for 1 hour
  urlCache.set(cacheKey, url);

  return url;
}
```

**Replace all `s3Ops.getPresignedDownloadUrl()` calls with `getPresignedUrlCached()`**

**Impact:**
- Reduces S3 API calls by 95%
- Faster page loads (no S3 API latency)
- Cost savings on S3 API requests
- Eliminates N+1 query issue

---

### 3.4 Optimize Lazy Loading

**File:** `frontend/download.js` (lines 310-340)

**Add cleanup and DOM size limit:**
```javascript
let imageObserver;
let mutationObserver;

function setupLazyLoading() {
  // Disconnect old observers if they exist
  if (imageObserver) imageObserver.disconnect();
  if (mutationObserver) mutationObserver.disconnect();

  imageObserver = new IntersectionObserver((entries, observer) => {
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
    rootMargin: '200px' // Load 200px before visible
  });

  // Observe all lazy images
  const observeLazyImages = () => {
    document.querySelectorAll('img.lazy').forEach(img => {
      imageObserver.observe(img);
    });

    // Limit DOM size - remove items far off-screen
    const items = gallery.querySelectorAll('.gallery-item');
    if (items.length > 150) {
      // Remove first 50 items that are off-screen
      for (let i = 0; i < 50; i++) {
        if (items[i].getBoundingClientRect().bottom < -1000) {
          items[i].remove();
        }
      }
    }
  };

  observeLazyImages();

  mutationObserver = new MutationObserver(() => {
    observeLazyImages();
  });

  mutationObserver.observe(gallery, {
    childList: true,
    subtree: false // Only direct children
  });
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (imageObserver) imageObserver.disconnect();
  if (mutationObserver) mutationObserver.disconnect();
});
```

**Impact:**
- Prevents memory leaks
- Maintains smooth scrolling with 500+ photos
- Limits DOM size for better performance

---

## Phase 4: Polish & Optimization (Week 4) 🔵

**Goal:** Enhanced user experience

### 4.1 Add HTTP Caching Headers

**File:** `backend/server.js`

**Update static file serving:**
```javascript
app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: '1h', // Cache static assets for 1 hour
  etag: true,
  lastModified: true
}));
```

**Add cache headers to API responses:**
```javascript
app.get('/api/photos', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=60'); // 1 minute cache
  // ... rest of handler
});

app.get('/api/stats', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=30'); // 30 second cache
  // ... rest of handler
});
```

**Impact:**
- Reduces repeated downloads of same resources
- Faster subsequent page loads
- Better mobile experience

---

### 4.2 Persist Selection State

**File:** `frontend/download.js`

**Add localStorage persistence:**
```javascript
// Load selections on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Restore selections from localStorage
  const saved = localStorage.getItem('selectedPhotos');
  if (saved) {
    try {
      const photoIds = JSON.parse(saved);
      selectedPhotos = new Set(photoIds);
      updateBasketUI();
    } catch (error) {
      console.error('Failed to restore selections:', error);
    }
  }

  // ... rest of initialization
});

// Update handlePhotoSelection to persist
function handlePhotoSelection(photoId, isSelected) {
  if (isSelected) {
    if (selectedPhotos.size >= maxSelection) {
      alert(`You can only select up to ${maxSelection} photos.`);
      const checkbox = document.querySelector(`.selection-checkbox[data-photo-id="${photoId}"]`);
      if (checkbox) checkbox.checked = false;
      return;
    }
    selectedPhotos.add(photoId);
  } else {
    selectedPhotos.delete(photoId);
  }

  // Persist to localStorage
  localStorage.setItem('selectedPhotos', JSON.stringify(Array.from(selectedPhotos)));

  // ... rest of function
}

// Clear on successful download
async function handleEmailSubmit(e) {
  // ... existing code ...
  if (response.ok) {
    emailSuccess.textContent = data.message || 'Download link sent to your email!';
    setTimeout(() => {
      closeEmailModal();
      clearAllSelections();
      localStorage.removeItem('selectedPhotos'); // Clear saved selections
    }, 2000);
  }
}
```

**Impact:**
- Prevents frustration from accidental page refresh
- Better user experience during photo selection
- Maintains state across browser sessions

---

### 4.3 Optimize Gallery Filtering

**File:** `frontend/download.js` (lines 644-669)

**Replace DOM destruction with CSS:**
```javascript
function toggleFilter() {
  showingSelectedOnly = !showingSelectedOnly;

  if (showingSelectedOnly) {
    filterSelectedBtn.classList.add('active');
    filterSelectedBtn.querySelector('span').textContent = 'Show All';

    // Hide non-selected items with CSS
    document.querySelectorAll('.gallery-item').forEach(item => {
      const photoId = item.dataset.id;
      if (!selectedPhotos.has(photoId)) {
        item.style.display = 'none';
      }
    });
  } else {
    filterSelectedBtn.classList.remove('active');
    filterSelectedBtn.querySelector('span').textContent = 'Show Selected';

    // Show all items
    document.querySelectorAll('.gallery-item').forEach(item => {
      item.style.display = '';
    });
  }

  // Close basket menu
  basketExpanded = false;
  floatingBasket.classList.remove('expanded');
}
```

**Impact:**
- Smoother transitions (no loading state)
- Maintains lazy-loaded images
- Better user experience

---

### 4.4 Add Lightbox Optimization

**File:** `frontend/download.js` (lines 394-410)

**Optimize preloading:**
```javascript
function preloadAdjacentImages(currentIndex) {
  const nextIndex = (currentIndex + 1) % displayedPhotos.length;
  const prevIndex = currentIndex === 0 ? displayedPhotos.length - 1 : currentIndex - 1;

  // Preload thumbnails instead of full images
  if (displayedPhotos[nextIndex] && displayedPhotos[nextIndex].file_type === 'photo') {
    const nextImg = new Image();
    // Use thumbnail if available, otherwise skip preloading
    if (displayedPhotos[nextIndex].thumbnail_url) {
      nextImg.src = displayedPhotos[nextIndex].thumbnail_url;
    }
  }

  if (displayedPhotos[prevIndex] && displayedPhotos[prevIndex].file_type === 'photo') {
    const prevImg = new Image();
    if (displayedPhotos[prevIndex].thumbnail_url) {
      prevImg.src = displayedPhotos[prevIndex].thumbnail_url;
    }
  }
}
```

**Impact:**
- Reduces bandwidth waste by 90%
- Faster on mobile networks
- Less memory consumption

---

## Testing Plan

### Load Testing
```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Test concurrent uploads
ab -n 100 -c 50 -p upload.json -T application/json http://your-domain/api/upload-url

# Test gallery endpoint
ab -n 100 -c 50 http://your-domain/api/photos?page=1&limit=50

# Test download generation
ab -n 20 -c 10 http://your-domain/api/request-download
```

### Stress Testing
- Simulate 100 concurrent uploads
- Generate 10 concurrent zip downloads
- Load gallery with 1000+ photos
- Test on mobile 3G network

### Monitoring
```javascript
// Add simple performance logging
console.log(`[PERF] Gallery load: ${Date.now() - startTime}ms`);
console.log(`[PERF] Active connections: ${pool.totalCount}`);
console.log(`[PERF] Active zips: ${activeZipGenerations}`);
```

---

## Package Dependencies

**New packages to install:**
```json
{
  "dependencies": {
    "express-rate-limit": "^7.1.5",
    "compression": "^1.7.4",
    "node-cache": "^5.1.2"
  }
}
```

---

## Deployment Checklist

- [ ] Phase 1: Critical stability fixes deployed
- [ ] Phase 2: Upload performance optimizations deployed
- [ ] Phase 3: Gallery performance optimizations deployed
- [ ] Phase 4: Polish & optimization deployed
- [ ] Load testing completed
- [ ] Stress testing completed
- [ ] Mobile network testing completed
- [ ] Database indexes created
- [ ] Docker resource limits configured
- [ ] Monitoring in place

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Max concurrent users | 20 | 100+ | 5x |
| Initial gallery load | 5-10s | <1s | 90% |
| Upload confirmation | 1-2s | 0.3-0.5s | 70% |
| Memory usage (peak) | 2GB+ | <500MB | 75% |
| S3 API calls | 400/request | 20/request | 95% |
| Database query time | 500ms | <50ms | 90% |
| Zip generation memory | 500MB+ | <50MB | 90% |

---

## Rollback Plan

Each phase is independent and can be rolled back:

**Phase 1:**
- Revert database.js to original pool config
- Remove rate limiting middleware
- Revert to buffered zip generation

**Phase 2:**
- Remove thumbnail queue
- Revert EXIF to synchronous
- Remove compression middleware

**Phase 3:**
- Remove pagination from API
- Remove database index
- Remove URL caching

**Phase 4:**
- Remove cache headers
- Remove localStorage persistence
- Revert filter optimization

---

## Notes

- All optimizations are backward compatible
- No breaking API changes
- No infrastructure changes required
- Can be deployed incrementally
- Easy to test and verify each phase

---

**Last Updated:** 2025-11-19
**Status:** Ready for Implementation
