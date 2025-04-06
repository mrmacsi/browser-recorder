const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

// Balanced video configuration for speed and quality
const VIDEO_FPS = 60;
const VIDEO_WIDTH = 1920;  // Full HD standard
const VIDEO_HEIGHT = 1080;
const VIDEO_BITRATE = '12M';  // 12 Mbps for good quality
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const USE_HARDWARE_ACCELERATION = true;
const CODEC = 'libvpx-vp9';
const QUALITY_PRESET = 'good'; // Balanced preset
const TWO_PASS_ENCODING = false; // Single-pass for speed
const THREAD_COUNT = 8; // Use all available cores

// System-specific optimization
const AVAILABLE_CORES = 8;
const AVAILABLE_MEMORY = 16; // GB

// Debugging flag - set to true for verbose file system operations
const DEBUG_FILE_OPERATIONS = true;

// Initialize directories
const logsDir = path.resolve(__dirname, 'logs');
const metricsDir = path.resolve(__dirname, 'logs', 'metrics');
const uploadsDir = path.resolve(__dirname, 'uploads');
const tempVideoDir = path.resolve(__dirname, 'temp_videos');

// Create necessary directories
[logsDir, metricsDir, uploadsDir, tempVideoDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Determine optimal temp directory with improved memory management
const isAzureVM = fs.existsSync('/mnt/resource');
const ramDiskExists = fs.existsSync('/mnt/ramdisk');
const macOSRamDisk = path.join(os.tmpdir(), 'recorder_ramdisk');
const ubuntuRamDisk = '/mnt/recorder_ramdisk';
const azureTempDir = '/mnt/resource/browser-recorder/temp';

// Detect if running on Ubuntu
function isUbuntu() {
  try {
    if (os.platform() !== 'linux') return false;
    
    // Check for Ubuntu-specific files
    if (fs.existsSync('/etc/lsb-release')) {
      const releaseInfo = fs.readFileSync('/etc/lsb-release', 'utf8');
      return releaseInfo.toLowerCase().includes('ubuntu');
    }
    
    return false;
  } catch (error) {
    console.error(`Error detecting Ubuntu: ${error.message}`);
    return false;
  }
}

// Create RAM disk on Ubuntu if possible
function setupUbuntuRamDisk(size = '2G') {
  try {
    // Check if we're on Ubuntu
    if (!isUbuntu()) return null;
    
    console.log('Detected Ubuntu system, setting up RAM disk...');
    
    // Check if RAM disk already exists
    if (fs.existsSync(ubuntuRamDisk) && isRamDiskMounted(ubuntuRamDisk)) {
      console.log(`Ubuntu RAM disk already exists at ${ubuntuRamDisk}`);
      
      // Ensure correct permissions
      try {
        const result = execSync(`sudo chmod 777 ${ubuntuRamDisk} 2>&1`).toString();
        console.log(`Set permissions on existing RAM disk: ${result.trim() || 'Success'}`);
      } catch (permError) {
        console.log(`Warning: Could not set permissions on ${ubuntuRamDisk}: ${permError.message}`);
      }
      
      return ubuntuRamDisk;
    }
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(ubuntuRamDisk)) {
      try {
        execSync(`sudo mkdir -p ${ubuntuRamDisk} 2>&1`);
        console.log(`Created Ubuntu RAM disk directory at ${ubuntuRamDisk}`);
      } catch (mkdirError) {
        console.error(`Error creating RAM disk directory: ${mkdirError.message}`);
        return null;
      }
    }
    
    // Mount the RAM disk
    try {
      const mountResult = execSync(`sudo mount -t tmpfs -o size=${size} tmpfs ${ubuntuRamDisk} 2>&1`).toString();
      console.log(`Mounted RAM disk: ${mountResult.trim() || 'Success'}`);
      
      // Set permissions
      execSync(`sudo chmod 777 ${ubuntuRamDisk} 2>&1`);
      
      console.log(`Ubuntu RAM disk created successfully at ${ubuntuRamDisk} with size ${size}`);
      return ubuntuRamDisk;
    } catch (mountError) {
      console.error(`Error mounting RAM disk: ${mountError.message}`);
      return null;
    }
  } catch (error) {
    console.error(`Error setting up Ubuntu RAM disk: ${error.message}`);
    return null;
  }
}

// Check if a path is mounted as a RAM disk
function isRamDiskMounted(mountPath) {
  try {
    if (os.platform() !== 'linux') return false;
    
    const mountInfo = execSync('mount').toString();
    return mountInfo.includes(`tmpfs on ${mountPath}`);
  } catch (error) {
    console.error(`Error checking if RAM disk is mounted: ${error.message}`);
    return false;
  }
}

// Unmount Ubuntu RAM disk
function unmountUbuntuRamDisk(logger = console.log) {
  if (!isUbuntu() || !isRamDiskMounted(ubuntuRamDisk)) return false;
  
  try {
    logger(`Unmounting Ubuntu RAM disk at ${ubuntuRamDisk}...`);
    execSync(`sudo umount ${ubuntuRamDisk} 2>&1`);
    logger('RAM disk unmounted successfully');
    return true;
  } catch (error) {
    logger(`Error unmounting RAM disk: ${error.message}`);
    return false;
  }
}

// Create RAM disk on macOS if possible
function setupMacOSRamDisk() {
  try {
    // Check if on macOS
    if (os.platform() === 'darwin') {
      if (!fs.existsSync(macOSRamDisk)) {
        fs.mkdirSync(macOSRamDisk, { recursive: true });
        console.log(`Created macOS RAM disk directory at ${macOSRamDisk}`);
      }
      
      // Set permissions
      try {
        fs.chmodSync(macOSRamDisk, 0o777);
      } catch (err) {
        console.log(`Warning: Could not set permissions on ${macOSRamDisk}: ${err.message}`);
      }
      
      return macOSRamDisk;
    }
    return null;
  } catch (error) {
    console.error(`Error creating macOS RAM disk: ${error.message}`);
    return null;
  }
}

