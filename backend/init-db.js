const { Client } = require('pg');
require('dotenv').config();

async function initializeDatabase() {
  console.log('\n🔧 Starting database initialization...\n');

  // First, connect to default 'postgres' database to check/create our database
  const adminClient = new Client({
    host: process.env.POSTGRES_HOST || 'db',
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres', // Connect to default postgres database
  });

  try {
    await adminClient.connect();
    console.log('✅ Connected to PostgreSQL server');

    // Check if database exists
    const dbName = process.env.POSTGRES_DB;
    const checkDbQuery = `
      SELECT 1 FROM pg_database WHERE datname = $1
    `;
    const result = await adminClient.query(checkDbQuery, [dbName]);

    if (result.rows.length === 0) {
      // Database doesn't exist, create it
      console.log(`📦 Database '${dbName}' not found, creating...`);
      await adminClient.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database '${dbName}' created successfully`);
    } else {
      console.log(`✅ Database '${dbName}' already exists`);
    }

    await adminClient.end();

    // Now connect to our actual database and create tables
    const appClient = new Client({
      host: process.env.POSTGRES_HOST || 'db',
      port: process.env.POSTGRES_PORT || 5432,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: dbName,
    });

    await appClient.connect();
    console.log(`✅ Connected to database '${dbName}'`);

    // Create uploads table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS uploads (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        s3_key TEXT NOT NULL,
        s3_url TEXT NOT NULL,
        file_type TEXT NOT NULL,
        uploaded_by TEXT,
        message TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        thumbnail_key TEXT,
        preview_key TEXT,
        taken_at TIMESTAMP,
        file_hash TEXT
      )
    `;

    // Add columns if they don't exist (for existing databases)
    const addThumbnailColumnQuery = `
      ALTER TABLE uploads
      ADD COLUMN IF NOT EXISTS thumbnail_key TEXT
    `;

    const addPreviewColumnQuery = `
      ALTER TABLE uploads
      ADD COLUMN IF NOT EXISTS preview_key TEXT
    `;

    const addTakenAtColumnQuery = `
      ALTER TABLE uploads
      ADD COLUMN IF NOT EXISTS taken_at TIMESTAMP
    `;

    const addFileHashColumnQuery = `
      ALTER TABLE uploads
      ADD COLUMN IF NOT EXISTS file_hash TEXT
    `;

    // Create index on file_hash for fast duplicate lookups
    const createHashIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_file_hash ON uploads(file_hash)
    `;

    await appClient.query(createTableQuery);
    await appClient.query(addThumbnailColumnQuery);
    await appClient.query(addPreviewColumnQuery);
    await appClient.query(addTakenAtColumnQuery);
    await appClient.query(addFileHashColumnQuery);
    await appClient.query(createHashIndexQuery);
    console.log('✅ Table "uploads" initialized');

    // Check current record count
    const countResult = await appClient.query('SELECT COUNT(*) FROM uploads');
    const count = countResult.rows[0].count;
    console.log(`📊 Current records in uploads table: ${count}`);

    await appClient.end();

    console.log('\n✨ Database initialization complete!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Database initialization failed:', error.message);
    console.error('\nPlease check:');
    console.error('  - PostgreSQL server is running');
    console.error('  - POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD are correct');
    console.error('  - User has permission to create databases\n');
    process.exit(1);
  }
}

initializeDatabase();
