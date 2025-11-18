#!/bin/bash

# Webhook Deploy Script
# This script is triggered by GitHub Actions webhook after successful build

set -e  # Exit on any error

# Security: Only allow from localhost (webhook server will validate GitHub signature)
if [ "$1" != "WEBHOOK_TRIGGERED" ]; then
    echo "This script should only be called by the webhook server"
    exit 1
fi

echo "======================================"
echo "🔄 Webhook Deploy Triggered"
echo "======================================"
echo ""

# Change to project directory
cd "$(dirname "$0")"

# Run the deploy script
./deploy.sh