// Cleanup macOS RAM disk completely
function cleanupMacOSRamDisk(logger = console.log) {
  if (os.platform() === 'darwin' && tempDir === macOSRamDisk && fs.existsSync(macOSRamDisk)) {
    try {
      logger(`Performing complete cleanup of macOS RAM disk at ${macOSRamDisk}`);
      
      // Read directory contents
      const items = fs.readdirSync(macOSRamDisk);
      
      // Track cleanup stats for logging
      let deletedFiles = 0;
      let deletedDirs = 0;
      let errors = 0;
      
      // Helper function for recursive deletion
      const deleteItem = (itemPath) => {
        try {
          const stats = fs.statSync(itemPath);
          
          if (stats.isDirectory()) {
            // Recursively clean subdirectories
            const subItems = fs.readdirSync(itemPath);
            subItems.forEach(subItem => {
              deleteItem(path.join(itemPath, subItem));
            });
            
            // Delete the directory itself
            fs.rmdirSync(itemPath);
            deletedDirs++;
            
          } else {
            // Delete files
            fs.unlinkSync(itemPath);
            deletedFiles++;
          }
        } catch (err) {
          logger(`Error cleaning up item ${itemPath}: ${err.message}`);
          errors++;
        }
      };
      
      // Process all items in the RAM disk
      items.forEach(item => {
        deleteItem(path.join(macOSRamDisk, item));
      });
      
      logger(`RAM disk cleanup complete: deleted ${deletedFiles} files and ${deletedDirs} directories with ${errors} errors`);
      
      // Don't delete the RAM disk root itself as it may be reused
      // But ensure it's empty
      return true;
    } catch (error) {
      logger(`Error during RAM disk cleanup: ${error.message}`);
      return false;
    }
  }
  return false;
}

// Cleanup Ubuntu RAM disk completely
function cleanupUbuntuRamDisk(logger = console.log) {
  if (isUbuntu() && tempDir === ubuntuRamDisk && fs.existsSync(ubuntuRamDisk)) {
    try {
      logger(`Performing complete cleanup of Ubuntu RAM disk at ${ubuntuRamDisk}`);
      
      // Read directory contents
      const items = fs.readdirSync(ubuntuRamDisk);
      
      // Track cleanup stats for logging
      let deletedFiles = 0;
      let deletedDirs = 0;
      let errors = 0;
      
      // Helper function for recursive deletion
      const deleteItem = (itemPath) => {
        try {
          const stats = fs.statSync(itemPath);
          
          if (stats.isDirectory()) {
            // Recursively clean subdirectories
            const subItems = fs.readdirSync(itemPath);
            subItems.forEach(subItem => {
              deleteItem(path.join(itemPath, subItem));
            });
            
            // Delete the directory itself
            fs.rmdirSync(itemPath);
            deletedDirs++;
            
          } else {
            // Delete files
            fs.unlinkSync(itemPath);
            deletedFiles++;
          }
        } catch (err) {
          logger(`Error cleaning up item ${itemPath}: ${err.message}`);
          errors++;
        }
      };
      
      // Process all items in the RAM disk
      items.forEach(item => {
        deleteItem(path.join(ubuntuRamDisk, item));
      });
      
      logger(`Ubuntu RAM disk cleanup complete: deleted ${deletedFiles} files and ${deletedDirs} directories with ${errors} errors`);
      
      return true;
    } catch (error) {
      logger(`Error during Ubuntu RAM disk cleanup: ${error.message}`);
      return false;
    }
  }
  return false;
}

// Choose the best temp directory available
let tempDir;
if (isAzureVM && fs.existsSync(azureTempDir)) {
  tempDir = azureTempDir;
  console.log(`Using Azure VM temp directory: ${tempDir}`);
} else if (ramDiskExists) {
  tempDir = '/mnt/ramdisk';
  console.log(`Using existing RAM disk: ${tempDir}`);
} else if (isUbuntu()) {
  const ubuntuRamDir = setupUbuntuRamDisk('2G');
  if (ubuntuRamDir) {
    tempDir = ubuntuRamDir;
    console.log(`Using Ubuntu RAM disk: ${tempDir}`);
  } else {
    tempDir = tempVideoDir;
    console.log(`Falling back to regular temp directory: ${tempDir}`);
  }
} else if (os.platform() === 'darwin') {
  const macRamDir = setupMacOSRamDisk();
  if (macRamDir) {
    tempDir = macRamDir;
    console.log(`Using macOS RAM disk: ${tempDir}`);
  } else {
    tempDir = tempVideoDir;
    console.log(`Falling back to regular temp directory: ${tempDir}`);
  }
} else {
  tempDir = tempVideoDir; // Use our dedicated temp directory
  console.log(`Using default temp directory: ${tempDir}`);
}

// Enhanced logger for monitoring recording performance
function createSessionLogger(sessionId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFilePath = path.join(logsDir, `recording-${sessionId}-${timestamp}.log`);
  const metricsFilePath = path.join(metricsDir, `metrics-${sessionId}-${timestamp}.log`);
  
  // Create write streams
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  const metricsStream = fs.createWriteStream(metricsFilePath, { flags: 'a' });
  
  // Logger functions
  const logger = (message) => {
    const timestampedMessage = `[${new Date().toISOString()}] ${message}`;
    console.log(timestampedMessage);
    logStream.write(timestampedMessage + '\n');
  };
  
  const metricsLogger = (message) => {
    const timestampedMessage = `[${new Date().toISOString()}] ${message}`;
    console.log(`METRICS: ${timestampedMessage}`);
    metricsStream.write(timestampedMessage + '\n');
  };
  
  // Initialize metrics file with header
  metricsLogger(`Metrics file created for session ${sessionId}`);
  
  return { log: logger, logMetrics: metricsLogger, logFilePath, metricsFilePath };
}

