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
const isDev = process.env.NODE_ENV === 'development';
const useRamDisk = true; // Always use RAM-based operations by default
const isLinux = os.platform() === 'linux';

// Create a RAM disk automatically on Linux servers
if (isLinux && !fs.existsSync('/mnt/ramdisk')) {
  try {
    console.log('Attempting to create RAM disk on Linux server...');
    // Create the mount point if it doesn't exist
    if (!fs.existsSync('/mnt/ramdisk')) {
      execSync('sudo mkdir -p /mnt/ramdisk', { stdio: 'inherit' });
    }
    // Create a 1GB RAM disk
    execSync('sudo mount -t tmpfs -o size=1g tmpfs /mnt/ramdisk', { stdio: 'inherit' });
    console.log('RAM disk created successfully at /mnt/ramdisk');
  } catch (error) {
    console.warn(`Failed to create RAM disk: ${error.message}`);
    console.warn('Will use system temp directory instead');
  }
}

const tempDir = useRamDisk ? (fs.existsSync('/mnt/ramdisk') ? '/mnt/ramdisk' : os.tmpdir()) : os.tmpdir();
console.log(`Using temp directory: ${tempDir} (RAM-based: ${useRamDisk})`);

// Ensure uploads directory exists with absolute path
const uploadsDir = path.resolve(__dirname, 'uploads');
console.log(`Using uploads directory: ${uploadsDir}`);
if (!fs.existsSync(uploadsDir)) {
  console.log(`Creating uploads directory: ${uploadsDir}`);
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`Successfully created uploads directory`);
  } catch (error) {
    console.error(`Failed to create uploads directory: ${error.message}`);
    // Continue execution - the error will be caught when trying to write files
  }
}

// Configure video optimization based on system resources
const VIDEO_FPS = 60; // Increased to 60fps for smoother playback
const ACTIVITY_DELAY = 150; // Reduced delay for even smoother activity
const VIDEO_WIDTH = 1920; // Always use full HD
const VIDEO_HEIGHT = 1080; // Always use full HD
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const USE_HARDWARE_ACCELERATION = true; // Always enable hardware acceleration for local
const DISABLE_PAGE_ACTIVITY = process.env.DISABLE_PAGE_ACTIVITY === 'true' || true; // Default to disabled

console.log(`Video settings: ${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps`);
console.log(`Hardware acceleration: ${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);
console.log(`Page activity: ${DISABLE_PAGE_ACTIVITY ? 'Disabled' : 'Enabled'}`);

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
        // Try to automatically install browsers
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
  
  // Create a function to perform mouse movement only (no scrolling)
  const performActivity = async () => {
    try {
      // Only move mouse randomly (if the page is still active)
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
    // Wait a short time between activities
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
      
      // Clean up old temp files in development mode to manage RAM usage
      if (useRamDisk && tempDir === os.tmpdir() && webmFiles.length > 5) {
        console.log(`Cleaning up old temp files (keeping 5 most recent)...`);
        webmFiles.slice(5).forEach(file => {
          try {
            if (file.path.includes(tempDir)) {
              fs.unlinkSync(file.path);
              console.log(`Removed old temp file: ${file.filename}`);
            }
          } catch (err) {
            console.warn(`Failed to remove temp file: ${err.message}`);
          }
        });
      }
      
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
      browserArgs.push('--use-gl=swiftshader');
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
      deviceScaleFactor: 2.0, // Increased for sharper rendering
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      },
      offline: false,
    });

    // Force garbage collection to free memory before recording
    try {
      if (global.gc) {
        global.gc();
        console.log('Forced garbage collection before recording');
      } else {
        console.log('Garbage collection not available (Node.js needs --expose-gc flag)');
      }
    } catch (e) {
      console.log('Could not force garbage collection: ' + e.message);
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
        waitUntil: 'networkidle', // Wait for network to be idle for better content loading
        timeout: 60000 // Increased timeout for more complete loading
      });
      
      // Allow page to fully render
      await page.waitForTimeout(1000);
      
      // Add some initial interactivity to make sure the video has content
      if (!DISABLE_PAGE_ACTIVITY) {
        console.log(`Generating initial page activity...`);
        // Only generate activity for 2 seconds at the beginning instead of full duration
        await generatePageActivity(page, 2000);
      } else {
        console.log(`Page activity disabled, recording page as-is...`);
      }
      
      // Wait for the remainder of the recording time
      console.log(`Waiting for the remaining recording time...`);
      await page.waitForTimeout((duration * 1000) - 2000);
      
    } catch (navigationError) {
      console.warn(`Navigation issue: ${navigationError.message}`);
      // Continue with recording anyway - we'll record whatever is on the page
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
          
          // Choose optimal encoding settings based on hardware capabilities
          let ffmpegCmd;
          if (isDev) {
            // Fast mode for development - speed over quality
            ffmpegCmd = `${FFMPEG_PATH} -y -i "${originalPath}" -c:v libvpx-vp9 -b:v 4M -deadline realtime -cpu-used 4 -pix_fmt yuv420p -quality good -crf 20 -speed 4 -threads ${numCPUs} "${enhancedPath}"`;
          } else {
            // Balanced mode for production - good quality with reasonable speed
            ffmpegCmd = `${FFMPEG_PATH} -y -i "${originalPath}" -c:v libvpx-vp9 -b:v 6M -deadline good -cpu-used 2 -pix_fmt yuv420p -quality good -crf 18 -speed 3 -threads ${numCPUs} "${enhancedPath}"`;
          }
          
          // Enhance video with ffmpeg for smoother playback
          console.log(`Enhancing video with ffmpeg (fast mode: ${isDev}): ${enhancedPath}`);
          execSync(ffmpegCmd, { 
            stdio: 'inherit',
            timeout: 120000 // 120 second timeout for higher quality processing
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