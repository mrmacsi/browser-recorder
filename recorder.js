const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
  
  // Ensure browsers are installed before proceeding
  await ensureBrowsersInstalled();
  
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
    
    // Get the actual filename from the videoPath (fix for filename mismatch issue)
    const originalFilename = path.basename(videoPath);
    const newFilename = `recording-${uuidv4()}.webm`;
    const actualDuration = (Date.now() - startTime) / 1000;
    
    // Copy the file with our new filename to ensure consistency
    const sourcePath = path.join(uploadsDir, originalFilename);
    const destinationPath = path.join(uploadsDir, newFilename);
    
    try {
      // Check if the original file exists
      if (fs.existsSync(sourcePath)) {
        // Copy the file with our new filename
        fs.copyFileSync(sourcePath, destinationPath);
        console.log(`Copied recording from ${originalFilename} to ${newFilename}`);
        
        // Remove the original file to avoid accumulating duplicate recordings
        fs.unlinkSync(sourcePath);
        console.log(`Removed original recording file ${originalFilename}`);
      } else {
        console.error(`Original file not found at: ${sourcePath}`);
        // If the original file doesn't exist, check if the destination file already exists
        if (!fs.existsSync(destinationPath)) {
          throw new Error('Recording file not found');
        }
      }
    } catch (fsError) {
      console.error('Error handling recording file:', fsError);
      // If there's an error with the file operation, still return the original filename as fallback
      console.log(`Falling back to original filename: ${originalFilename}`);
      return originalFilename;
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