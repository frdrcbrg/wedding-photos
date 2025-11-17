const { Pool } = require('pg');
require('dotenv').config();

// Initialize PostgreSQL connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'db',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Database operations
const dbOps = {
  // Insert new upload
  insertUpload: async (data) => {
    const sql = `
      INSERT INTO uploads (filename, s3_key, s3_url, file_type, uploaded_by, message, thumbnail_key, taken_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const result = await pool.query(sql, [
      data.filename,
      data.s3_key,
      data.s3_url,
      data.file_type,
      data.uploaded_by || null,
      data.message || null,
      data.thumbnail_key || null,
      data.taken_at || null,
    ]);

    return { lastInsertRowid: result.rows[0].id };
  },

  // Update thumbnail key for an upload
  updateThumbnailKey: async (id, thumbnailKey) => {
    const sql = `
      UPDATE uploads
      SET thumbnail_key = $1
      WHERE id = $2
    `;
    await pool.query(sql, [thumbnailKey, id]);
  },

  // Get all uploads
  getAllUploads: async () => {
    const sql = `
      SELECT * FROM uploads
      ORDER BY COALESCE(taken_at, uploaded_at) DESC
    `;
    const result = await pool.query(sql);
    return result.rows;
  },

  // Get upload statistics
  getStats: async () => {
    const sql = `
      SELECT
        COUNT(*) as total_uploads,
        SUM(CASE WHEN file_type = 'photo' THEN 1 ELSE 0 END) as photo_count,
        SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as video_count,
        COUNT(DISTINCT uploaded_by) as unique_contributors
      FROM uploads
    `;
    const result = await pool.query(sql);
    return result.rows[0];
  },

  // Delete upload by ID (admin function)
  deleteUpload: async (id) => {
    const sql = 'DELETE FROM uploads WHERE id = $1';
    const result = await pool.query(sql, [id]);
    return result;
  },

  // Delete all uploads (admin function)
  deleteAllUploads: async () => {
    const countSql = 'SELECT COUNT(*) FROM uploads';
    const countResult = await pool.query(countSql);
    const count = parseInt(countResult.rows[0].count);

    const deleteSql = 'DELETE FROM uploads';
    await pool.query(deleteSql);

    return count;
  },

  // Close pool (for graceful shutdown)
  close: async () => {
    await pool.end();
  }
};

module.exports = dbOps;