// Function to enhance video quality using ffmpeg with two-pass encoding
async function enhanceVideoQuality(inputPath, outputPath, logger, videoOptions = {}) {
  return new Promise((resolve, reject) => {
    logger(`Enhancing video quality with two-pass encoding: ${inputPath} -> ${outputPath}`);
    
    // Create temp directory for pass logs if needed
    const passLogDir = path.join(tempDir, 'passes');
    if (!fs.existsSync(passLogDir)) {
      fs.mkdirSync(passLogDir, { recursive: true });
    }
    
    const passLogPath = path.join(passLogDir, `pass-${uuidv4().substr(0, 8)}`);
    
    // Single-pass encoding as fallback
    const singlePassEncode = async () => {
      logger(`Starting single-pass encoding...`);
      
      // Get aspect ratio if provided (for vertical videos etc.)
      const aspectRatio = videoOptions.aspectRatio || null;
      const videoWidth = videoOptions.width || null;
      const videoHeight = videoOptions.height || null;
      const duration = videoOptions.duration || null;
      
      return new Promise((resolvePass, rejectPass) => {
        const ffmpegArgs = [
          '-i', inputPath,
          '-c:v', CODEC,
          '-b:v', VIDEO_BITRATE,
          '-deadline', 'good',
          '-cpu-used', '2',  // Faster processing (0=best quality, 4=faster)
          '-threads', THREAD_COUNT.toString(),
          '-auto-alt-ref', '1',
          '-lag-in-frames', '16', // Reduced from 25 for speed
          '-frame-parallel', '1',
          '-tile-columns', '4', // More tiles for parallel processing
          '-pix_fmt', 'yuv420p', // Standard pixel format (faster)
          '-r', `${VIDEO_FPS}`,
        ];
        
        // Add duration trimming if specified
        if (duration) {
          ffmpegArgs.splice(0, 0, '-t', duration.toString());
          logger(`Limiting video duration to ${duration} seconds`);
        }
        
        // Add aspect ratio forcing for vertical videos if specified
        if (aspectRatio && videoWidth && videoHeight) {
          // For vertical videos, ensure exact dimensions with -s parameter
          ffmpegArgs.push('-s', `${videoWidth}x${videoHeight}`);
          ffmpegArgs.push('-aspect', aspectRatio);
          logger(`Enforcing aspect ratio ${aspectRatio} with dimensions ${videoWidth}x${videoHeight}`);
        } else {
          ffmpegArgs.push('-vf', 'scale=out_color_matrix=bt709');
        }
        
        // Add memory optimization options
        ffmpegArgs.push('-max_muxing_queue_size', '9999');
        ffmpegArgs.push('-avoid_negative_ts', '1');
        
        // Add remaining arguments
        ffmpegArgs.push(
          '-movflags', '+faststart',
          '-y',
          outputPath
        );
        
        logger(`Running single-pass with args: ${ffmpegArgs.join(' ')}`);
        
        const ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs);
        
        ffmpegProcess.stdout.on('data', (data) => {
          logger(`ffmpeg stdout: ${data}`);
        });
        
        ffmpegProcess.stderr.on('data', (data) => {
          logger(`ffmpeg stderr: ${data}`);
        });
        
        ffmpegProcess.on('close', (code) => {
          if (code === 0) {
            logger(`Single-pass encoding completed successfully: ${outputPath}`);
            resolvePass(outputPath);
          } else {
            logger(`ffmpeg exited with code ${code}`);
            // Fall back to original if enhancement fails
            fs.copyFileSync(inputPath, outputPath);
            logger(`Falling back to original video due to ffmpeg error`);
            resolvePass(outputPath);
          }
        });
        
        ffmpegProcess.on('error', (err) => {
          logger(`ffmpeg error: ${err.message}`);
          rejectPass(err);
        });
      });
    };
    
    // Execute encoding with preferences
    (async () => {
      try {
        await singlePassEncode();
        resolve(outputPath);
      } catch (err) {
        logger(`All encoding attempts failed: ${err.message}`);
        reject(err);
      }
    })();
  });
}

