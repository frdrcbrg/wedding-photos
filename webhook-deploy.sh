#!/bin/bash

# Simple webhook deployment script for the server
# Place this at /opt/docker/wedding-photos/webhook-deploy.sh
# Make executable: chmod +x /opt/docker/wedding-photos/webhook-deploy.sh

set -e

echo "==================================="
echo "Starting deployment..."
echo "Time: $(date)"
echo "==================================="

cd /opt/docker/wedding-photos

# Pull latest docker-compose.yml if needed
echo "Pulling latest code..."
git pull

# Pull the latest Docker image
echo "Pulling latest Docker image..."
docker pull ghcr.io/frdrcbrg/wedding-photos:latest

# Restart containers
echo "Restarting containers..."
docker compose down
docker compose up -d

# Cleanup old images
echo "Cleaning up old images..."
docker image prune -af

echo "==================================="
echo "Deployment completed successfully!"
echo "Time: $(date)"
echo "==================================="
