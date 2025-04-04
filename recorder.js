const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Calculate available CPU cores for optimal resource allocation
const numCPUs = os.cpus().length;
const totalMemory = os.totalmem();
console.log(`System has ${numCPUs} CPU cores and ${Math.round(totalMemory / 1024 / 1024 / 1024)}GB total memory`);

async function recordWebsite(url, duration = 10) {
  console.log(`Preparing to record ${url} for exactly ${duration} seconds with maximum quality...`);
  
  // Calculate optimal resource allocation based on system capabilities
  const maxParallelism = Math.max(1, numCPUs - 1); // Leave one core for system
  
  // Configure high-performance browser settings
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: null,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      `--js-flags=--max-old-space-size=${Math.min(4096, Math.floor(totalMemory / 1024 / 1024 / 2))}`,
      '--window-size=1920,1080',
      '--disable-features=IsolateOrigins,site-per-process', // Improve performance
      '--disable-web-security',
      '--disable-features=AudioServiceOutOfProcess', // Keep audio processing in the main process
      '--enable-gpu-rasterization', // Use GPU for rasterization
      '--enable-zero-copy', // Enable zero-copy to reduce memory consumption
      '--ignore-certificate-errors',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  try {
    const page = await browser.newPage();
    const outputFilename = `recording-${uuidv4()}.mp4`;
    const outputPath = path.join(uploadsDir, outputFilename);

    // Set high-resolution viewport for maximum quality
    await page.setViewport({ 
      width: 1920, 
      height: 1080,
      deviceScaleFactor: 1,
    });
    
    // Disable unnecessary features to focus resources on smooth rendering
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      // Block non-essential resources to improve performance
      if (['font', 'image'].includes(resourceType) && request.url().includes('fonts.googleapis.com')) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Maximize CPU priority for the recording process
    process.title = "HIGH_PRIORITY_RECORDING";
    try {
      process.setpriority(-10); // Try to set high priority if possible
    } catch (e) {
      console.log("Could not set process priority (requires elevated permissions)");
    }
    
    // Configure maximum quality recorder settings
    const recorder = new PuppeteerScreenRecorder(page, {
      fps: 60, // Maximum frame rate for smoothness
      ffmpeg_Path: null,
      videoFrame: { width: 1920, height: 1080 },
      videoCrf: 17, // Lower CRF = higher quality (17-18 is visually lossless)
      videoCodec: 'libx264',
      videoPreset: 'slow', // 'slow' provides better quality than 'ultrafast' with more CPU usage
      videoBitrate: 12000, // Higher bitrate for better quality (12 Mbps)
      videoFormat: 'mp4',
      captureCursor: true,
      aspectRatio: '16:9',
      recordDurationLimit: duration * 1000 + 5000, // Add 5 seconds buffer
      ffmpeg_Args: [
        '-tune', 'film', // Optimize for high visual quality
        '-profile:v', 'high', // Use high profile for better quality
        '-level', '4.2', // Compatibility with most players
        '-movflags', '+faststart', // Optimize for web playback
        '-threads', maxParallelism.toString(), // Use optimal thread count
        '-cpu-used', '0', // Use maximum CPU
        '-quality', 'good'
      ]
    });

    // Navigate with best practices for recording
    console.log(`Loading page before recording...`);
    try {
      // Load page with longer timeout for complete rendering
      await page.goto(url, { 
        waitUntil: ['domcontentloaded', 'networkidle2'], 
        timeout: 60000 
      });
      
      // Apply performance optimizations to the page
      await page.evaluate(() => {
        // Force hardware acceleration
        document.body.style.transform = 'translateZ(0)';
        document.body.style.backfaceVisibility = 'hidden';
        
        // Smooth any animations
        const style = document.createElement('style');
        style.innerHTML = `
          * {
            transition-timing-function: linear !important;
            animation-timing-function: linear !important;
          }
        `;
        document.head.appendChild(style);
      });
      
      // Allow time for rendering to stabilize
      await new Promise(r => setTimeout(r, 3000));
      
    } catch (navigationError) {
      console.warn(`Navigation issue - continuing with recording anyway: ${navigationError.message}`);
    }
    
    // Start recording with maximum resources
    console.log(`Starting high-quality recording for exactly ${duration} seconds...`);
    await recorder.start(outputPath);
    
    // Precise timing for exact duration
    const startTime = Date.now();
    const durationMs = duration * 1000;
    const endTime = startTime + durationMs;
    
    // Keep rendering smooth during recording
    while (Date.now() < endTime) {
      await page.evaluate(() => {
        // Force rendering updates to maintain smoothness
        window.scrollBy(0, 0);
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => {
            performance.now(); // Forces browser to update timers
          });
        }
      });
      await new Promise(r => setTimeout(r, 16)); // ~60fps check rate (16.67ms)
    }
    
    // Finalize recording
    await recorder.stop();
    const actualDuration = (Date.now() - startTime) / 1000;
    console.log(`High-quality recording completed: ${outputFilename} (actual duration: ${actualDuration.toFixed(1)}s)`);

    return outputFilename;
  } catch (error) {
    console.error('Recording error:', error);
    throw error;
  } finally {
    await browser.close();
    
    // Reset process priority
    try {
      process.setpriority(0);
    } catch (e) {
      // Ignore errors
    }
  }
}

module.exports = { recordWebsite }; 