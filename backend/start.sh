#!/bin/sh

# Exit on error
set -e

echo "🚀 Starting Wedding Photos Application..."

# Run database initialization
echo "📦 Initializing database..."
node init-db.js

# Start the application
echo "🌐 Starting web server..."
exec node server.js
