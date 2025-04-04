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
  
  // Generate a unique filename for this recording
  const newFilename = `recording-${uuidv4()}.webm`;
  const destinationPath = path.join(uploadsDir, newFilename);
  
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
    
    // If videoPath is undefined, create a fallback video
    if (!videoPath) {
      console.warn("Video path was undefined - this is an issue with the Playwright recording");
      console.log(`Creating a fallback recording file: ${newFilename}`);
      
      try {
        // Try to create a simple HTML5 video instead using ffmpeg if available
        try {
          console.log('Attempting to create a fallback video with ffmpeg...');
          execSync(`ffmpeg -f lavfi -i color=c=blue:s=1280x720:d=${duration} -vf "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Fallback Recording for ${url}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2" -c:v libvpx -crf 30 -b:v 0 "${destinationPath}"`, {
            stdio: 'inherit',
            timeout: 30000  // 30 second timeout
          });
          console.log(`Created fallback video at ${destinationPath}`);
          return newFilename;
        } catch (ffmpegError) {
          console.error('Failed to create fallback video with ffmpeg:', ffmpegError.message);
          
          // Create an empty placeholder file if ffmpeg fails
          fs.writeFileSync(destinationPath, "VIDEO_RECORDING_FAILED");
          console.log(`Created placeholder file at ${destinationPath}`);
        }
      } catch (fsError) {
        console.error('Error creating fallback file:', fsError);
      }
      
      return newFilename;
    }
    
    // Get the actual filename from the videoPath
    const originalFilename = path.basename(videoPath);
    console.log(`Recorded video saved as: ${originalFilename}`);
    
    // Verify the file has content
    try {
      const stats = fs.statSync(videoPath);
      console.log(`Original video file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        console.warn('Warning: Recorded video has 0 bytes. Creating a placeholder instead.');
        fs.writeFileSync(destinationPath, "EMPTY_RECORDING");
        return newFilename;
      }
    } catch (statError) {
      console.error(`Error checking video file: ${statError.message}`);
    }
    
    // Copy the file with our new filename to ensure consistency
    try {
      // Check if the original file exists
      if (fs.existsSync(videoPath)) {
        // Copy the file with our new filename
        fs.copyFileSync(videoPath, destinationPath);
        console.log(`Copied recording from ${originalFilename} to ${newFilename}`);
        
        // Verify the copied file
        const destStats = fs.statSync(destinationPath);
        console.log(`Copied file size: ${destStats.size} bytes`);
        
        // Remove the original file to avoid accumulating duplicate recordings
        try {
          fs.unlinkSync(videoPath);
          console.log(`Removed original recording file ${originalFilename}`);
        } catch (unlinkError) {
          console.error(`Could not remove original file: ${unlinkError.message}`);
          // Continue execution - the copy succeeded
        }
      } else {
        console.error(`Original file not found at: ${videoPath}`);
        // Create an empty placeholder file
        fs.writeFileSync(destinationPath, "MISSING_SOURCE_VIDEO");
        console.log(`Created placeholder for missing source file at ${destinationPath}`);
      }
    } catch (fsError) {
      console.error('Error handling recording file:', fsError);
      // If there's an error with the file operation, still return our newFilename
      console.log(`Returning filename despite file errors: ${newFilename}`);
    }
    
    console.log(`Recording process completed: ${newFilename}`);
    return newFilename;
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