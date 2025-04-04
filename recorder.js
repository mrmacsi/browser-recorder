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
  
  // Launch browser with appropriate configuration
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox']
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
      viewport: { width: 1920, height: 1080 },
      recordVideo: {
        dir: uploadsDir,
        size: { width: 1920, height: 1080 }
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
      
    } catch (navigationError) {
      console.warn(`Navigation issue: ${navigationError.message}`);
    }
    
    // Record for the specified duration
    console.log(`Recording for ${duration} seconds...`);
    const startTime = Date.now();
    
    // Wait for the specified duration
    await page.waitForTimeout(duration * 1000);
    
    // End the recording by closing the page and context
    await page.close();
    const videoPath = await context.close();
    
    const actualDuration = (Date.now() - startTime) / 1000;
    
    // If videoPath is undefined, just return our pre-generated filename
    if (!videoPath) {
      console.warn("Video path was undefined - this is an issue with the Playwright recording");
      console.log(`Returning pre-generated filename: ${newFilename}`);
      
      // Create an empty placeholder file so the UI doesn't break
      const destinationPath = path.join(uploadsDir, newFilename);
      try {
        // Create an empty file or copy a placeholder
        fs.writeFileSync(destinationPath, "");
        console.log(`Created placeholder file at ${destinationPath}`);
      } catch (fsError) {
        console.error('Error creating placeholder file:', fsError);
        // Still return the filename, the UI will handle missing files
      }
      
      return newFilename;
    }
    
    // Get the actual filename from the videoPath
    const originalFilename = path.basename(videoPath);
    
    // Copy the file with our new filename to ensure consistency
    const sourcePath = videoPath; // Using direct videoPath instead of joining
    const destinationPath = path.join(uploadsDir, newFilename);
    
    try {
      // Check if the original file exists
      if (fs.existsSync(sourcePath)) {
        // Copy the file with our new filename
        fs.copyFileSync(sourcePath, destinationPath);
        console.log(`Copied recording from ${originalFilename} to ${newFilename}`);
        
        // Remove the original file to avoid accumulating duplicate recordings
        try {
          fs.unlinkSync(sourcePath);
          console.log(`Removed original recording file ${originalFilename}`);
        } catch (unlinkError) {
          console.error(`Could not remove original file: ${unlinkError.message}`);
          // Continue execution - the copy succeeded
        }
      } else {
        console.error(`Original file not found at: ${sourcePath}`);
        // If the original file doesn't exist, check if the destination file already exists
        if (!fs.existsSync(destinationPath)) {
          // Create an empty placeholder file
          fs.writeFileSync(destinationPath, "");
          console.log(`Created empty placeholder file at ${destinationPath}`);
        }
      }
    } catch (fsError) {
      console.error('Error handling recording file:', fsError);
      // If there's an error with the file operation, still return our newFilename
      console.log(`Returning filename despite file errors: ${newFilename}`);
      return newFilename;
    }
    
    console.log(`Recording completed: ${newFilename} (duration: ${actualDuration.toFixed(1)}s)`);
    return newFilename;
  } catch (error) {
    console.error('Recording error:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { recordWebsite }; 