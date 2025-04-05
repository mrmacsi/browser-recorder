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

# Install system dependencies with additional performance-focused packages
echo "Installing system dependencies with performance optimizations..."
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
  net-tools \
  ffmpeg \
  vainfo \
  intel-gpu-tools \
  mesa-va-drivers \
  libva-drm2 \
  libva-x11-2 \
  i965-va-driver \
  intel-media-va-driver \
  libvdpau-va-gl1 \
  vdpauinfo \
  htop \
  iotop \
  sysstat \
  bc \
  jq

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

# Install PM2 with monitoring capabilities
echo "Installing PM2 with performance monitoring..."
sudo npm install -g pm2

# Set up memory management improvements
echo "Configuring system for better memory management..."
# Adjust swappiness to reduce disk I/O
sudo sysctl -w vm.swappiness=10
# Add swappiness setting to persist on reboots
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf

# Create a RAM disk for temporary files to improve I/O performance
echo "Setting up RAM disk for temporary files..."
sudo mkdir -p /mnt/ramdisk
sudo mount -t tmpfs -o size=2G tmpfs /mnt/ramdisk
# Make RAM disk mount persistent
echo "tmpfs /mnt/ramdisk tmpfs size=2G,mode=1777 0 0" | sudo tee -a /etc/fstab

# Set up performance-optimized NODE_OPTIONS
echo "Configuring Node.js for improved performance..."
echo 'export NODE_OPTIONS="--max-old-space-size=4096"' | sudo tee -a /etc/profile.d/node-performance.sh
sudo chmod +x /etc/profile.d/node-performance.sh
source /etc/profile.d/node-performance.sh

# Check for hardware acceleration capabilities
echo "Checking for hardware acceleration capabilities..."
if vainfo &> /dev/null; then
  echo "Hardware acceleration is available!"
  echo 'export HARDWARE_ACCELERATION="true"' | sudo tee -a /etc/profile.d/node-performance.sh
else
  echo "Hardware acceleration is not available."
  echo 'export HARDWARE_ACCELERATION="false"' | sudo tee -a /etc/profile.d/node-performance.sh
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

// List all recordings in the uploads directory
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const stats = fs.statSync(path.join(uploadsDir, file));
        return {
          filename: file,
          url: `/uploads/${file}`,
          size: stats.size,
          created: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created);
    
    res.json({ files });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Create HTTP server
const httpServer = http.createServer(app);

// Create HTTPS server
const httpsServer = https.createServer(credentials, app);

// Start both servers
httpServer.listen(PORT, () => {
  console.log(`HTTP Server running on port ${PORT}`);
});

httpsServer.listen(HTTPS_PORT, () => {
  console.log(`HTTPS Server running on port ${HTTPS_PORT}`);
});
EOF

# Create optimized PM2 configuration for production
echo "Creating optimized PM2 configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'browser-recorder-http',
      script: 'index.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5001,
        NODE_OPTIONS: '--max-old-space-size=4096'
      },
    },
    {
      name: 'browser-recorder-https',
      script: 'https-server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5001,
        HTTPS_PORT: 5443,
        NODE_OPTIONS: '--max-old-space-size=4096'
      },
    }
  ]
};
EOF

# Create optimized recorder.js with performance improvements
echo "Optimizing recorder.js for better performance..."
cat > recorder.js << 'EOF'
const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Determine optimal CPU and memory settings
const numCPUs = os.cpus().length;
const totalMem = Math.floor(os.totalmem() / (1024 * 1024 * 1024)); // GB
console.log(`System has ${numCPUs} CPU cores and ${totalMem}GB RAM`);

// Use RAM disk if available for better I/O performance
const useRamDisk = fs.existsSync('/mnt/ramdisk');
const tempDir = useRamDisk ? '/mnt/ramdisk' : os.tmpdir();
console.log(`Using temp directory: ${tempDir}`);

// Ensure uploads directory exists with absolute path
const uploadsDir = path.resolve(__dirname, 'uploads');
console.log(`Using uploads directory: ${uploadsDir}`);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure video optimization based on system resources
const VIDEO_FPS = numCPUs >= 4 ? 30 : 24; // Adjust FPS based on available cores
const ACTIVITY_DELAY = 300; // Reduced delay for smoother activity
const VIDEO_WIDTH = numCPUs >= 8 ? 1920 : 1280; // Adjust resolution based on CPU
const VIDEO_HEIGHT = numCPUs >= 8 ? 1080 : 720; // Maintain 16:9 ratio
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const USE_HARDWARE_ACCELERATION = process.env.HARDWARE_ACCELERATION === 'true';

