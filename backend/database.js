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

// Create uploads table
const createTable = async () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS uploads (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      s3_url TEXT NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_by TEXT,
      message TEXT,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  try {
    await pool.query(sql);
    console.log('✅ Database table initialized');
  } catch (error) {
    console.error('❌ Error creating table:', error);
    throw error;
  }
};

// Initialize database
createTable();

// Database operations
const dbOps = {
  // Insert new upload
  insertUpload: async (data) => {
    const sql = `
      INSERT INTO uploads (filename, s3_key, s3_url, file_type, uploaded_by, message)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const result = await pool.query(sql, [
      data.filename,
      data.s3_key,
      data.s3_url,
      data.file_type,
      data.uploaded_by || null,
      data.message || null,
    ]);

    return { lastInsertRowid: result.rows[0].id };
  },

  // Get all uploads
  getAllUploads: async () => {
    const sql = `
      SELECT * FROM uploads
      ORDER BY uploaded_at DESC
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

  // Close pool (for graceful shutdown)
  close: async () => {
    await pool.end();
  }
};

module.exports = dbOps;
