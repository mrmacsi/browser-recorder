const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

// Balanced video configuration for speed and quality
const VIDEO_FPS = 60;
const VIDEO_WIDTH = 2560;  // 2K resolution (faster than 4K)
const VIDEO_HEIGHT = 1440;
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
const azureTempDir = '/mnt/resource/browser-recorder/temp';

// Choose the best temp directory available
let tempDir;
if (isAzureVM && fs.existsSync(azureTempDir)) {
  tempDir = azureTempDir;
} else if (ramDiskExists) {
  tempDir = '/mnt/ramdisk';
} else {
  tempDir = tempVideoDir; // Use our dedicated temp directory
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
    
    // Two-pass encoding function
    const twoPassEncode = async () => {
      // First pass
      logger(`Starting first pass encoding...`);
      const firstPassArgs = [
        '-y',
        '-i', inputPath,
        '-c:v', CODEC,
        '-b:v', VIDEO_BITRATE,
        '-pass', '1',
        '-passlogfile', passLogPath,
        '-deadline', 'good',
        '-cpu-used', '0',
        '-threads', THREAD_COUNT.toString(),
        '-frame-parallel', '1',
        '-tile-columns', '2',
        '-tile-rows', '2',
        '-auto-alt-ref', '1',
        '-lag-in-frames', '25',
        '-pix_fmt', 'yuv420p',
        '-r', `${VIDEO_FPS}`,
        '-an',  // No audio for first pass
        '-f', 'null',  // Output to null
        '/dev/null'
      ];
      
      // Add duration trimming if specified
      if (videoOptions.duration) {
        firstPassArgs.splice(2, 0, '-t', videoOptions.duration.toString());
        logger(`Applying duration limit: ${videoOptions.duration} seconds`);
      }
      
      if (os.platform() === 'win32') {
        firstPassArgs[firstPassArgs.length - 1] = 'NUL';
      }
      
      logger(`Running first pass with args: ${firstPassArgs.join(' ')}`);
      
      try {
        await new Promise((resolvePass, rejectPass) => {
          const firstPassProcess = spawn(FFMPEG_PATH, firstPassArgs);
          
          firstPassProcess.stdout.on('data', (data) => {
            logger(`ffmpeg first pass stdout: ${data}`);
          });
          
          firstPassProcess.stderr.on('data', (data) => {
            // This is where progress info is output
            const dataStr = data.toString();
            if (dataStr.includes('frame=')) {
              // Progress info
              const progressMatch = dataStr.match(/frame=\s*(\d+)/);
              if (progressMatch) {
                logger(`First pass progress: frame ${progressMatch[1]}`);
              }
            }
          });
          
          firstPassProcess.on('close', (code) => {
            if (code === 0) {
              logger(`First pass completed successfully`);
              resolvePass();
            } else {
              logger(`First pass exited with code ${code}`);
              rejectPass(new Error(`First pass encoding failed with code ${code}`));
            }
          });
          
          firstPassProcess.on('error', (err) => {
            logger(`First pass error: ${err.message}`);
            rejectPass(err);
          });
        });
        
        // Second pass (with enhanced quality settings)
        logger(`Starting second pass encoding...`);
        const secondPassArgs = [
          '-y',
          '-i', inputPath,
          '-c:v', CODEC,
          '-b:v', VIDEO_BITRATE,
          '-maxrate', `${parseInt(VIDEO_BITRATE) * 1.5}`,
          '-minrate', VIDEO_BITRATE,
          '-pass', '2',
          '-passlogfile', passLogPath,
          '-deadline', QUALITY_PRESET,
          '-cpu-used', '0',  // Best quality
          '-threads', THREAD_COUNT.toString(),
          '-frame-parallel', '1',
          '-tile-columns', '2',
          '-tile-rows', '2',
          '-auto-alt-ref', '1',
          '-lag-in-frames', '25',
          '-pix_fmt', 'yuv444p', // Better color quality
          '-r', `${VIDEO_FPS}`,
          '-vf', 'scale=out_color_matrix=bt709,unsharp=5:5:1.0:5:5:0.0', // Sharpen filter
          '-color_primaries', 'bt709',
          '-color_trc', 'bt709',
          '-colorspace', 'bt709',
          '-movflags', '+faststart',
          '-c:a', 'libopus', // High quality audio codec
          '-b:a', '192k',
          outputPath
        ];
        
        // Add duration trimming if specified
        if (videoOptions.duration) {
          secondPassArgs.splice(2, 0, '-t', videoOptions.duration.toString());
        }
        
        logger(`Running second pass with args: ${secondPassArgs.join(' ')}`);
        
        await new Promise((resolvePass, rejectPass) => {
          const secondPassProcess = spawn(FFMPEG_PATH, secondPassArgs);
          
          secondPassProcess.stdout.on('data', (data) => {
            logger(`ffmpeg second pass stdout: ${data}`);
          });
          
          secondPassProcess.stderr.on('data', (data) => {
            // This is where progress info is output
            const dataStr = data.toString();
            if (dataStr.includes('frame=')) {
              // Progress info
              const progressMatch = dataStr.match(/frame=\s*(\d+)/);
              if (progressMatch) {
                logger(`Second pass progress: frame ${progressMatch[1]}`);
              }
            }
          });
          
          secondPassProcess.on('close', (code) => {
            if (code === 0) {
              logger(`Second pass completed successfully: ${outputPath}`);
              resolvePass();
            } else {
              logger(`Second pass exited with code ${code}`);
              rejectPass(new Error(`Second pass encoding failed with code ${code}`));
            }
          });
          
          secondPassProcess.on('error', (err) => {
            logger(`Second pass error: ${err.message}`);
            rejectPass(err);
          });
        });
        
        // Cleanup pass log files
        try {
          const logPattern = new RegExp(`^${path.basename(passLogPath)}`);
          const passFiles = fs.readdirSync(passLogDir)
            .filter(file => logPattern.test(file))
            .map(file => path.join(passLogDir, file));
          
          passFiles.forEach(file => {
            fs.unlinkSync(file);
            logger(`Removed pass log file: ${file}`);
          });
        } catch (cleanupErr) {
          logger(`Warning: Failed to clean up pass log files: ${cleanupErr.message}`);
        }
        
        logger(`Two-pass encoding completed successfully`);
        return outputPath;
        
      } catch (error) {
        logger(`Two-pass encoding failed: ${error.message}`);
        throw error;
      }
    };
    
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
        if (TWO_PASS_ENCODING) {
          try {
            await twoPassEncode();
            logger(`Two-pass encoding successful`);
            resolve(outputPath);
          } catch (twoPassErr) {
            logger(`Two-pass encoding failed, falling back to single-pass: ${twoPassErr.message}`);
            await singlePassEncode();
            resolve(outputPath);
          }
        } else {
          await singlePassEncode();
          resolve(outputPath);
        }
      } catch (err) {
        logger(`All encoding attempts failed: ${err.message}`);
        reject(err);
      }
    })();
  });
}

