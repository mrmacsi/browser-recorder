#!/bin/bash

# Exit on error
set -e
# Print commands before executing
set -x

# Detect OS
DISTRO=$(lsb_release -i -s)
UBUNTU_VERSION=$(lsb_release -r -s)

echo "Installing on $DISTRO $UBUNTU_VERSION"

# Repository directory is expected to be already cloned by the VM creation script
REPO_DIR="."

# Install or update Node.js to version 18.x (required for Playwright)
echo "Setting up Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js version meets minimum requirements
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"
REQUIRED_NODE_VERSION="v14.0.0"

# Compare versions to ensure we have at least Node.js 14
if [[ "$(printf '%s\n' "$REQUIRED_NODE_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_NODE_VERSION" ]]; then
  echo "ERROR: Node.js version must be 14.0.0 or higher for Playwright to work"
  exit 1
fi

# Install system dependencies
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  libxcomposite1 \
  libxdamage1 \
  xvfb \
  chromium-browser \
  libnss3 \
  libgbm1

# Kill any existing processes that might be using port 5001
echo "Ensuring port 5001 is free..."
sudo lsof -ti:5001 | xargs -r sudo kill || true

# Stop any existing PM2 processes to avoid port conflicts
if command -v pm2 &> /dev/null; then
  echo "Stopping any existing PM2 processes..."
  pm2 kill || true
fi

# Install Playwright dependencies
echo "Installing Playwright dependencies..."
sudo npx playwright install-deps chromium
npx playwright install chromium

# Install npm dependencies
echo "Installing npm packages..."
npm install

# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  sudo npm install -g pm2
fi

# Setup PM2 service - ensure clean start
echo "Setting up PM2 service..."
pm2 delete browser-recorder || true
pm2 start index.js --name browser-recorder
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME || true
sudo systemctl enable pm2-$USER || true

# Check if browser-recorder is actually running
if pm2 info browser-recorder | grep -q "online"; then
  echo "Browser Recorder service is running successfully"
else
  echo "ERROR: Browser Recorder service failed to start"
  echo "Check logs with: pm2 logs browser-recorder"
  exit 1
fi

# Verify API endpoints are accessible
echo "Verifying API endpoints..."
HEALTH_CHECK=$(curl -s http://localhost:5001/api/health || echo "Failed to connect")
if [[ $HEALTH_CHECK == *"status"*"ok"* ]]; then
  echo "Health check endpoint verified"
else
  echo "WARNING: Health check endpoint may not be working properly"
  echo "Response: $HEALTH_CHECK"
fi

# Display server status
pm2 list

echo "Installation complete!"
echo "Browser Recorder should be accessible at http://localhost:5001"
echo "API endpoints:"
echo "  - POST /api/record - Record a website"
echo "  - GET /api/files - List all recordings"
echo "  - GET /api/health - Check service health"
echo "  - GET /uploads/[filename] - Access recorded videos"
