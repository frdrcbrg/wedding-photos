#!/bin/bash

# Wedding Photos Deployment Script
# This script pulls the latest code and Docker image, then restarts the containers

set -e  # Exit on any error

echo "======================================"
echo "🚀 Wedding Photos Deployment"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ Error: docker-compose.yml not found!${NC}"
    echo "Please run this script from the wedding-photos directory"
    exit 1
fi

# Step 1: Pull latest code from git
echo -e "${BLUE}📥 Step 1: Pulling latest code from GitHub...${NC}"
git pull origin main
echo -e "${GREEN}✓ Code updated${NC}"
echo ""

# Step 2: Pull latest Docker image
echo -e "${BLUE}🐳 Step 2: Pulling latest Docker image...${NC}"
docker compose pull
echo -e "${GREEN}✓ Image updated${NC}"
echo ""

# Step 3: Restart containers
echo -e "${BLUE}🔄 Step 3: Restarting containers...${NC}"
docker compose down
docker compose up -d
echo -e "${GREEN}✓ Containers restarted${NC}"
echo ""

# Step 4: Show logs
echo -e "${BLUE}📋 Step 4: Checking startup logs...${NC}"
echo "Waiting for container to start..."
sleep 3
echo ""
docker compose logs --tail=50

echo ""
echo "======================================"
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo "======================================"
echo ""
echo "To view live logs, run:"
echo "  docker compose logs -f"
echo ""