// Platform dimension presets
const DIMENSIONS = {
  SQUARE: { aspect: '1:1', width: { '720p': 720, '1080p': 1080, '2k': 1440 }, height: { '720p': 720, '1080p': 1080, '2k': 1440 } },
  VERTICAL_9_16: { aspect: '9:16', width: { '720p': 405, '1080p': 607, '2k': 810 }, height: { '720p': 720, '1080p': 1080, '2k': 1440 } },
  STANDARD_16_9: { aspect: '16:9', width: { '720p': 1280, '1080p': 1920, '2k': 2560 }, height: { '720p': 720, '1080p': 1080, '2k': 1440 } }
};

// Resolution presets (using 16:9 as reference)
const RESOLUTIONS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 }
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
    throw new Error(`Invalid resolution: ${resolution}. Supported resolutions: 720p, 1080p, 2k`);
  }

  // Get dimensions from presets
  const width = DIMENSIONS[platform].width[resolution];
  const height = DIMENSIONS[platform].height[resolution];
  
  // Ensure width is even (required for some encoders)
  const adjustedWidth = width % 2 === 0 ? width : width + 1;

  console.log(`Recording with ${platform} format (${adjustedWidth}x${height}) at ${resolution} resolution`);

  // Record with specified dimensions and enforce aspect ratio
  return await recordWebsite(url, duration, {
    width: adjustedWidth,
    height,
    fps,
    quality,
    platform,
    aspectRatio: DIMENSIONS[platform].aspect
  });
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
            enhanced: true
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
            enhanced: false
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
          enhanceError: enhanceError.message
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

module.exports = { recordWebsite, getLatestLogFile, recordWithPlatformSettings };