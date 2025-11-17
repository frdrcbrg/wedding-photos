#!/bin/bash

# Winter Wedding Photo App - Quick Setup Script
# This script helps you set up the application quickly

set -e

echo "❄️  Winter Wedding Photo App - Setup"
echo "======================================"
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 1
    fi
fi

# Create .env file
echo "📝 Creating .env file..."
cp .env.example .env

# Prompt for configuration
echo ""
echo "Please provide the following information:"
echo ""

read -p "Access Code (default: WINTER2025): " ACCESS_CODE
ACCESS_CODE=${ACCESS_CODE:-WINTER2025}

read -p "S3 Access Key ID: " S3_ACCESS_KEY_ID
read -sp "S3 Secret Access Key: " S3_SECRET_ACCESS_KEY
echo ""
read -p "S3 Bucket Name: " S3_BUCKET_NAME
read -p "S3 Region (default: us-east-1): " S3_REGION
S3_REGION=${S3_REGION:-us-east-1}

echo ""
read -p "Are you using DigitalOcean Spaces? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "DigitalOcean Spaces Endpoint (e.g., https://nyc3.digitaloceanspaces.com): " S3_ENDPOINT
    S3_FORCE_PATH_STYLE="true"
else
    S3_ENDPOINT=""
    S3_FORCE_PATH_STYLE="false"
fi

# Write to .env file
cat > .env << EOF
# Server Configuration
PORT=3000
ACCESS_CODE=${ACCESS_CODE}

# AWS S3 Configuration (or DigitalOcean Spaces)
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
S3_BUCKET_NAME=${S3_BUCKET_NAME}
S3_REGION=${S3_REGION}
EOF

if [ -n "$S3_ENDPOINT" ]; then
    cat >> .env << EOF

# DigitalOcean Spaces Configuration
S3_ENDPOINT=${S3_ENDPOINT}
S3_FORCE_PATH_STYLE=${S3_FORCE_PATH_STYLE}
EOF
fi

echo ""
echo "✅ Configuration saved to .env"
echo ""

# Ask about deployment method
echo "How would you like to run the application?"
echo "1) Docker (recommended)"
echo "2) Local development (Node.js)"
echo ""
read -p "Choose (1 or 2): " -n 1 -r
echo ""

if [[ $REPLY == "1" ]]; then
    # Docker deployment
    echo ""
    echo "🐳 Starting with Docker..."

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker is not installed!"
        echo "Please install Docker first: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        echo "❌ Docker Compose is not installed!"
        echo "Please install Docker Compose first: https://docs.docker.com/compose/install/"
        exit 1
    fi

    # Build and run
    echo "Building Docker image..."
    docker-compose build

    echo "Starting container..."
    docker-compose up -d

    echo ""
    echo "✨ Application is starting!"
    echo "Waiting for server to be ready..."
    sleep 5

    # Check if container is running
    if docker-compose ps | grep -q "Up"; then
        echo ""
        echo "🎉 Success! Your Winter Wedding Photo App is running!"
        echo ""
        echo "📱 Access it at: http://localhost:3000"
        echo "🔑 Access Code: ${ACCESS_CODE}"
        echo ""
        echo "Useful commands:"
        echo "  View logs:     docker-compose logs -f"
        echo "  Stop app:      docker-compose down"
        echo "  Restart app:   docker-compose restart"
        echo ""
    else
        echo "❌ Container failed to start. Check logs with: docker-compose logs"
        exit 1
    fi

elif [[ $REPLY == "2" ]]; then
    # Local development
    echo ""
    echo "💻 Setting up for local development..."

    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js is not installed!"
        echo "Please install Node.js 18+: https://nodejs.org/"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo "❌ Node.js version 18+ is required (you have $(node -v))"
        exit 1
    fi

    # Install dependencies
    echo "Installing dependencies..."
    cd backend
    npm install

    echo ""
    echo "✨ Setup complete!"
    echo ""
    echo "To start the server:"
    echo "  cd backend"
    echo "  npm start"
    echo ""
    echo "📱 Access it at: http://localhost:3000"
    echo "🔑 Access Code: ${ACCESS_CODE}"
    echo ""
else
    echo "Invalid choice. Setup cancelled."
    exit 1
fi

echo ""
echo "📖 For more information, see README.md and DEPLOYMENT.md"
echo ""
echo "Enjoy your special day! 💍✨"
