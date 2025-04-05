const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Create logs directory if it doesn't exist
const logsDir = path.resolve(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create metrics directory specifically for performance data
const metricsDir = path.resolve(__dirname, 'logs', 'metrics');
if (!fs.existsSync(metricsDir)) {
  fs.mkdirSync(metricsDir, { recursive: true });
  console.log(`[DEBUG] Created metrics directory: ${metricsDir}`);
}

// Verify metrics directory permissions
try {
  console.log(`[DEBUG] Metrics directory permissions:`);
  execSync(`ls -la ${metricsDir}`, { stdio: 'inherit' });
  console.log(`[DEBUG] Setting full permissions on metrics directory`);
  execSync(`chmod -R 777 ${metricsDir}`, { stdio: 'inherit' });
} catch (error) {
  console.warn(`[DEBUG] Could not set metrics directory permissions: ${error.message}`);
}

// Function to create a logger for a specific recording session
function createSessionLogger(sessionId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFilePath = path.join(logsDir, `recording-${sessionId}-${timestamp}.log`);
  const metricsFilePath = path.join(metricsDir, `metrics-${sessionId}-${timestamp}.log`);
  
  console.log(`[DEBUG] Creating log file: ${logFilePath}`);
  console.log(`[DEBUG] Creating metrics file: ${metricsFilePath}`);
  
  // Create a write stream for the log file
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  const metricsStream = fs.createWriteStream(metricsFilePath, { flags: 'a' });
  
  // Verify streams are created
  console.log(`[DEBUG] Log stream created: ${!!logStream}`);
  console.log(`[DEBUG] Metrics stream created: ${!!metricsStream}`);
  
  // Write initial test entries to verify streams work
  logStream.write(`[${new Date().toISOString()}] Log file created for session ${sessionId}\n`);
  metricsStream.write(`[${new Date().toISOString()}] Metrics file created for session ${sessionId}\n`);
  
  // Create a logger function that writes to both console and log file
  const logger = (message) => {
    const timestampedMessage = `[${new Date().toISOString()}] ${message}`;
    console.log(timestampedMessage);
    logStream.write(timestampedMessage + '\n');
  };
  
  // Create a metrics logger specifically for performance data
  const metricsLogger = (message) => {
    const timestampedMessage = `[${new Date().toISOString()}] ${message}`;
    console.log(`METRICS: ${timestampedMessage}`);
    try {
      metricsStream.write(timestampedMessage + '\n');
      console.log(`[DEBUG] Successfully wrote metrics: ${message.substring(0, 50)}...`);
    } catch (err) {
      console.error(`[DEBUG] Failed to write to metrics file: ${err.message}`);
    }
  };
  
  // Return the logger function and file path
  return { 
    log: logger,
    logMetrics: metricsLogger,
    logFilePath,
    metricsFilePath
  };
}

// Determine optimal CPU and memory settings
const numCPUs = os.cpus().length;
const totalMem = Math.floor(os.totalmem() / (1024 * 1024 * 1024)); // GB
console.log(`[DEBUG] System has ${numCPUs} CPU cores and ${totalMem}GB RAM`);
console.log(`[DEBUG] OS Platform: ${os.platform()}, Release: ${os.release()}, Arch: ${os.arch()}`);
console.log(`[DEBUG] Free memory: ${Math.floor(os.freemem() / (1024 * 1024))}MB`);

// Use RAM disk if available for better I/O performance
const isDev = process.env.NODE_ENV === 'development';
const useRamDisk = true; // Always use RAM-based operations by default
const isLinux = os.platform() === 'linux';

console.log(`[DEBUG] Environment: ${isDev ? 'development' : 'production'}`);

// Create a RAM disk automatically on Linux servers
if (isLinux && !fs.existsSync('/mnt/ramdisk')) {
  try {
    console.log('[DEBUG] Attempting to create RAM disk on Linux server...');
    // Create the mount point if it doesn't exist
    if (!fs.existsSync('/mnt/ramdisk')) {
      console.log('[DEBUG] Creating /mnt/ramdisk directory');
      execSync('sudo mkdir -p /mnt/ramdisk', { stdio: 'inherit' });
    }
    // Create a 1GB RAM disk
    console.log('[DEBUG] Mounting RAM disk');
    execSync('sudo mount -t tmpfs -o size=1g tmpfs /mnt/ramdisk', { stdio: 'inherit' });
    // Set permissions to allow the current user to write to it
    execSync('sudo chmod 1777 /mnt/ramdisk', { stdio: 'inherit' });
    console.log('[DEBUG] RAM disk created successfully at /mnt/ramdisk');
    console.log('[DEBUG] RAM disk permissions:');
    execSync('ls -la /mnt/ramdisk', { stdio: 'inherit' });
  } catch (error) {
    console.warn(`[DEBUG] Failed to create RAM disk: ${error.message}`);
    console.warn('[DEBUG] Will use system temp directory instead');
  }
}

const tempDir = useRamDisk ? (fs.existsSync('/mnt/ramdisk') ? '/mnt/ramdisk' : os.tmpdir()) : os.tmpdir();
console.log(`[DEBUG] Using temp directory: ${tempDir} (RAM-based: ${useRamDisk})`);
console.log(`[DEBUG] Temp directory permissions:`);
try {
  execSync(`ls -la ${tempDir}`, { stdio: 'inherit' });
} catch (error) {
  console.warn(`[DEBUG] Could not list temp directory permissions: ${error.message}`);
}

// Ensure uploads directory exists with absolute path
const uploadsDir = path.resolve(__dirname, 'uploads');
console.log(`[DEBUG] Using uploads directory: ${uploadsDir}`);
if (!fs.existsSync(uploadsDir)) {
  console.log(`[DEBUG] Creating uploads directory: ${uploadsDir}`);
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`[DEBUG] Successfully created uploads directory`);
  } catch (error) {
    console.error(`[DEBUG] Failed to create uploads directory: ${error.message}`);
    // Continue execution - the error will be caught when trying to write files
  }
}

