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
  openssl \
  net-tools

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

# Remove previous https-server.js if it exists
if [ -f https-server.js ]; then
  echo "Removing existing HTTPS server file..."
  rm -f https-server.js
fi

# Create HTTPS server file from scratch
echo "Creating HTTPS server file..."
cp index.js https-server.js

# Fix the HTTPS server file for proper module imports
cat > https-server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { recordWebsite } = require('./recorder');
const http = require('http');
const https = require('https');

// SSL Certificate
const privateKey = fs.readFileSync("/etc/ssl/browser-recorder/privkey.pem", "utf8");
const certificate = fs.readFileSync("/etc/ssl/browser-recorder/cert.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 5001;
const HTTPS_PORT = process.env.HTTPS_PORT || 5443;

// Enable CORS for development
if (process.env.NODE_ENV !== 'production') {
  console.log('Running in development mode - CORS enabled for all origins');
  app.use(cors());
} else {
  // In production, only allow specific origins
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*'
  }));
}

// Parse JSON request bodies
app.use(express.json());

// Serve static files from the uploads directory with explicit MIME types
app.use('/uploads', (req, res, next) => {
  // Set the correct MIME type for webm files
  if (req.path.endsWith('.webm')) {
    res.set('Content-Type', 'video/webm');
  }
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  // Set Cache-Control headers
  setHeaders: (res, filePath) => {
    if (path.extname(filePath) === '.webm') {
      // No caching for videos for development purposes
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// API endpoint for recording a website
app.post('/api/record', async (req, res) => {
  const url = req.body.url || 'https://example.com';
  const duration = Math.min(Math.max(parseInt(req.body.duration || 10), 1), 60);
  
  try {
    console.log(`Recording request received for ${url} (${duration}s)`);
    
    // Ensure uploads directory exists before proceeding
    if (!fs.existsSync(uploadsDir)) {
      console.log(`Creating uploads directory: ${uploadsDir}`);
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    // Get the initial files in uploads directory
    const initialFiles = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => ({
        name: file,
        time: fs.statSync(path.join(uploadsDir, file)).mtime.getTime()
      }));
    
    // Record the website - this will create a new file in uploads directory
    await recordWebsite(url, duration);
    
    // Get all files in uploads directory after recording
    const afterFiles = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => ({
        name: file,
        path: path.join(uploadsDir, file),
        time: fs.statSync(path.join(uploadsDir, file)).mtime.getTime(),
        size: fs.statSync(path.join(uploadsDir, file)).size
      }))
      .sort((a, b) => b.time - a.time); // Sort by most recent
    
    // Find the most recent file that wasn't there before
    let newFiles = afterFiles.filter(file => 
      !initialFiles.some(initial => initial.name === file.name) || 
      initialFiles.some(initial => initial.name === file.name && initial.time < file.time)
    );
    
    // If we didn't find any new files, just use the most recent file
    if (newFiles.length === 0 && afterFiles.length > 0) {
      console.log('No new files found. Using the most recent file.');
      newFiles = [afterFiles[0]];
    }
    
    // Check if we found any file
    if (newFiles.length === 0) {
      console.error('No video files found after recording');
      return res.status(500).json({
        success: false,
        error: 'Recording failed',
        message: 'No video files found after recording'
      });
    }
    
    // Use the most recent file
    const videoFile = newFiles[0];
    console.log(`Using video file: ${videoFile.name} (${videoFile.size} bytes)`);
    
    // Get the host from request
    const host = req.get('host');
    const protocol = req.protocol;
    
    // Build the absolute URL
    const fileUrl = `/uploads/${videoFile.name}`;
    const absoluteUrl = `${protocol}://${host}/uploads/${videoFile.name}`;
    
    // Return the recording details
    res.json({
      success: true,
      filename: videoFile.name,
      url: fileUrl,
      absoluteUrl: absoluteUrl,
      fileSize: videoFile.size
    });
  } catch (error) {
    console.error('Error during recording:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: 'unified-server'
  });
});

// List all recordings endpoint
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const filePath = path.join(uploadsDir, file);
        const stats = fs.statSync(filePath);
        
        // Get the host from request
        const host = req.get('host');
        const protocol = req.protocol;
        
        return {
          filename: file,
          url: `/uploads/${file}`,
          absoluteUrl: `${protocol}://${host}/uploads/${file}`,
          size: stats.size,
          created: stats.mtime.toISOString()
        };
      });
    
    res.json({
      count: files.length,
      files
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Create HTTP server
const httpServer = http.createServer(app);

// Create HTTPS server
const httpsServer = https.createServer(credentials, app);

// Start HTTP server
httpServer.listen(PORT, () => {
  console.log(`HTTP Server running on port ${PORT}`);
});

// Start HTTPS server
httpsServer.listen(HTTPS_PORT, () => {
  console.log(`HTTPS Server running on port ${HTTPS_PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => console.log('HTTP server closed'));
  httpsServer.close(() => console.log('HTTPS server closed'));
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  httpServer.close(() => console.log('HTTP server closed'));
  httpsServer.close(() => console.log('HTTPS server closed'));
  process.exit(0);
});
EOF

# Make the new file executable
chmod +x https-server.js

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