// Platform dimension presets with industry standard resolutions
const DIMENSIONS = {
  SQUARE: { aspect: '1:1', width: { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 }, height: { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 } },
  VERTICAL_9_16: { aspect: '9:16', width: { '720p': 405, '1080p': 608, '1440p': 810, '2160p': 1215 }, height: { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 } },
  STANDARD_16_9: { aspect: '16:9', width: { '720p': 1280, '1080p': 1920, '1440p': 2560, '2160p': 3840 }, height: { '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 } }
};

// Resolution presets (using 16:9 as reference)
const RESOLUTIONS = {
  '720p': { width: 1280, height: 720 },    // HD
  '1080p': { width: 1920, height: 1080 },  // Full HD
  '1440p': { width: 2560, height: 1440 },  // QHD (2K)
  '2160p': { width: 3840, height: 2160 }   // UHD (4K)
};

// API endpoint for recording with platform dimensions
async function recordWithPlatformSettings(url, options = {}) {
  // Set defaults
  const platform = options.platform?.toUpperCase() || 'STANDARD_16_9';
  const resolution = options.resolution || '1080p';
  const duration = options.duration || 10;
  const quality = options.quality || 'balanced';
  const fps = options.fps || VIDEO_FPS;

  // Validate platform
  if (!DIMENSIONS[platform]) {
    throw new Error(`Invalid platform: ${options.platform}. Supported platforms: SQUARE, VERTICAL_9_16, STANDARD_16_9`);
  }

  // Validate resolution
  if (!RESOLUTIONS[resolution]) {
    throw new Error(`Invalid resolution: ${resolution}. Supported resolutions: 720p, 1080p, 1440p, 2160p`);
  }

  // Get dimensions from presets
  const width = DIMENSIONS[platform].width[resolution];
  const height = DIMENSIONS[platform].height[resolution];
  
  // Ensure width is even (required for some encoders)
  const adjustedWidth = width % 2 === 0 ? width : width + 1;

  console.log(`Recording with ${platform} format (${adjustedWidth}x${height}) at ${resolution} resolution`);

  // Record with specified dimensions and enforce aspect ratio
  const result = await recordWebsite(url, duration, {
    width: adjustedWidth,
    height,
    fps,
    quality,
    platform,
    aspectRatio: DIMENSIONS[platform].aspect
  });
  
  // Ensure metadata is consistently returned
  return {
    ...result,
    width: adjustedWidth,
    height,
    fps,
    resolution,
    platform,
    aspectRatio: DIMENSIONS[platform].aspect,
    duration
  };
}

// Record a website with balanced quality
async function recordWebsite(url, duration = 10, options = {}) {
  const sessionId = uuidv4().substr(0, 8);
  const { log, logMetrics, logFilePath, metricsFilePath } = createSessionLogger(sessionId);
  const sessionStartTime = Date.now();
  
  // Allow overriding default settings through options
  const videoWidth = options.width || VIDEO_WIDTH;
  const videoHeight = options.height || VIDEO_HEIGHT;
  const videoFps = options.fps || VIDEO_FPS;
  const fastMode = options.fastMode !== undefined ? options.fastMode : true; // Default to fast mode
  const quality = options.quality || 'balanced'; // 'low', 'balanced', 'high'
  const platform = options.platform || null;
  const aspectRatio = options.aspectRatio || null;
  
  // Add platform parameter to URL if it's not already there and platform is specified
  let recordingUrl = url;
  if (platform && !url.includes('platform=')) {
    const separator = url.includes('?') ? '&' : '?';
    recordingUrl = `${url}${separator}platform=${platform}`;
    log(`Added platform=${platform} parameter to URL: ${recordingUrl}`);
  }
  
  // Adjust quality settings based on selected quality profile
  let cpuUsed, pixFmt, encodeQuality;
  switch (quality) {
    case 'low':
      cpuUsed = 4;
      pixFmt = 'yuv420p';
      encodeQuality = 'realtime';
      break;
    case 'high':
      cpuUsed = 1;
      pixFmt = 'yuv420p';
      encodeQuality = 'good';
      break;
    case 'balanced':
    default:
      cpuUsed = 2;
      pixFmt = 'yuv420p';
      encodeQuality = 'good';
  }
  
  // Log system info with GPU details
  const numCPUs = os.cpus().length;
  const totalMem = Math.floor(os.totalmem() / (1024 * 1024 * 1024));
  
  log(`Starting balanced recording session ${sessionId} for ${recordingUrl} with duration ${duration}s`);
  log(`System: ${numCPUs} CPU cores, ${totalMem}GB RAM, ${os.platform()}`);
  log(`Video settings: ${videoWidth}x${videoHeight} @ ${videoFps}fps, ${VIDEO_BITRATE} bitrate`);
  log(`Quality profile: ${quality}, Fast mode: ${fastMode ? 'ON' : 'OFF'}`);
  log(`Hardware acceleration: ${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);
  log(`Temp directory: ${tempDir}`);
  log(`Session started at: ${new Date(sessionStartTime).toISOString()}`);
  
  // Log system metrics
  logMetrics(`SESSION_START,ID=${sessionId},URL=${recordingUrl},DURATION=${duration}s`);
  logMetrics(`SYSTEM,CORES=${numCPUs},RAM=${totalMem}GB,PLATFORM=${os.platform()},RELEASE=${os.release()}`);
  logMetrics(`VIDEO_SETTINGS,WIDTH=${videoWidth},HEIGHT=${videoHeight},FPS=${videoFps},BITRATE=${VIDEO_BITRATE}`);
  logMetrics(`QUALITY_PROFILE=${quality},FAST_MODE=${fastMode},HARDWARE_ACCELERATION=${USE_HARDWARE_ACCELERATION ? 'Enabled' : 'Disabled'}`);
  
  // Regular log memory usage
  const initialMemUsage = process.memoryUsage();
  logMetrics(`MEMORY_USAGE,RSS=${Math.round(initialMemUsage.rss / 1024 / 1024)}MB,HEAP_TOTAL=${Math.round(initialMemUsage.heapTotal / 1024 / 1024)}MB,HEAP_USED=${Math.round(initialMemUsage.heapUsed / 1024 / 1024)}MB`);
  
  // Generate filenames
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawVideoFilename = `raw-recording-${sessionId}-${timestamp}.webm`;
  const rawVideoPath = path.join(tempDir, rawVideoFilename);
  const finalVideoFilename = `recording-${sessionId}-${timestamp}.webm`;
  const finalVideoPath = path.join(uploadsDir, finalVideoFilename);
  
  // Launch browser
  let browser;
  let context;
  let page;
  let recordedVideoPath;
  
  try {
    // Enhanced browser arguments for better rendering on high-end system
    const browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-extensions',
      '--mute-audio',
      
      // Hardware acceleration optimizations - fully enabled
      '--enable-gpu-rasterization',
      '--enable-accelerated-video-decode',
      '--enable-accelerated-2d-canvas',
      '--enable-accelerated-video',
      '--ignore-gpu-blocklist',
      '--force-gpu-rasterization',
      '--enable-oop-rasterization',
      '--enable-zero-copy',
      '--use-angle=gl',
      
      // Frame rate and rendering optimizations
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      
      // Memory optimizations for 16GB system
      `--js-flags=--max-old-space-size=${Math.floor(AVAILABLE_MEMORY * 1024 * 0.25)}`, // 25% of available RAM
      '--memory-pressure-off',
      '--disable-renderer-backgrounding',
      
      // RAM usage optimizations
      '--enable-features=MemoryOptimization',
      '--enable-javascript-harmony',
      '--single-process', // Use single process to maximize RAM usage efficiency
      '--disable-site-isolation-trials',
      
      // Better compositing
      '--enable-features=VaapiVideoDecoder,CanvasOopRasterization,VizDisplayCompositor',
      
      // Thread optimizations for 8-core system
      '--renderer-process-limit=8',
      '--num-raster-threads=8',
      '--enable-thread-composting'
    ];
    
    // Platform-specific optimizations
    if (os.platform() === 'linux') {
      browserArgs.push('--use-gl=egl');
    }
    
    // Log browser launch time
    const browserStartTime = Date.now();
    logMetrics(`BROWSER_LAUNCH_START,TIME=${browserStartTime}`);
    
    // Launch browser with longer timeout and better gpu usage
    log('Launching browser with enhanced graphics settings...');
    browser = await chromium.launch({
      headless: true,
      args: browserArgs,
      timeout: 60000,
      chromiumSandbox: false,
      handleSIGINT: true,
      handleSIGTERM: true,
      handleSIGHUP: true
    });
    
    const browserLaunchDuration = Date.now() - browserStartTime;
    logMetrics(`BROWSER_LAUNCH_COMPLETE,DURATION=${browserLaunchDuration}ms`);
    log('Browser launched successfully with enhanced graphics settings');
    
    // Create browser context with high quality video recording
    log('Creating browser context with high quality video recording...');
    
    // First, ensure temp directory exists with proper permissions
    if (!fs.existsSync(tempDir)) {
      log(`Creating temp directory: ${tempDir}`);
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Set explicit video filename to avoid path detection issues
    const recordingFileName = `recording-${sessionId}-${Date.now()}.webm`;
    const recordingPath = path.join(tempDir, recordingFileName);
    log(`Setting explicit recording path: ${recordingPath}`);
    
    // Log context creation time
    const contextStartTime = Date.now();
    logMetrics(`CONTEXT_CREATION_START,TIME=${contextStartTime}`);
    
    context = await browser.newContext({
      viewport: { width: videoWidth, height: videoHeight },
      deviceScaleFactor: 2, // Better rendering on high-DPI displays
      colorScheme: 'light', // More consistent rendering
      recordVideo: {
        dir: tempDir,
        size: { width: videoWidth, height: videoHeight },
        fps: videoFps,
        path: recordingPath // Explicitly set the recording path
      },
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      bypassCSP: true, // Allow loading of all resources
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    const contextCreationDuration = Date.now() - contextStartTime;
    logMetrics(`CONTEXT_CREATION_COMPLETE,DURATION=${contextCreationDuration}ms`);
    
    // Store known recording path for later use if Playwright fails to return it
    page = await context.newPage();
    recordedVideoPath = recordingPath; // Pre-set the path we know it should use
    log('Browser context created with high quality settings');
    
    // Page was already created when setting up the context
    log('Page already created, configuring with optimized settings...');
    
    // Set extra headers for better content loading
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    });
    
    // Enable better JS performance and add viewport information
    await page.addInitScript(({ width, height, aspectRatio }) => {
      window.devicePixelRatio = 2; // Force high DPI rendering
      
      // Make viewport dimensions and aspect ratio available to the page
      window.recordingViewport = {
        width: width,
        height: height,
        aspectRatio: aspectRatio
      };
      
      // Add a style tag to optimize for vertical/landscape content if needed
      if (aspectRatio) {
        const style = document.createElement('style');
        style.textContent = `
          :root {
            --recording-width: ${width}px;
            --recording-height: ${height}px;
            --recording-aspect-ratio: ${aspectRatio};
          }
          
          /* Add viewport-specific optimizations */
          @media (max-width: 500px) {
            body {
              max-width: ${width}px;
              width: 100%;
              overflow-x: hidden;
            }
          }
        `;
        document.head.appendChild(style);
      }
    }, { 
      width: videoWidth, 
      height: videoHeight, 
      aspectRatio: options.aspectRatio 
    });
    
    log('Page created with optimized settings');
    
    // Log the navigation time
    const navigationStartTime = Date.now();
    logMetrics(`PAGE_NAVIGATION_START,URL=${recordingUrl},TIME=${navigationStartTime}`);
    
    // Navigate to URL with better settings
    log(`Loading page with high quality settings: ${recordingUrl}`);
    await page.goto(recordingUrl, { 
      waitUntil: 'networkidle',
      timeout: 60000
    });
    
    const navigationDuration = Date.now() - navigationStartTime;
    logMetrics(`PAGE_NAVIGATION_COMPLETE,DURATION=${navigationDuration}ms,TITLE="${await page.title()}"`);
    
    log(`Page loaded. Title: ${await page.title()}`);
    
    // Let the page stabilize for smoother video start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // For vertical videos, adjust the content to fit better
    if (options.aspectRatio === '9:16') {
      await page.evaluate(async () => {
        // Add viewport-specific adjustment for vertical videos
        const style = document.createElement('style');
        style.textContent = `
          body, html {
            width: 100%;
            max-width: 100%;
            overflow-x: hidden;
          }
          .container, .main, main, .content {
            width: 100%;
            max-width: 100%;
            margin-left: 0;
            margin-right: 0;
            padding-left: 0;
            padding-right: 0;
          }
        `;
        document.head.appendChild(style);
      });
      log('Added vertical video optimizations to page');
      logMetrics(`VERTICAL_OPTIMIZATIONS_APPLIED,ASPECT_RATIO=${options.aspectRatio}`);
    }
    
    // Scroll the page to ensure all content is rendered
    const scrollStartTime = Date.now();
    logMetrics(`PAGE_SCROLL_START,TIME=${scrollStartTime}`);
    
    await page.evaluate(async () => {
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const height = document.body.scrollHeight;
      
      // Smooth scroll down and back up for better content loading
      for (let i = 0; i < height; i += 100) {
        window.scrollTo(0, i);
        await delay(50);
      }
      
      // Scroll back to top
      window.scrollTo(0, 0);
    });
    
    const scrollDuration = Date.now() - scrollStartTime;
    logMetrics(`PAGE_SCROLL_COMPLETE,DURATION=${scrollDuration}ms`);
    
    log('Page content fully rendered for better video quality');
    
    // Log recording start
    const recordingStartTime = Date.now();
    logMetrics(`RECORDING_START,TIME=${recordingStartTime},DURATION=${duration}s`);
    
    // Wait for recording duration
    log(`Recording high quality video for ${duration} seconds...`);
    await new Promise(resolve => setTimeout(resolve, duration * 1000));
    
    const recordingDuration = Date.now() - recordingStartTime;
    logMetrics(`RECORDING_COMPLETE,DURATION=${recordingDuration}ms`);
    log('Recording duration completed');
    
    // Close page to finish recording
    log('Closing page to end recording...');
    if (page && !page.isClosed()) {
      await page.close();
      log('Page closed');
    }
    
    // Close context to ensure video is saved
    log('Closing context to finish video recording...');
    if (context) {
      try {
        // Wait before closing to ensure video data is flushed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Close context - in newer Playwright versions, this might not return the video path
        const contextVideoPath = await context.close();
        
        if (contextVideoPath && fs.existsSync(contextVideoPath)) {
          // If Playwright returns a valid path, use it
          recordedVideoPath = contextVideoPath;
          log(`Context closed, returned valid video path: ${recordedVideoPath}`);
        } else if (recordedVideoPath && fs.existsSync(recordedVideoPath)) {
          // Otherwise use our pre-set path if it exists
          log(`Using pre-set recording path: ${recordedVideoPath}`);
        } else {
          log(`No valid video path from context.close() or pre-set path`);
        }
      } catch (contextError) {
        log(`Error closing context: ${contextError.message}`);
      }
      
      // Wait additional time for filesystem operations to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // If no valid path, search in temp directory
    if (!recordedVideoPath || !fs.existsSync(recordedVideoPath)) {
      log('No valid video path returned, searching temp directory for recordings...');
      
      try {
        if (!fs.existsSync(tempDir)) {
          log(`Temp directory doesn't exist: ${tempDir}`);
          return { error: "Temp directory not found", logFile: path.basename(logFilePath) };
        }
        
        // List all files in temp directory
        const files = fs.readdirSync(tempDir);
        log(`Found ${files.length} files in temp directory`);
        
        // Filter for .webm files created during this session
        const recentVideos = files
          .filter(file => file.endsWith('.webm'))
          .map(file => {
            const fullPath = path.join(tempDir, file);
            const stats = fs.statSync(fullPath);
            return {
              path: fullPath,
              mtime: stats.mtime.getTime(),
              size: stats.size
            };
          })
          .filter(video => {
            return video.mtime >= sessionStartTime && video.size > 1024;
          })
          .sort((a, b) => b.mtime - a.mtime); // Most recent first
        
        log(`Found ${recentVideos.length} recent video files from this session`);
        
        // Log all found videos for debugging
        recentVideos.forEach((video, index) => {
          log(`Video #${index + 1}: ${video.path}, modified: ${new Date(video.mtime).toISOString()}, size: ${video.size} bytes`);
        });
        
        // Use the most recent video if available
        if (recentVideos.length > 0) {
          recordedVideoPath = recentVideos[0].path;
          log(`Using most recent video: ${recordedVideoPath}, size: ${recentVideos[0].size} bytes`);
          logMetrics(`VIDEO_FOUND,PATH=${recordedVideoPath},SIZE=${recentVideos[0].size}`);
        } else {
          log(`No recent videos found in temp directory`);
          logMetrics(`ERROR,NO_VIDEOS_FOUND,TEMP_DIR=${tempDir}`);
        }
      } catch (searchError) {
        log(`Error searching for videos: ${searchError.message}`);
        logMetrics(`ERROR,SEARCH_FAILED,MESSAGE=${searchError.message}`);
      }
    }
    
    // Handle the recording file and enhance quality
    if (recordedVideoPath && fs.existsSync(recordedVideoPath)) {
      const fileSize = fs.statSync(recordedVideoPath).size;
      log(`Raw video found, size: ${fileSize} bytes`);
      
      // Copy to the raw video location first
      log(`Copying raw video to: ${rawVideoPath}`);
      fs.copyFileSync(recordedVideoPath, rawVideoPath);
      
      // Enhance the video quality with ffmpeg
      log('Enhancing video quality with ffmpeg...');
      logMetrics(`ENHANCEMENT_START,TIME=${Date.now()},RAW_SIZE=${fileSize}`);
      
      try {
        // Enhance the video quality, passing options for aspect ratio
        await enhanceVideoQuality(rawVideoPath, finalVideoPath, log, {
          width: videoWidth,
          height: videoHeight,
          aspectRatio: options.aspectRatio,
          duration: duration
        });
        
        if (fs.existsSync(finalVideoPath)) {
          const enhancedSize = fs.statSync(finalVideoPath).size;
          log(`Enhanced video created successfully: ${finalVideoPath}, size: ${enhancedSize} bytes`);
          logMetrics(`ENHANCEMENT_COMPLETE,ENHANCED_SIZE=${enhancedSize},COMPRESSION_RATIO=${(enhancedSize/fileSize).toFixed(2)}`);
          
          // Set proper permissions
          fs.chmodSync(finalVideoPath, 0o644);
          
          // Return the enhanced video path
          return { 
            fileName: path.basename(finalVideoPath),
            logFile: path.basename(logFilePath),
            metricsFile: path.basename(metricsFilePath),
            enhanced: true,
            width: videoWidth,
            height: videoHeight,
            fps: videoFps,
            duration: duration,
            quality: quality,
            platform: platform,
            aspectRatio: options.aspectRatio,
            size: enhancedSize
          };
        } else {
          log('Failed to create enhanced video, falling back to original');
          logMetrics(`ENHANCEMENT_FAILED,REASON=NO_OUTPUT_FILE`);
          
          // Copy the original as fallback
          fs.copyFileSync(rawVideoPath, finalVideoPath);
          
          return { 
            fileName: path.basename(finalVideoPath),
            logFile: path.basename(logFilePath),
            metricsFile: path.basename(metricsFilePath),
            enhanced: false,
            width: videoWidth,
            height: videoHeight,
            fps: videoFps,
            duration: duration,
            quality: quality,
            platform: platform,
            aspectRatio: options.aspectRatio,
            size: fs.existsSync(finalVideoPath) ? fs.statSync(finalVideoPath).size : 0
          };
        }
      } catch (enhanceError) {
        log(`Error enhancing video: ${enhanceError.message}`);
        logMetrics(`ENHANCEMENT_ERROR,MESSAGE=${enhanceError.message}`);
        
        // Copy the original as fallback
        fs.copyFileSync(rawVideoPath, finalVideoPath);
        
        return { 
          fileName: path.basename(finalVideoPath),
          logFile: path.basename(logFilePath),
          metricsFile: path.basename(metricsFilePath),
          enhanced: false,
          enhanceError: enhanceError.message,
          width: videoWidth,
          height: videoHeight,
          fps: videoFps,
          duration: duration,
          quality: quality,
          platform: platform,
          aspectRatio: options.aspectRatio,
          size: fs.existsSync(finalVideoPath) ? fs.statSync(finalVideoPath).size : 0
        };
      }
    } else {
      log(`No video recording found at: ${recordedVideoPath}`);
      logMetrics(`ERROR,NO_VIDEO_RECORDING_FOUND,PATH=${recordedVideoPath}`);
    }
    
    // If video recording failed, return error
    log(`Video recording failed`);
    logMetrics(`RECORDING_FAILED,SESSION_DURATION=${Date.now() - sessionStartTime}ms`);
    return { 
      error: "Failed to create video recording",
      logFile: path.basename(logFilePath),
      metricsFile: path.basename(metricsFilePath)
    };
  } catch (error) {
    log(`Recording error: ${error.message}`);
    log(`Error stack: ${error.stack}`);
    logMetrics(`FATAL_ERROR,MESSAGE=${error.message},SESSION_DURATION=${Date.now() - sessionStartTime}ms`);
    
    return { 
      error: error.message,
      logFile: path.basename(logFilePath),
      metricsFile: path.basename(metricsFilePath)
    };
  } finally {
    // Log final memory usage
    const finalMemUsage = process.memoryUsage();
    logMetrics(`FINAL_MEMORY_USAGE,RSS=${Math.round(finalMemUsage.rss / 1024 / 1024)}MB,HEAP_TOTAL=${Math.round(finalMemUsage.heapTotal / 1024 / 1024)}MB,HEAP_USED=${Math.round(finalMemUsage.heapUsed / 1024 / 1024)}MB`);
    
    // Clean up resources in order
    try {
      // Context is usually already closed in the normal flow
      if (context) {
        try {
          await context.close().catch(e => log(`Context close error: ${e.message}`));
          log('Context closed in finally block');
          logMetrics(`CONTEXT_CLOSED_IN_CLEANUP`);
        } catch (contextError) {
          log(`Error closing context: ${contextError.message}`);
          logMetrics(`CONTEXT_CLOSE_ERROR,MESSAGE=${contextError.message}`);
        }
      }
      
      // Always close browser last
      if (browser) {
        await browser.close().catch(e => log(`Browser close error: ${e.message}`));
        log('Browser closed');
        logMetrics(`BROWSER_CLOSED`);
      }
      
      // Cleanup temporary raw video if it exists
      if (fs.existsSync(rawVideoPath)) {
        try {
          fs.unlinkSync(rawVideoPath);
          log(`Temporary raw video deleted: ${rawVideoPath}`);
          logMetrics(`TEMP_RAW_VIDEO_DELETED,PATH=${rawVideoPath}`);
        } catch (unlinkError) {
          log(`Warning: Failed to delete temporary raw video: ${unlinkError.message}`);
          logMetrics(`TEMP_VIDEO_DELETE_ERROR,MESSAGE=${unlinkError.message}`);
        }
      }
      
      // Cleanup all temporary video files in temp directory
      try {
        if (fs.existsSync(tempDir)) {
          const tempFiles = fs.readdirSync(tempDir)
            .filter(file => file.endsWith('.webm'))
            .map(file => path.join(tempDir, file));
          
          // Log number of temp files to be deleted
          log(`Cleaning up ${tempFiles.length} temporary video files from ${tempDir}`);
          logMetrics(`TEMP_CLEANUP_START,FILE_COUNT=${tempFiles.length}`);
          
          // Delete each temporary file
          let deletedCount = 0;
          for (const file of tempFiles) {
            try {
              fs.unlinkSync(file);
              deletedCount++;
            } catch (fileError) {
              log(`Failed to delete temporary file: ${file}, error: ${fileError.message}`);
              logMetrics(`TEMP_FILE_DELETE_ERROR,FILE=${file},MESSAGE=${fileError.message}`);
            }
          }
          
          log(`Successfully deleted ${deletedCount} of ${tempFiles.length} temporary video files`);
          logMetrics(`TEMP_CLEANUP_COMPLETE,DELETED=${deletedCount},TOTAL=${tempFiles.length}`);
        }
      } catch (cleanupError) {
        log(`Error cleaning up temp directory: ${cleanupError.message}`);
        logMetrics(`TEMP_DIR_CLEANUP_ERROR,MESSAGE=${cleanupError.message}`);
      }
    } catch (finallyError) {
      log(`Error in cleanup: ${finallyError.message}`);
      logMetrics(`CLEANUP_ERROR,MESSAGE=${finallyError.message}`);
    }
    
    log(`Recording session ${sessionId} complete`);
    logMetrics(`SESSION_COMPLETE,DURATION=${Date.now() - sessionStartTime}ms`);
    
    // Clean up RAM disk completely if we're using one
    if (os.platform() === 'darwin' && tempDir === macOSRamDisk) {
      // Give a short delay to ensure any pending file operations are complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Perform deep cleanup of RAM disk
      const ramDiskCleaned = cleanupMacOSRamDisk(log);
      if (ramDiskCleaned) {
        log(`RAM disk completely cleaned up at ${tempDir}`);
        logMetrics(`RAM_DISK_CLEANUP_COMPLETE,PATH=${tempDir}`);
      } else {
        log(`RAM disk cleanup skipped or failed`);
        logMetrics(`RAM_DISK_CLEANUP_SKIPPED,PATH=${tempDir}`);
      }
    } else if (isUbuntu() && tempDir === ubuntuRamDisk) {
      // Give a short delay to ensure any pending file operations are complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Perform deep cleanup of Ubuntu RAM disk
      const ramDiskCleaned = cleanupUbuntuRamDisk(log);
      if (ramDiskCleaned) {
        log(`Ubuntu RAM disk completely cleaned up at ${tempDir}`);
        logMetrics(`UBUNTU_RAM_DISK_CLEANUP_COMPLETE,PATH=${tempDir}`);
        
        // Check if we should unmount the RAM disk
        // Only unmount if this is the last process using it
        try {
          const processesUsingRamDisk = parseInt(
            execSync(`lsof ${tempDir} | wc -l`).toString().trim()
          );
          
          if (processesUsingRamDisk <= 1) {
            log(`No other processes using RAM disk, attempting to unmount...`);
            const unmounted = unmountUbuntuRamDisk(log);
            if (unmounted) {
              logMetrics(`UBUNTU_RAM_DISK_UNMOUNTED,PATH=${tempDir}`);
            }
          } else {
            log(`${processesUsingRamDisk} processes still using RAM disk, skipping unmount`);
            logMetrics(`UBUNTU_RAM_DISK_BUSY,PROCESSES=${processesUsingRamDisk}`);
          }
        } catch (processCheckError) {
          log(`Error checking processes using RAM disk: ${processCheckError.message}`);
        }
      } else {
        log(`Ubuntu RAM disk cleanup skipped or failed`);
        logMetrics(`UBUNTU_RAM_DISK_CLEANUP_SKIPPED,PATH=${tempDir}`);
      }
    }
  }
}

