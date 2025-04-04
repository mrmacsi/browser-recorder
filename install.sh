#!/bin/bash

# Exit on error
set -e
# Print commands before executing
set -x

# Detect OS
DISTRO=$(lsb_release -i -s)
UBUNTU_VERSION=$(lsb_release -r -s)

echo "Installing on $DISTRO $UBUNTU_VERSION"

# Create directory if needed
REPO_DIR="browser-recorder"
if [ ! -d "$REPO_DIR" ]; then
  # Clone repository (replace with your actual repo URL)
  git clone https://github.com/mrmacsi/browser-recorder.git $REPO_DIR
  cd $REPO_DIR
else
  # Update existing repository
  cd $REPO_DIR
  git pull
fi

# Install Node.js dependencies if not already installed
if ! command -v node &> /dev/null; then
  echo "Installing Node.js 18.x..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Check Node.js version
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

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

# Install Playwright dependencies
echo "Installing Playwright dependencies..."
sudo npx playwright install-deps chromium
npx playwright install chromium

# Install npm dependencies
echo "Installing npm packages..."
npm install

# Create PM2 service
if command -v pm2 &> /dev/null; then
  echo "PM2 is already installed"
else
  echo "Installing PM2..."
  sudo npm install -g pm2
fi

# Setup PM2 service
pm2 delete browser-recorder 2>/dev/null || true
pm2 start index.js --name browser-recorder
pm2 save
pm2 startup

echo "Installation complete!"
echo "Browser Recorder service is running with PM2"

# Display server status
pm2 list
