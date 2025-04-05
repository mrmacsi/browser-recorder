const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

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

// Calculate available CPU cores for resource allocation
const numCPUs = os.cpus().length;
const totalMemory = os.totalmem();
console.log(`System has ${numCPUs} CPU cores and ${Math.round(totalMemory / 1024 / 1024 / 1024)}GB total memory`);

// Configure video optimization based on system resources
const VIDEO_FPS = 60; // Increased to 30 FPS for smoother video
const ACTIVITY_DELAY = 300; // Further decreased delay for smoother activity
const VIDEO_WIDTH = 1920; // Reduced from 1280 to improve performance
const VIDEO_HEIGHT = 1080; // Reduced from 720 to improve performance (16:9 ratio maintained)
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'; // Path to ffmpeg for post-processing

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
  
  // Create a function to perform random scrolling and movement
  const performActivity = async () => {
    try {
      // Scroll randomly
      await page.evaluate(() => {
        const scrollAmount = Math.floor(Math.random() * 500);
        window.scrollBy(0, scrollAmount);
        setTimeout(() => window.scrollBy(0, -scrollAmount), 300); // Reduced from 500ms for smoother scrolling
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
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH, // Use environment variable if set, otherwise use Playwright's built-in browser
      chromiumSandbox: false, // Disable sandbox for better performance
      timeout: 60000, // Longer timeout for startup
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--high-dpi-support=1',
        '--force-device-scale-factor=1',
        '--js-flags=--max-old-space-size=8192', // Increased memory allocation
        `--renderer-process-limit=${Math.max(6, numCPUs)}`, // Allow more renderer processes
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
        '--use-gl=swiftshader',
        '--disable-speech-api',
        '--memory-pressure-off',
        '--disable-hang-monitor',
        '--disable-domain-reliability',
        '--disable-histogram-customizer',
        '--single-process', // Use single process mode for better video performance
        '--deterministic-mode', // More consistent timing
        '--aggressive-cache-discard', // Prevent memory bloat
        `--disable-features=site-per-process`, // Disable site isolation
        `--disable-threaded-animation`, // Disable threaded animation
        `--disable-threaded-scrolling`, // Disable threaded scrolling
        `--run-all-compositor-stages-before-draw` // Ensure smooth visual rendering
      ]
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
        dir: uploadsDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
        fps: VIDEO_FPS
      },
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      deviceScaleFactor: 1.0,
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
        waitUntil: 'domcontentloaded', // Changed from 'networkidle' to improve performance
        timeout: 30000 // Reduced timeout for faster loading
      });
      
      // Reduced stabilization time
      await page.waitForTimeout(500); // Reduced from 1000ms
      
      // Add some initial interactivity to make sure the video has content
      console.log(`Generating initial page activity...`);
      // Only generate activity for 2 seconds at the beginning instead of full duration
      await generatePageActivity(page, 2000);
      
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
    
    // Look for the most recently created video file in the uploads directory
    const foundVideoFile = findPlaywrightRecording(uploadsDir);
    
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
          
          // Enhance video with ffmpeg for smoother playback
          console.log(`Enhancing video with ffmpeg: ${enhancedPath}`);
          execSync(`${FFMPEG_PATH} -y -i "${originalPath}" -c:v libvpx-vp9 -b:v 2M -deadline realtime -cpu-used 0 -pix_fmt yuv420p "${enhancedPath}"`, { 
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