// Get the most recent log file
function getLatestLogFile() {
  if (!fs.existsSync(logsDir)) return null;
  
  const logFiles = fs.readdirSync(logsDir)
    .filter(file => file.endsWith('.log'))
    .map(file => ({
      name: file,
      path: path.join(logsDir, file),
      time: fs.statSync(path.join(logsDir, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);
  
  return logFiles.length > 0 ? logFiles[0] : null;
}

// Function to record on multiple platforms simultaneously
async function recordMultiplePlatforms(url, platforms = [], options = {}) {
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error('At least one platform must be specified');
  }

  const sessionId = uuidv4().substr(0, 8);
  const { log, logMetrics, logFilePath } = createSessionLogger(sessionId);
  
  log(`Starting multi-platform recording session ${sessionId} for ${platforms.length} platforms`);
  log(`URL: ${url}, Platforms: ${platforms.join(', ')}`);
  logMetrics(`MULTI_PLATFORM_SESSION_START,ID=${sessionId},URL=${url},PLATFORM_COUNT=${platforms.length}`);
  
  const duration = options.duration || 10;
  const resolution = options.resolution || '1080p';
  const quality = options.quality || 'balanced';
  const fps = options.fps || VIDEO_FPS;
  
  // CHANGED: Instead of running platforms in parallel with Promise.all,
  // we'll run them sequentially one after another
  const results = [];
  
  try {
    // Process each platform one at a time
    for (const platform of platforms) {
      const platformOptions = { 
        ...options, 
        platform 
      };
      
      log(`Starting recording for platform: ${platform}`);
      try {
        const result = await recordWithPlatformSettings(url, platformOptions);
        log(`Completed recording for platform: ${platform}, result: ${result.fileName || 'error'}`);
        results.push({ platform, result });
      } catch (error) {
        log(`Error recording for platform ${platform}: ${error.message}`);
        results.push({ platform, error: error.message });
      }
      
      // Add a small pause between recordings to let system resources stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    log(`All ${platforms.length} platform recordings completed sequentially`);
    logMetrics(`MULTI_PLATFORM_SESSION_COMPLETE,PLATFORM_COUNT=${platforms.length},MODE=SEQUENTIAL`);
    
    // Format the results
    const formattedResults = results.map(({ platform, result, error }) => {
      if (error) {
        return {
          platform,
          success: false,
          error
        };
      }
      
      const formattedResult = {
        platform,
        success: true,
        fileName: result.fileName,
        logFile: result.logFile,
        metricsFile: result.metricsFile,
        enhanced: result.enhanced,
        width: result.width,
        height: result.height,
        fps: result.fps,
        duration: result.duration,
        quality: result.quality,
        aspectRatio: result.aspectRatio,
        size: result.size,
        multiPlatformSessionId: sessionId // Add parent session ID for grouping
      };
      
      // Add enhanceError if present
      if (result.enhanceError) {
        formattedResult.enhanceError = result.enhanceError;
      }
      
      return formattedResult;
    });
    
    return {
      sessionId,
      platforms: formattedResults,
      logFile: path.basename(logFilePath)
    };
  } catch (error) {
    log(`Error in multi-platform recording: ${error.message}`);
    logMetrics(`MULTI_PLATFORM_SESSION_ERROR,MESSAGE=${error.message}`);
    
    return {
      sessionId,
      error: error.message,
      logFile: path.basename(logFilePath)
    };
  }
}

module.exports = { recordWebsite, getLatestLogFile, recordWithPlatformSettings, recordMultiplePlatforms };