console.log(`Video settings: ${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps`);
console.log(`Hardware acceleration: ${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);

// Function to check if browsers are installed
async function ensureBrowsersInstalled() {
  try {
    // Try a simple browser launch to check if browsers are installed
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch (error) {
    if (error.message && error.message.includes("Executable doesn't exist")) {
      console.error('Playwright browsers are not installed. Attempting to install them now...');
      
      try {
        console.log('Running: npx playwright install chromium');
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log('Chromium installed successfully');
        return true;
      } catch (installError) {
        console.error('Failed to automatically install browsers');
        console.error('Please run the following command manually:');
        console.error('npx playwright install');
        throw new Error('Browser installation required. Run: npx playwright install');
      }
    }
    throw error;
  }
}

// Helper function to generate a random animation on the page
async function generatePageActivity(page, durationMs) {
  const startTime = Date.now();
  const endTime = startTime + durationMs;
  
  console.log('Starting page activity to ensure recording has content...');
  
  // Create a function to perform random scrolling and movement
  const performActivity = async () => {
    try {
      // Scroll randomly
      await page.evaluate(() => {
        const scrollAmount = Math.floor(Math.random() * 500);
        window.scrollBy(0, scrollAmount);
        setTimeout(() => window.scrollBy(0, -scrollAmount), 300);
      });
      
      // Move mouse randomly (if the page is still active)
      try {
        const viewportSize = await page.viewportSize();
        if (viewportSize) {
          await page.mouse.move(
            Math.floor(Math.random() * viewportSize.width),
            Math.floor(Math.random() * viewportSize.height)
          );
        }
      } catch (mouseError) {
        // Ignore mouse movement errors as the page might be closing
      }
    } catch (e) {
      // Ignore errors during activity as page might be closing
    }
  };
  
  // Perform activity until the duration is complete
  while (Date.now() < endTime) {
    await performActivity();
    await new Promise(resolve => setTimeout(resolve, ACTIVITY_DELAY));
  }
  
  console.log('Page activity completed');
}

// Find video files in the uploads directory that match our recording
function findPlaywrightRecording(directory) {
  try {
    // Get all files in the directory
    const files = fs.readdirSync(directory);
    
    // Find the most recent .webm file
    const webmFiles = files
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const fullPath = path.join(directory, file);
        const stats = fs.statSync(fullPath);
        return {
          filename: file,
          path: fullPath,
          created: stats.mtime.getTime(),
          size: stats.size
        };
      })
      .sort((a, b) => b.created - a.created); // Sort by most recent first
    
    if (webmFiles.length > 0) {
      console.log(`Found ${webmFiles.length} webm files, using most recent: ${webmFiles[0].filename}`);
      return webmFiles[0];
    }
    
    console.log('No webm files found in uploads directory');
    return null;
  } catch (error) {
    console.error('Error finding webm files:', error);
    return null;
  }
}

async function recordWebsite(url, duration = 10) {
  console.log(`Preparing to record ${url} for ${duration} seconds with Playwright...`);
  
  // Double-check that uploads directory exists
  if (!fs.existsSync(uploadsDir)) {
    console.log(`Uploads directory does not exist, creating it now...`);
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (mkdirError) {
      console.error(`Failed to create uploads directory: ${mkdirError.message}`);
      throw new Error(`Cannot create uploads directory: ${mkdirError.message}`);
    }
  }
  
  // Ensure browsers are installed before proceeding
  await ensureBrowsersInstalled();
  
  // Generate blank file name if needed
  const blankFilename = `blank-${uuidv4()}.webm`;
  const blankPath = path.join(uploadsDir, blankFilename);
  
  // Launch browser with appropriate configuration
  let browser;
  try {
    // Optimize browser arguments based on system capabilities
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--high-dpi-support=1',
      '--force-device-scale-factor=1',
      `--js-flags=--max-old-space-size=${Math.min(4096, totalMem * 1024 / 2)}`,
      `--renderer-process-limit=${Math.max(4, numCPUs)}`,
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,ScriptStreaming',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--disable-sync',
      '--memory-pressure-off',
      '--disable-hang-monitor',
      '--disable-domain-reliability',
      '--aggressive-cache-discard',
      `--disable-features=site-per-process`, 
      `--run-all-compositor-stages-before-draw` 
    ];
    
    // Add hardware acceleration flags if available
    if (USE_HARDWARE_ACCELERATION) {
      browserArgs.push(
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--enable-accelerated-video-decode',
        '--enable-accelerated-mjpeg-decode',
        '--enable-accelerated-2d-canvas',
        '--ignore-gpu-blocklist'
      );
    } else {
      browserArgs.push('--disable-gpu');
      browserArgs.push('--disable-accelerated-2d-canvas');
    }
    
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
      chromiumSandbox: false,
      timeout: 60000,
      args: browserArgs
    });
  } catch (error) {
    console.error('Failed to launch browser:', error.message);
    if (error.message.includes("Executable doesn't exist")) {
      throw new Error(
        "Playwright browser not found. Please run 'npx playwright install' to download the required browsers."
      );
    }
    throw error;
  }

  try {
    // Create a browser context with video recording enabled with improved settings
    const context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      recordVideo: {
        dir: useRamDisk ? tempDir : uploadsDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
        fps: VIDEO_FPS
      },
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      deviceScaleFactor: 1.0,
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    // Force garbage collection to free memory before recording
    try {
      global.gc();
      console.log('Forced garbage collection before recording');
    } catch (e) {
      console.log('Could not force garbage collection (Node.js started without --expose-gc)');
    }

    // Optimize context performance
    context.setDefaultNavigationTimeout(30000);
    context.setDefaultTimeout(20000);
    
    // Create a new page
    const page = await context.newPage();
    
    console.log(`Loading page: ${url}`);
    try {
      // Navigate to the URL with optimized wait conditions
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      // Reduced stabilization time
      await page.waitForTimeout(500);
      
      // Add some initial interactivity to make sure the video has content
      console.log(`Generating initial page activity...`);
      // Only generate activity for 2 seconds at the beginning
      await generatePageActivity(page, 2000);
      
      // Wait for the remainder of the recording time
      console.log(`Waiting for the remaining recording time...`);
      await page.waitForTimeout((duration * 1000) - 2000);
      
    } catch (navigationError) {
      console.warn(`Navigation issue: ${navigationError.message}`);
      // Continue with recording anyway
    }
    
    // Ensure recording had enough activity to be valid
    console.log(`Recording completed after ${duration} seconds`);
    
    // End the recording by closing the page and context
    await page.close();
    console.log(`Page closed, waiting for video to be saved...`);
    const videoPath = await context.close();
    console.log(`Context closed, video path: ${videoPath || 'undefined'}`);
    
    // Look for the most recently created video file
    let foundVideoFile;
    
    // If using RAM disk, copy the file to uploads directory
    if (useRamDisk && videoPath && fs.existsSync(videoPath)) {
      const destFile = path.join(uploadsDir, path.basename(videoPath));
      fs.copyFileSync(videoPath, destFile);
      fs.unlinkSync(videoPath); // Remove the temp file
      foundVideoFile = {
        filename: path.basename(destFile),
        path: destFile,
        size: fs.statSync(destFile).size
      };
    } else {
      foundVideoFile = findPlaywrightRecording(uploadsDir);
    }
    
    // Handle the case where no video was found
    if (!foundVideoFile) {
      console.warn("No video was produced by Playwright");
      
      // Create a blank file as a placeholder
      fs.writeFileSync(blankPath, "NO_VIDEO_RECORDED");
      console.log(`Created blank file at ${blankPath}`);
      
      return blankFilename;
    }
    
    console.log(`Using video file: ${foundVideoFile.filename} (${foundVideoFile.size} bytes)`);
    
    // After finding video file, try to improve its quality with ffmpeg if available
    if (foundVideoFile) {
      try {
        // Attempt to improve video quality with ffmpeg if available
        const originalPath = foundVideoFile.path;
        const enhancedPath = path.join(uploadsDir, `enhanced-${foundVideoFile.filename}`);
        
        try {
          // Check if ffmpeg is available
          execSync(`${FFMPEG_PATH} -version`, { stdio: 'ignore' });
          
          // Choose optimal encoding settings based on hardware
          const ffmpegCmd = USE_HARDWARE_ACCELERATION 
            ? `${FFMPEG_PATH} -y -i "${originalPath}" -c:v libvpx-vp9 -b:v 2M -deadline realtime -cpu-used 0 -pix_fmt yuv420p -quality good -crf 30 -speed 4 "${enhancedPath}"`
            : `${FFMPEG_PATH} -y -i "${originalPath}" -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -pix_fmt yuv420p -quality realtime -crf 40 -speed 6 "${enhancedPath}"`;
          
          // Enhance video with ffmpeg for smoother playback
          console.log(`Enhancing video with ffmpeg: ${enhancedPath}`);
          execSync(ffmpegCmd, { 
            stdio: 'inherit',
            timeout: 60000 // 60 second timeout
          });
          
          // If enhancement succeeded, use the enhanced file
          if (fs.existsSync(enhancedPath) && fs.statSync(enhancedPath).size > 0) {
            console.log(`Using enhanced video: ${enhancedPath}`);
            return path.basename(enhancedPath);
          } else {
            console.log(`Enhanced video creation failed or resulted in empty file. Using original video.`);
            return foundVideoFile.filename;
          }
        } catch (ffmpegError) {
          console.warn(`FFmpeg enhancement failed: ${ffmpegError.message}. Using original video.`);
          return foundVideoFile.filename;
        }
      } catch (enhancementError) {
        console.warn(`Video enhancement error: ${enhancementError.message}. Using original video.`);
        return foundVideoFile.filename;
      }
    }
  } catch (error) {
    console.error('Recording error:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
  }
}

module.exports = { recordWebsite };
EOF

# Start browser-recorder with PM2
echo "Starting browser-recorder service with PM2..."
pm2 start ecosystem.config.js

# Setup PM2 to start on boot
echo "Configuring PM2 to start on system boot..."
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME || true

echo "Installation completed successfully!"
echo "The browser recorder service is now running and configured for optimal performance."
echo "HTTP endpoint: http://localhost:5001"
echo "HTTPS endpoint: https://localhost:5443"
