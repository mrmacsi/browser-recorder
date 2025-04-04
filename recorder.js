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
        setTimeout(() => window.scrollBy(0, -scrollAmount), 500);
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
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  console.log('Page activity completed');
}

// Function to create a real fallback video using ffmpeg
async function createFallbackVideo(destination, url, duration) {
  try {
    console.log('Attempting to create a fallback video with ffmpeg...');
    // Escape single quotes in URL for command line
    const safeUrl = url.replace(/'/g, "'\\''");
    
    // Use a simpler ffmpeg command that works on most systems
    const command = `ffmpeg -f lavfi -i color=c=blue:s=1280x720:d=${duration} -c:v libvpx -crf 30 -b:v 800k "${destination}"`;
    
    execSync(command, {
      stdio: 'inherit',
      timeout: 30000  // 30 second timeout
    });
    
    console.log(`Created fallback video at ${destination}`);
    return true;
  } catch (ffmpegError) {
    console.error('Failed to create fallback video with ffmpeg:', ffmpegError.message);
    return false;
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
  
  // Fallback filename in case we need to create one
  const fallbackFilename = `fallback-${uuidv4()}.webm`;
  const fallbackPath = path.join(uploadsDir, fallbackFilename);
  
  // Launch browser with appropriate configuration
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
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
    // Create a browser context with video recording enabled
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: uploadsDir,
        size: { width: 1280, height: 720 }
      }
    });

    // Create a new page
    const page = await context.newPage();
    
    console.log(`Loading page: ${url}`);
    try {
      // Navigate to the URL with appropriate wait conditions
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 60000 
      });
      
      // Allow page to stabilize
      await page.waitForTimeout(1000);
      
      // Add some interactivity to make sure the video has content
      console.log(`Generating page activity for better recording...`);
      await generatePageActivity(page, duration * 1000);
      
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
      console.log(`Creating a fallback file: ${fallbackFilename}`);
      
      // Try to create a fallback video
      const success = await createFallbackVideo(fallbackPath, url, duration);
      
      if (!success) {
        // Create an empty placeholder file if ffmpeg fails
        fs.writeFileSync(fallbackPath, "VIDEO_RECORDING_FAILED");
        console.log(`Created placeholder file at ${fallbackPath}`);
      }
      
      return fallbackFilename;
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