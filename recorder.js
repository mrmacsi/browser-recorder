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
const VIDEO_FPS = 20; // Reduced for better server performance with smoother result
const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const VIDEO_SCALE = 0.75; // Scale down to 75% for better performance

// Environment variables for better performance
process.env.PLAYWRIGHT_BROWSERS_PATH = '/home/azureuser/.cache/ms-playwright';
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

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

// Improved browser launch configuration
async function launchOptimizedBrowser() {
  return await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH, // Use system Chrome if available
    chromiumSandbox: false, 
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
      '--js-flags=--max-old-space-size=4096',
      `--renderer-process-limit=${Math.max(4, numCPUs)}`,
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--mute-audio', 
      '--disable-sync',
      `--use-gl=swiftshader`,
      '--disable-speech-api',
      `--memory-pressure-off`,
      '--font-render-hinting=none',
      '--disable-hang-monitor',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--no-default-browser-check',
      '--disable-translate',
      '--disable-domain-reliability',
      '--disable-component-update',
      `--window-size=${Math.floor(VIDEO_WIDTH*VIDEO_SCALE)},${Math.floor(VIDEO_HEIGHT*VIDEO_SCALE)}`, // Smaller window size
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
    ]
  });
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
  
  // Launch browser with improved settings for better performance
  let browser;
  try {
    browser = await launchOptimizedBrowser();
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
    // Pre-load typical web fonts to improve rendering
    const fontPreloadContext = await browser.newContext();
    const fontPreloadPage = await fontPreloadContext.newPage();
    await fontPreloadPage.goto('about:blank');
    await fontPreloadPage.evaluate(() => {
      const fontFaceSet = new FontFace('Arial', 'local("Arial")');
      document.fonts.add(fontFaceSet);
    });
    await fontPreloadContext.close();
    
    // Create browser context with smaller viewport for better performance
    const scaledWidth = Math.floor(VIDEO_WIDTH * VIDEO_SCALE);
    const scaledHeight = Math.floor(VIDEO_HEIGHT * VIDEO_SCALE);
    
    // Create a browser context with video recording enabled with improved settings
    const context = await browser.newContext({
      viewport: { width: scaledWidth, height: scaledHeight },
      recordVideo: {
        dir: uploadsDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT }, // Keep output resolution high
        fps: VIDEO_FPS
      },
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      deviceScaleFactor: 1.0,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      serviceWorkers: 'block', // Disable service workers for better performance
      permissions: ['clipboard-read', 'clipboard-write'], // Allow clipboard for better interaction
    });

    // Optimize context performance
    context.setDefaultNavigationTimeout(30000);
    context.setDefaultTimeout(20000);
    
    // Create a new page with performance optimization
    const page = await context.newPage();
    
    // Set up smooth animation
    await page.addInitScript(() => {
      // Override requestAnimationFrame for smoother animations
      const originalRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => {
        return originalRAF.call(window, time => {
          try {
            callback(time);
          } catch (e) {
            console.error('RAF error:', e);
          }
        });
      };
    });
    
    console.log(`Loading page: ${url}`);
    try {
      // Add performance observer to monitor performance
      await page.evaluate(() => {
        if (window.PerformanceObserver) {
          const observer = new PerformanceObserver(list => {
            list.getEntries().forEach(entry => {
              if (entry.entryType === 'longtask' && entry.duration > 50) {
                console.warn(`Long task detected: ${entry.duration}ms`);
              }
            });
          });
          observer.observe({ entryTypes: ['longtask', 'paint', 'frame'] });
        }
      });
      
      // Navigate to the URL with optimized wait conditions
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      // Let the page stabilize first
      await page.waitForTimeout(500);
      
      // Perform a single scroll down and back up to trigger lazy loading content
      console.log('Performing initial scroll to ensure content is loaded...');
      await page.evaluate(() => {
        // Scroll down smoothly to load any lazy content
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
        
        // After a brief pause, scroll back to top
        setTimeout(() => {
          window.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }, 1000);
      });
      
      // Wait for scroll to complete and page to stabilize
      await page.waitForTimeout(2000);
      
      // Record the page statically for the specified duration
      console.log(`Recording page statically for ${duration} seconds...`);
      await page.waitForTimeout(duration * 1000);
      
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
    
    // Simply return the filename of the found video without renaming
    return foundVideoFile.filename;
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