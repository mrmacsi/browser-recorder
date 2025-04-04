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
  libgbm1 \
  openssl

# Kill any existing processes that might be using ports 5001 and 5443
echo "Ensuring ports 5001 and 5443 are free..."
sudo lsof -ti:5001 | xargs -r sudo kill || true
sudo lsof -ti:5443 | xargs -r sudo kill || true

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

# Setup SSL certificates
echo "Setting up SSL certificates..."
# Create directory for certificates
sudo mkdir -p /etc/ssl/browser-recorder

# Generate self-signed certificate
echo "Generating self-signed SSL certificate..."
SERVER_IP=$(curl -s http://ifconfig.me)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/browser-recorder/privkey.pem \
  -out /etc/ssl/browser-recorder/cert.pem \
  -subj "/CN=$SERVER_IP" \
  -addext "subjectAltName = IP:$SERVER_IP"

# Set proper permissions
sudo chmod 600 /etc/ssl/browser-recorder/privkey.pem
sudo chmod 644 /etc/ssl/browser-recorder/cert.pem

# Create HTTPS server file if it doesn't exist yet
if [ ! -f https-server.js ]; then
  echo "Creating HTTPS server file..."
  cp index.js https-server.js
  
  # Modify the file to support HTTPS
  # Note: This is a simplified approach; in production, you'd want to use a more robust approach
  sed -i 's/const express = require/const express = require("express");\nconst http = require("http");\nconst https = require("https");\nconst fs = require("fs");\n\n\/\/ SSL Certificate\nconst privateKey = fs.readFileSync("\/etc\/ssl\/browser-recorder\/privkey.pem", "utf8");\nconst certificate = fs.readFileSync("\/etc\/ssl\/browser-recorder\/cert.pem", "utf8");\nconst credentials = { key: privateKey, cert: certificate };\n\nconst app = express();\nconst PORT = process.env.PORT || 5001;\nconst HTTPS_PORT = process.env.HTTPS_PORT || 5443;/' https-server.js
  
  # Replace the server startup code
  sed -i 's/app.listen(PORT, () => {/\/\/ Create HTTP server\nconst httpServer = http.createServer(app);\n\n\/\/ Create HTTPS server\nconst httpsServer = https.createServer(credentials, app);\n\n\/\/ Start both servers\nhttpServer.listen(PORT, () => {/' https-server.js
  
  # Add HTTPS server startup
  sed -i 's/console.log(`Browser recorder service running on port ${PORT}`);/console.log(`HTTP Server running on port ${PORT}`);\n});\n\nhttpsServer.listen(HTTPS_PORT, () => {\n  console.log(`HTTPS Server running on port ${HTTPS_PORT}`);/' https-server.js
  
  # Update shutdown handlers
  sed -i 's/process.on("SIGTERM", () => {/process.on("SIGTERM", () => {\n  console.log("SIGTERM received, shutting down gracefully");\n  httpServer.close(() => console.log("HTTP server closed"));\n  httpsServer.close(() => console.log("HTTPS server closed"));/' https-server.js
  
  sed -i 's/process.on("SIGINT", () => {/process.on("SIGINT", () => {\n  console.log("SIGINT received, shutting down gracefully");\n  httpServer.close(() => console.log("HTTP server closed"));\n  httpsServer.close(() => console.log("HTTPS server closed"));/' https-server.js
fi

# Setup PM2 service - ensure clean start
echo "Setting up PM2 service..."
pm2 delete browser-recorder || true
pm2 start https-server.js --name browser-recorder
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

# Configure firewall to allow HTTPS traffic if UFW is active
if command -v ufw &> /dev/null && sudo ufw status | grep -q "active"; then
  echo "Configuring firewall to allow HTTPS traffic..."
  sudo ufw allow 5443/tcp comment "HTTPS for Browser Recorder"
fi

# Open port in Azure if this is an Azure VM
if [ -f /var/lib/waagent/waagent.log ]; then
  echo "This appears to be an Azure VM. Please ensure port 5443 is opened in the Azure Network Security Group."
  echo "You can run the following command to open the port:"
  echo "az network nsg rule create --resource-group YOUR_RESOURCE_GROUP --nsg-name YOUR_NSG --name BrowserRecorderHTTPS --protocol tcp --priority 1002 --destination-port-range 5443 --access allow"
fi

# Verify API endpoints are accessible
echo "Verifying API endpoints..."
# HTTP health check
HEALTH_CHECK=$(curl -s http://localhost:5001/api/health || echo "Failed to connect")
if [[ $HEALTH_CHECK == *"status"*"ok"* ]]; then
  echo "HTTP health check endpoint verified"
else
  echo "WARNING: HTTP health check endpoint may not be working properly"
  echo "Response: $HEALTH_CHECK"
fi

# HTTPS health check with certificate verification disabled (self-signed cert)
HTTPS_HEALTH_CHECK=$(curl -s -k https://localhost:5443/api/health || echo "Failed to connect")
if [[ $HTTPS_HEALTH_CHECK == *"status"*"ok"* ]]; then
  echo "HTTPS health check endpoint verified"
else
  echo "WARNING: HTTPS health check endpoint may not be working properly"
  echo "Response: $HTTPS_HEALTH_CHECK"
fi

# Display server status
pm2 list

echo "Installation complete!"
echo "Browser Recorder should be accessible at:"
echo "  - HTTP: http://localhost:5001"
echo "  - HTTPS: https://localhost:5443"
echo ""
echo "API endpoints:"
echo "  - POST /api/record - Record a website"
echo "  - GET /api/files - List all recordings"
echo "  - GET /api/health - Check service health"
echo "  - GET /uploads/[filename] - Access recorded videos"
echo ""
echo "NOTE: Since we're using a self-signed certificate, browsers will show a security warning."
echo "You can proceed by accepting the risk or exception in your browser."