console.log(`[DEBUG] Uploads directory permissions:`);
try {
  execSync(`ls -la ${uploadsDir}`, { stdio: 'inherit' });
} catch (error) {
  console.warn(`[DEBUG] Could not list uploads directory permissions: ${error.message}`);
}

// Configure video optimization based on system resources
const VIDEO_FPS = 60; // Increased to 60fps for smoother playback
const TARGET_FPS = 30; // Target FPS we aim to achieve at minimum
const ACTIVITY_DELAY = 100; // Reduced delay for even smoother activity (was 150)
const VIDEO_WIDTH = 1920; // Always use full HD
const VIDEO_HEIGHT = 1080; // Always use full HD
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
// Always try to use hardware acceleration when available, regardless of environment
const USE_HARDWARE_ACCELERATION = process.env.HARDWARE_ACCELERATION === 'true' || process.env.NODE_ENV === 'development';
const DISABLE_PAGE_ACTIVITY = false; // Enable page activity to ensure recording works

// Maintain frame timing metrics
const frameMetrics = {
  startTime: 0,
  frameCount: 0,
  lastFrameTime: 0,
  measurements: []
};

console.log(`[DEBUG] Video settings: ${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps (target: ${TARGET_FPS}fps)`);
console.log(`[DEBUG] Hardware acceleration: ${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);
console.log(`[DEBUG] Page activity: ${DISABLE_PAGE_ACTIVITY ? 'Disabled' : 'Enabled'}`);

// Check for FFMPEG
try {
  console.log('[DEBUG] Checking for ffmpeg installation:');
  execSync(`${FFMPEG_PATH} -version | head -n 1`, { stdio: 'inherit' });
} catch (error) {
  console.warn(`[DEBUG] ffmpeg not found or not working: ${error.message}`);
}

// Function to check if browsers are installed
async function ensureBrowsersInstalled() {
  console.log('[DEBUG] Checking if Playwright browsers are installed');
  try {
    // Try a simple browser launch to check if browsers are installed
    console.log('[DEBUG] Attempting to launch browser to check installation');
    const browser = await chromium.launch({ 
      headless: true,
      timeout: 30000
    });
    await browser.close();
    console.log('[DEBUG] Browser check successful - browsers are installed');
    return true;
  } catch (error) {
    console.error(`[DEBUG] Browser check error: ${error.message}`);
    if (error.message && error.message.includes("Executable doesn't exist")) {
      console.error('[DEBUG] Playwright browsers are not installed. Attempting to install them now...');
      
      try {
        // Try to automatically install browsers
        console.log('[DEBUG] Running: npx playwright install chromium');
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log('[DEBUG] Chromium installed successfully');
        return true;
      } catch (installError) {
        console.error(`[DEBUG] Failed to automatically install browsers: ${installError.message}`);
        console.error('[DEBUG] Please run the following command manually:');
        console.error('npx playwright install');
        throw new Error('Browser installation required. Run: npx playwright install');
      }
    }
    throw error;
  }
}

// Helper function to generate a random animation on the page
async function generatePageActivity(page, durationMs, logMetrics, log) {
  const startTime = Date.now();
  const endTime = startTime + durationMs;
  
  log(`Starting page activity for ${durationMs}ms to ensure recording has content...`);
  
  // Reset frame timing variables
  frameMetrics.startTime = startTime;
  frameMetrics.frameCount = 0;
  frameMetrics.lastFrameTime = startTime;
  frameMetrics.measurements = [];
  
  log(`Initialized frameMetrics tracking: startTime=${startTime}`);
  if (logMetrics) {
    logMetrics(`ACTIVITY_START,TIME=${startTime},DURATION=${durationMs}ms`);
  }
  
  // Create a function to perform mouse movement only (no scrolling)
  const performActivity = async () => {
    try {
      // Only move mouse randomly (if the page is still active)
      try {
        const viewportSize = await page.viewportSize();
        if (viewportSize) {
          const x = Math.floor(Math.random() * viewportSize.width);
          const y = Math.floor(Math.random() * viewportSize.height);
          log(`Moving mouse to ${x},${y}`);
          await page.mouse.move(x, y);
          
          // Record frame timing
          const now = Date.now();
          const frameDuration = now - frameMetrics.lastFrameTime;
          frameMetrics.frameCount++;
          frameMetrics.lastFrameTime = now;
          frameMetrics.measurements.push(frameDuration);
          
          if (frameMetrics.frameCount % 10 === 0) {
            log(`Processed ${frameMetrics.frameCount} frames so far`);
          }
        }
      } catch (mouseError) {
        log(`Mouse movement error: ${mouseError.message}`);
        // Ignore mouse movement errors as the page might be closing
      }
    } catch (e) {
      log(`Page activity error: ${e.message}`);
      // Ignore errors during activity as page might be closing
    }
  };
  
  // Perform activity until the duration is complete
  let activityCount = 0;
  while (Date.now() < endTime) {
    await performActivity();
    activityCount++;
    // Wait a short time between activities
    await new Promise(resolve => setTimeout(resolve, ACTIVITY_DELAY));
  }
  
  // Calculate frame rate statistics
  const totalDuration = Date.now() - startTime;
  const fps = Math.round((frameMetrics.frameCount * 1000) / totalDuration);
  const frameTimes = frameMetrics.measurements;
  const avgFrameTime = frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
  const minFrameTime = frameTimes.length > 0 ? Math.min(...frameTimes) : 0;
  const maxFrameTime = frameTimes.length > 0 ? Math.max(...frameTimes) : 0;
  
  log(`Page activity completed with ${activityCount} mouse movements`);
  log(`Frame statistics: ${fps} FPS, Avg: ${avgFrameTime.toFixed(2)}ms, Min: ${minFrameTime}ms, Max: ${maxFrameTime}ms`);
  
  // Log metrics to the dedicated metrics file
  if (logMetrics) {
    log(`Writing frame metrics to metrics file: FPS=${fps}`);
    logMetrics(`FRAME_METRICS,${fps},${avgFrameTime.toFixed(2)},${minFrameTime},${maxFrameTime},${activityCount}`);
    logMetrics(`FRAME_STATS,FPS=${fps},AVG_TIME=${avgFrameTime.toFixed(2)}ms,MIN=${minFrameTime}ms,MAX=${maxFrameTime}ms`);
    logMetrics(`ACTIVITY_COUNT=${activityCount},DURATION=${totalDuration}ms,TARGET_FPS=${TARGET_FPS}`);
    
    // Write raw frame data for detailed analysis (limit to first 100 frames to avoid huge files)
    const framesToLog = frameTimes.slice(0, 100);
    logMetrics(`RAW_FRAME_TIMES,${framesToLog.join(',')}`);
  } else {
    log(`WARNING: logMetrics function not provided, metrics not being saved to file`);
  }
  
  return {
    fps,
    avgFrameTime,
    minFrameTime,
    maxFrameTime,
    activityCount
  };
}

// Function to look for video files in a specified directory
function findVideoFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  
  try {
    // Get all files in the directory
    const files = fs.readdirSync(directory)
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
    
    return files;
  } catch (error) {
    console.error(`[DEBUG] Error finding video files in ${directory}: ${error.message}`);
    return [];
  }
}

// Utility function to check if a file is valid for ffmpeg processing
function isValidForFfmpeg(file) {
  if (!file) {
    console.log(`[DEBUG] No file provided, skipping ffmpeg`);
    return false;
  }

  // Explicitly check for blank files by name pattern
  if (file.filename && file.filename.startsWith('blank-')) {
    console.log(`[DEBUG] File '${file.filename}' is a placeholder file (starts with 'blank-'), skipping ffmpeg`);
    return false;
  }

  // Check file size
  if (!file.size || file.size < 10000) {
    console.log(`[DEBUG] File size (${file?.size || 0} bytes) is too small for ffmpeg, minimum 10KB required`);
    return false;
  }

  // Verify file path exists
  if (!file.path || !fs.existsSync(file.path)) {
    console.log(`[DEBUG] File path does not exist: ${file?.path || 'undefined'}`);
    return false;
  }

  // Verify it's actually a file
  try {
    const stats = fs.statSync(file.path);
    if (!stats.isFile()) {
      console.log(`[DEBUG] Path exists but is not a file: ${file.path}`);
      return false;
    }
  } catch (err) {
    console.log(`[DEBUG] Error checking file stats: ${err.message}`);
    return false;
  }

  // Try to read the first few bytes to verify it's a valid file
  try {
    // Just read the first 1024 bytes to check if file is readable
    const fd = fs.openSync(file.path, 'r');
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);
    
    if (bytesRead < 10) {
      console.log(`[DEBUG] File contains insufficient data (only ${bytesRead} bytes read)`);
      return false;
    }
  } catch (err) {
    console.log(`[DEBUG] Error reading file: ${err.message}`);
    return false;
  }

  console.log(`[DEBUG] File '${file.filename}' (${file.size} bytes) is valid for ffmpeg processing`);
  return true;
}

async function recordWebsite(url, duration = 10) {
  // Generate a session ID for this recording
  const sessionId = uuidv4().substr(0, 8);
  
  // Create a logger for this session
  const { log, logMetrics, logFilePath, metricsFilePath } = createSessionLogger(sessionId);
  
  log(`Starting recording session ${sessionId} for ${url} with duration ${duration}s`);
  logMetrics(`SESSION_START,ID=${sessionId},URL=${url},DURATION=${duration}s`);
  log(`System info: ${numCPUs} CPU cores, ${totalMem}GB RAM, Platform: ${os.platform()}, Release: ${os.release()}`);
  logMetrics(`SYSTEM,CORES=${numCPUs},RAM=${totalMem}GB,PLATFORM=${os.platform()},RELEASE=${os.release()}`);
  log(`Free memory: ${Math.floor(os.freemem() / (1024 * 1024))}MB`);
  logMetrics(`MEMORY,FREE=${Math.floor(os.freemem() / (1024 * 1024))}MB`);
  log(`Video settings: ${VIDEO_WIDTH}x${VIDEO_HEIGHT} @ ${VIDEO_FPS}fps (target: ${TARGET_FPS}fps)`);
  logMetrics(`VIDEO_SETTINGS,WIDTH=${VIDEO_WIDTH},HEIGHT=${VIDEO_HEIGHT},FPS=${VIDEO_FPS},TARGET_FPS=${TARGET_FPS}`);
  log(`Hardware acceleration: ${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);
  logMetrics(`HARDWARE_ACCELERATION=${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);
  
  // Double-check that metrics directory exists
  if (!fs.existsSync(metricsDir)) {
    log(`Metrics directory does not exist, creating it now...`);
    try {
      fs.mkdirSync(metricsDir, { recursive: true });
      log(`Metrics directory created at ${metricsDir}`);
      execSync(`chmod -R 777 ${metricsDir}`, { stdio: 'inherit' });
      log(`Set full permissions on metrics directory`);
    } catch (mkdirError) {
      log(`Failed to create metrics directory: ${mkdirError.message}`);
    }
  }
  
  // Verify metrics file path
  log(`Metrics will be saved to: ${metricsFilePath}`);
  logMetrics(`METRICS_FILE_CHECK=Path is ${metricsFilePath}`);
  
  // Double-check that uploads directory exists
  if (!fs.existsSync(uploadsDir)) {
    log(`Uploads directory does not exist, creating it now...`);
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      log(`Upload directory created`);
    } catch (mkdirError) {
      log(`Failed to create uploads directory: ${mkdirError.message}`);
      throw new Error(`Cannot create uploads directory: ${mkdirError.message}`);
    }
  }
  
  log('Checking directory permissions:');
  try {
    execSync(`ls -la ${__dirname}`, { stdio: 'inherit' });
  } catch (error) {
    log(`Could not list directory permissions: ${error.message}`);
  }
  
  // Ensure browsers are installed before proceeding
  try {
    await ensureBrowsersInstalled();
    log('Browser installation check completed successfully');
  } catch (browserInstallError) {
    log(`Failed to ensure browsers are installed: ${browserInstallError.message}`);
    throw browserInstallError;
  }
  
  // Generate a proper filename for this recording
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const recordingId = sessionId;
  const videoFilename = `recording-${recordingId}-${timestamp}.webm`;
  const videoPath = path.join(uploadsDir, videoFilename);
  log(`Generated recording filename: ${videoFilename}`);
  
  // Create a fallback screenshot in case video recording fails
  const screenshotFilename = `screenshot-${recordingId}-${timestamp}.png`;
  const screenshotPath = path.join(uploadsDir, screenshotFilename);
  
  // Launch browser with appropriate configuration
  let browser;
  try {
    // Base browser arguments for all environments
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--disable-sync',
      '--memory-pressure-off',
      '--disable-hang-monitor',
      // Performance improvements
      '--disable-features=site-per-process',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--disable-threaded-animation',
      '--disable-threaded-scrolling',
      '--disable-checker-imaging',
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
      // Memory optimization
      '--single-process', // More performant for recording only
      '--renderer-process-limit=1',
      '--disable-default-apps'
    ];
    
    // Add hardware acceleration flags if available and in development mode
    if (USE_HARDWARE_ACCELERATION) {
      log('Using hardware acceleration for video recording');
      browserArgs.push(
        '--enable-gpu-rasterization',
        '--enable-accelerated-video-decode',
        '--enable-accelerated-2d-canvas',
        '--enable-accelerated-video',
        '--enable-native-gpu-memory-buffers',
        '--enable-gpu-compositing',
        '--enable-oop-rasterization',
        '--ignore-gpu-blocklist'
      );
    } else {
      log('Using software rendering for video recording');
      browserArgs.push('--disable-gpu');
      browserArgs.push('--disable-accelerated-2d-canvas');
      browserArgs.push('--use-gl=swiftshader');
    }
    
    // Check available browsers
    console.log('[DEBUG] Available browsers:');
    try {
      execSync('npx playwright --version', { stdio: 'inherit' });
    } catch (error) {
      console.warn(`[DEBUG] Could not get Playwright version: ${error.message}`);
    }
    
    log(`Launching browser with ${browserArgs.length} arguments`);
    log(`Browser args: ${browserArgs.join(' ')}`);
    
    const launchOptions = {
      headless: true,
      executablePath: process.env.CHROME_PATH,
      chromiumSandbox: false,
      timeout: 60000,
      args: browserArgs
    };
    
    log(`Browser launch options: ${JSON.stringify(launchOptions, null, 2)}`);
    browser = await chromium.launch(launchOptions);
    log('Browser launched successfully');
  } catch (error) {
    log(`Failed to launch browser: ${error.message}`);
    log(`Error stack: ${error.stack}`);
    if (error.message.includes("Executable doesn't exist")) {
      throw new Error(
        "Playwright browser not found. Please run 'npx playwright install' to download the required browsers."
      );
    }
    throw error;
  }

  try {
    log('Creating browser context with video recording enabled');
    // Create a browser context with video recording enabled with improved settings
    const contextOptions = {
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      recordVideo: {
        dir: useRamDisk ? tempDir : uploadsDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
        fps: VIDEO_FPS
      },
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      deviceScaleFactor: 1.0, // Reduced to avoid rendering issues
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    };
    
    log(`Browser context options: ${JSON.stringify(contextOptions, null, 2)}`);
    const context = await browser.newContext(contextOptions);
    log('Browser context created successfully');

    // Force garbage collection to free memory before recording
    try {
      if (global.gc) {
        global.gc();
        log('Forced garbage collection before recording');
      } else {
        log('Garbage collection not available (Node.js needs --expose-gc flag)');
      }
    } catch (e) {
      log(`Could not force garbage collection: ${e.message}`);
    }

    // Optimize context performance
    context.setDefaultNavigationTimeout(30000);
    context.setDefaultTimeout(20000);
    
    // Create a new page
    log('Creating new page');
    const page = await context.newPage();
    log('Page created successfully');
    
    // Flag to track if we have any successful content
    let hasContent = false;

    // Take a screenshot as a fallback for when video doesn't work
    let screenshotTaken = false;
    try {
      await page.screenshot({ path: screenshotPath });
      screenshotTaken = true;
      log(`Fallback screenshot saved to ${screenshotPath}`);
    } catch (screenshotError) {
      log(`Failed to take fallback screenshot: ${screenshotError.message}`);
    }
    
    log(`Loading page: ${url}`);
    try {
      // Navigate to the URL with optimized wait conditions
      log('Navigating to URL with networkidle wait condition');
      const navigationResponse = await page.goto(url, { 
        waitUntil: 'networkidle', // Wait for network to be idle for better content loading
        timeout: 60000 // Increased timeout for more complete loading
      });
      
      log(`Navigation status: ${navigationResponse ? navigationResponse.status() : 'No response'}`);
      log(`Navigation URL: ${navigationResponse ? navigationResponse.url() : 'No response'}`);
      
      // Allow page to fully render
      log('Waiting 1 second for page to render');
      await page.waitForTimeout(1000);
      
      // Check page content
      log(`Page title: ${await page.title()}`);
      if (await page.title()) {
        hasContent = true;
      }
      
      // Take a screenshot for debugging
      try {
        const screenshotPath = path.join(uploadsDir, `debug-screenshot-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath });
        log(`Saved debug screenshot to ${screenshotPath}`);
      } catch (screenshotError) {
        log(`Failed to take screenshot: ${screenshotError.message}`);
      }
      
      // Generate activity for longer duration to ensure recording works
      let frameStats = null;
      if (!DISABLE_PAGE_ACTIVITY) {
        log(`Generating initial page activity...`);
        
        // Double-check logMetrics function is available
        if (!logMetrics) {
          log(`WARNING: logMetrics function not available, creating fallback`);
          // Create a fallback metrics logger that only logs to console
          logMetrics = (message) => {
            console.log(`METRICS FALLBACK: ${message}`);
          };
        } else {
          // Test the metrics logging
          logMetrics(`PRE_ACTIVITY_TEST,TIME=${Date.now()}`);
          log(`Metrics logging test performed`);
        }
        
        // Generate activity for longer duration to ensure recording works
        frameStats = await generatePageActivity(page, 5000, logMetrics, log);
        log(`Frame rate statistics: ${frameStats.fps} FPS, Avg frame time: ${frameStats.avgFrameTime.toFixed(2)}ms`);
        
        // Log to both normal log and metrics log
        const metricsMessage = `RECORDING_STATS,FPS=${frameStats.fps},AVG_FRAME_TIME=${frameStats.avgFrameTime.toFixed(2)}ms,MIN=${frameStats.minFrameTime}ms,MAX=${frameStats.maxFrameTime}ms`;
        log(metricsMessage); // Log to regular log file
        logMetrics(metricsMessage); // Log to metrics file
        
        log(`Frame time range: Min=${frameStats.minFrameTime}ms, Max=${frameStats.maxFrameTime}ms`);
        
        // Flush metrics to ensure they're written
        try {
          fs.readdir(metricsDir, (err, files) => {
            if (err) {
              log(`Error reading metrics directory: ${err.message}`);
            } else {
              log(`Metrics directory contains ${files.length} files after recording`);
            }
          });
        } catch (err) {
          log(`Error checking metrics directory: ${err.message}`);
        }
        
        hasContent = true;
        
        // Wait for the remainder of the recording time
        const remainingTime = (duration * 1000) - 5000;
        if (remainingTime > 0) {
          log(`Waiting for the remaining recording time (${remainingTime}ms)...`);
          await page.waitForTimeout(remainingTime);
        }
      } else {
        log(`Page activity disabled, recording page as-is...`);
        // Wait for the full recording time
        await page.waitForTimeout(duration * 1000);
      }
      
    } catch (navigationError) {
      log(`Navigation issue: ${navigationError.message}`);
      log(`Navigation error stack: ${navigationError.stack}`);
      // Continue with recording anyway - we'll record whatever is on the page
    }
    
    // Ensure recording had enough activity to be valid
    log(`Recording completed after ${duration} seconds`);
    
    // End the recording by closing the page and context
    log('Closing page to end recording');
    await page.close();
    log(`Page closed, waiting for video to be saved...`);
    const recordedVideoPath = await context.close();
    log(`Context closed, video path: ${recordedVideoPath || 'undefined'}`);
    
    // Look for the most recently created video file
    let foundVideoFile;
    
    // Check if video recording was successful
    let videoRecordingSuccessful = recordedVideoPath && fs.existsSync(recordedVideoPath) && 
                                   fs.statSync(recordedVideoPath).size > 10000;
    
    if (videoRecordingSuccessful) {
      log(`Video recording successful! Path: ${recordedVideoPath}, Size: ${fs.statSync(recordedVideoPath).size} bytes`);
    } else {
      log(`Video recording failed or produced invalid file: ${recordedVideoPath || 'undefined'}`);
      if (recordedVideoPath && fs.existsSync(recordedVideoPath)) {
        log(`Video file exists but size is only ${fs.statSync(recordedVideoPath).size} bytes`);
      }
    }
    
    // Debug what's in the temp directory
    log(`Contents of temp directory (${tempDir}):`);
    try {
      execSync(`ls -la ${tempDir}`, { stdio: 'inherit' });
    } catch (error) {
      log(`Could not list temp directory contents: ${error.message}`);
    }
    
    // Find any video files in temp directory if the recording path is undefined
    let videoFilesInTemp = [];
    if (!videoRecordingSuccessful) {
      log(`Looking for any video files in temp directory: ${tempDir}`);
      videoFilesInTemp = findVideoFiles(tempDir);
      log(`Found ${videoFilesInTemp.length} video files in temp directory`);
      
      // If we found video files in temp directory, try to use the most recent one
      if (videoFilesInTemp.length > 0) {
        const recentTempVideo = videoFilesInTemp[0];
        log(`Found recent video in temp dir: ${recentTempVideo.filename} (${recentTempVideo.size} bytes)`);
        
        if (recentTempVideo.size > 10000) {
          videoRecordingSuccessful = true;
          recordedVideoPath = recentTempVideo.path;
          log(`Using video from temp directory: ${recordedVideoPath}`);
        }
      }
    }
    
    // If using RAM disk and video recording was successful, copy the file to uploads directory
    if (useRamDisk && videoRecordingSuccessful) {
      const destFile = path.join(uploadsDir, path.basename(recordedVideoPath));
      log(`Copying video from temp directory: ${recordedVideoPath} to ${destFile}`);
      try {
        // Use system commands for copying to handle permission issues
        execSync(`sudo cp "${recordedVideoPath}" "${destFile}"`, { stdio: 'inherit' });
        log(`File copy succeeded using system command`);
        
        // Set proper ownership for the copied file
        try {
          execSync(`sudo chmod 644 "${destFile}"`, { stdio: 'inherit' });
          log(`Set permissions for destination file`);
        } catch (chmodError) {
          log(`Failed to set permissions: ${chmodError.message}`);
        }
        
        try {
          // Use system command to remove the temp file
          execSync(`sudo rm "${recordedVideoPath}"`, { stdio: 'inherit' });
          log(`Removed temp file: ${recordedVideoPath}`);
        } catch (unlinkError) {
          log(`Failed to remove temp file: ${unlinkError.message}`);
        }
        
        // Check if the file exists and get its size
        if (fs.existsSync(destFile)) {
          const fileSize = fs.statSync(destFile).size;
          log(`Destination file size: ${fileSize} bytes`);
          
          foundVideoFile = {
            filename: path.basename(destFile),
            path: destFile,
            size: fileSize
          };
          log(`Video copied successfully, size: ${foundVideoFile.size} bytes`);
        } else {
          log(`Destination file does not exist after copy: ${destFile}`);
          videoRecordingSuccessful = false;
        }
      } catch (copyError) {
        log(`File copy failed: ${copyError.message}`);
        log(`Copy error stack: ${copyError.stack}`);
        videoRecordingSuccessful = false;
      }
    } else if (!useRamDisk && videoRecordingSuccessful) {
      // If not using RAM disk but video recording was successful
      foundVideoFile = {
        filename: path.basename(recordedVideoPath),
        path: recordedVideoPath,
        size: fs.statSync(recordedVideoPath).size
      };
      log(`Using direct video file: ${foundVideoFile.filename}, size: ${foundVideoFile.size} bytes`);
    } else {
      // Try to find any valid recording in the uploads directory
      log(`Looking for recording in uploads directory: ${uploadsDir}`);
      foundVideoFile = findVideoFiles(uploadsDir)[0] || null;
    }
    
    log(`Video file found: ${foundVideoFile ? 'yes' : 'no'}`);
    
    // Handle the case where no video was found
    if (!foundVideoFile || foundVideoFile.size < 10000) {
      log(`No valid video was produced by Playwright or file is too small`);
      
      // Return the screenshot if it was taken successfully
      if (screenshotTaken && fs.existsSync(screenshotPath)) {
        log(`Returning screenshot instead of video: ${screenshotFilename}`);
        return { 
          fileName: screenshotFilename,
          logFile: path.basename(logFilePath),
          metricsFile: path.basename(metricsFilePath)
        };
      }
      
      // Create a video placeholder with the proper naming scheme
      log(`Creating placeholder video file: ${videoFilename}`);
      try {
        fs.writeFileSync(videoPath, "NO_VIDEO_RECORDED");
        log(`Created placeholder file at ${videoPath}`);
        
        // Return proper video filename for better UX
        return { 
          fileName: videoFilename,
          logFile: path.basename(logFilePath),
          metricsFile: path.basename(metricsFilePath)
        };
      } catch (writeError) {
        log(`Failed to write placeholder file: ${writeError.message}`);
        
        // Last resort fallback: generate a blank file with proper naming
        const fallbackFilename = `video-fallback-${recordingId}.webm`;
        const fallbackPath = path.join(uploadsDir, fallbackFilename);
        try {
          fs.writeFileSync(fallbackPath, "VIDEO_RECORDING_FAILED");
          log(`Created fallback placeholder: ${fallbackFilename}`);
          return { 
            fileName: videoFilename,
            logFile: path.basename(logFilePath),
            metricsFile: path.basename(metricsFilePath)
          };
        } catch (fallbackError) {
          log(`All recording methods failed: ${fallbackError.message}`);
          // Just return the name, we've tried our best
          return { 
            fileName: videoFilename,
            logFile: path.basename(logFilePath),
            metricsFile: path.basename(metricsFilePath)
          };
        }
      }
    }
    
    log(`Using video file: ${foundVideoFile.filename} (${foundVideoFile.size} bytes)`);
    
    // After finding video file, try to improve its quality with ffmpeg if available
    if (foundVideoFile) {
      // Skip ffmpeg for invalid files - central check in one place with detailed logging
      if (!isValidForFfmpeg(foundVideoFile)) {
        log(`Skipping ffmpeg enhancement for invalid file: ${foundVideoFile.filename}`);
        
        // If we have a screenshot, prefer that over a tiny video file
        if (screenshotTaken && fs.existsSync(screenshotPath) && foundVideoFile.size < 50000) {
          log(`Returning screenshot (${screenshotFilename}) instead of small video file (${foundVideoFile.size} bytes)`);
          return { 
            fileName: screenshotFilename,
            logFile: path.basename(logFilePath),
            metricsFile: path.basename(metricsFilePath)
          };
        }
        
        return { 
          fileName: foundVideoFile.filename,
          logFile: path.basename(logFilePath),
          metricsFile: path.basename(metricsFilePath)
        };
      }
      
      try {
        // At this point, we know the file is valid for ffmpeg processing
        const originalPath = foundVideoFile.path;
        const enhancedPath = path.join(uploadsDir, `enhanced-${foundVideoFile.filename}`);
        
        try {
          // Check if ffmpeg is available
          log('Checking if ffmpeg is available');
          execSync(`${FFMPEG_PATH} -version`, { stdio: 'ignore' });
          
          // Choose optimal encoding settings based on hardware capabilities and measured performance
          let ffmpegCmd;
          
          // If we got good frame rates, use higher quality settings
          const achievedGoodFps = frameStats && frameStats.fps >= TARGET_FPS;
          
          // Add hardware acceleration parameters if available
          const useHardwareAcceleration = USE_HARDWARE_ACCELERATION || isDev;
          const hwAccelParams = useHardwareAcceleration ? '-hwaccel auto -hwaccel_device 0 ' : '';
          
          // Optimize ffmpeg parameters based on the frame rate we achieved
          if (isDev) {
            // Fast mode for development - speed over quality, but still decent
            ffmpegCmd = `${FFMPEG_PATH} -y ${hwAccelParams}-i "${originalPath}" -c:v libvpx-vp9 -b:v 4M ${achievedGoodFps ? '-deadline realtime' : '-deadline good'} -cpu-used ${achievedGoodFps ? '8' : '4'} -pix_fmt yuv420p -quality ${achievedGoodFps ? 'realtime' : 'good'} -crf ${achievedGoodFps ? '30' : '26'} -speed ${achievedGoodFps ? '8' : '6'} -tile-columns 6 -frame-parallel 1 -threads ${numCPUs} "${enhancedPath}"`;
          } else {
            // Balanced mode for production - good quality with reasonable speed
            ffmpegCmd = `${FFMPEG_PATH} -y ${hwAccelParams}-i "${originalPath}" -c:v libvpx-vp9 -b:v 6M -deadline ${achievedGoodFps ? 'good' : 'best'} -cpu-used ${achievedGoodFps ? '4' : '2'} -pix_fmt yuv420p -quality good -crf ${achievedGoodFps ? '22' : '18'} -speed ${achievedGoodFps ? '3' : '2'} -tile-columns 4 -frame-parallel 1 -threads ${numCPUs} "${enhancedPath}"`;
          }
          
          // Add frame rate info to the log
          log(`Enhancing video with ffmpeg (quality: ${achievedGoodFps ? 'optimized for speed' : 'optimized for quality'}, hardware acceleration: ${useHardwareAcceleration ? 'enabled' : 'disabled'}): ${enhancedPath}`);
          log(`Measured performance: ${frameStats ? frameStats.fps + ' FPS' : 'No measurements available'}`);
          log(`ffmpeg command: ${ffmpegCmd}`);
          
          // Enhance video with ffmpeg for smoother playback
          try {
            execSync(ffmpegCmd, { 
              stdio: 'inherit',
              timeout: 120000 // 120 second timeout for higher quality processing
            });
            
            // If enhancement succeeded, use the enhanced file
            if (fs.existsSync(enhancedPath) && fs.statSync(enhancedPath).size > 0) {
              log(`Enhanced file exists: ${enhancedPath}, size: ${fs.statSync(enhancedPath).size} bytes`);
              log(`Using enhanced video: ${enhancedPath}`);
              return { 
                fileName: path.basename(enhancedPath),
                logFile: path.basename(logFilePath),
                metricsFile: path.basename(metricsFilePath)
              };
            } else {
              log(`Enhanced video creation failed or resulted in empty file. Using original video.`);
              return { 
                fileName: foundVideoFile.filename,
                logFile: path.basename(logFilePath),
                metricsFile: path.basename(metricsFilePath)
              };
            }
          } catch (ffmpegCmdError) {
            log(`FFmpeg command execution failed: ${ffmpegCmdError.message}`);
            log(`Returning original unenhanced video file`);
            return { 
              fileName: foundVideoFile.filename,
              logFile: path.basename(logFilePath),
              metricsFile: path.basename(metricsFilePath)
            };
          }
        } catch (ffmpegError) {
          log(`FFmpeg enhancement failed: ${ffmpegError.message}`);
          log(`FFmpeg error stack: ${ffmpegError.stack}`);
          return { 
            fileName: foundVideoFile.filename,
            logFile: path.basename(logFilePath),
            metricsFile: path.basename(metricsFilePath)
          };
        }
      } catch (enhancementError) {
        log(`Video enhancement error: ${enhancementError.message}`);
        log(`Enhancement error stack: ${enhancementError.stack}`);
        return { 
          fileName: foundVideoFile.filename,
          logFile: path.basename(logFilePath),
          metricsFile: path.basename(metricsFilePath)
        };
      }
    }
  } catch (error) {
    log(`Recording error: ${error.message}`);
    log(`Recording error stack: ${error.stack}`);
    // Return the log file name even if there was an error
    return { 
      error: error.message,
      logFile: path.basename(logFilePath),
      metricsFile: path.basename(metricsFilePath)
    };
  } finally {
    if (browser) {
      log('Closing browser');
      try {
        await browser.close();
        log('Browser closed');
      } catch (closeError) {
        log(`Error closing browser: ${closeError.message}`);
      }
    }
    
    log(`Recording session ${sessionId} complete`);
  }
}

// Function to get the most recent log file
function getLatestLogFile() {
  try {
    if (!fs.existsSync(logsDir)) {
      return null;
    }
    
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(logsDir, file);
        return {
          name: file,
          path: filePath,
          time: fs.statSync(filePath).mtime.getTime()
        };
      })
      .sort((a, b) => b.time - a.time); // Sort by most recent first
    
    return logFiles.length > 0 ? logFiles[0] : null;
  } catch (error) {
    console.error(`Error finding latest log file: ${error.message}`);
    return null;
  }
}

module.exports = { recordWebsite, getLatestLogFile };