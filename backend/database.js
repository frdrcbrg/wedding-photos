const Database = require('better-sqlite3');
const path = require('path');

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'uploads.db'));

// Create uploads table
const createTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      s3_url TEXT NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_by TEXT,
      message TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.exec(sql);
  console.log('✅ Database initialized');
};

// Initialize database
createTable();

// Database operations
const dbOps = {
  // Insert new upload
  insertUpload: (data) => {
    const stmt = db.prepare(`
      INSERT INTO uploads (filename, s3_key, s3_url, file_type, uploaded_by, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      data.filename,
      data.s3_key,
      data.s3_url,
      data.file_type,
      data.uploaded_by || null,
      data.message || null
    );
  },

  // Get all uploads
  getAllUploads: () => {
    const stmt = db.prepare(`
      SELECT * FROM uploads
      ORDER BY uploaded_at DESC
    `);
    return stmt.all();
  },

  // Get upload statistics
  getStats: () => {
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as total_uploads,
        SUM(CASE WHEN file_type = 'photo' THEN 1 ELSE 0 END) as photo_count,
        SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as video_count,
        COUNT(DISTINCT uploaded_by) as unique_contributors
      FROM uploads
    `);
    return stmt.get();
  },

  // Delete upload by ID (admin function)
  deleteUpload: (id) => {
    const stmt = db.prepare('DELETE FROM uploads WHERE id = ?');
    return stmt.run(id);
  }
};

module.exports = dbOps;
