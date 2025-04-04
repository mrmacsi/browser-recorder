const { chromium } = require('playwright');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Calculate available CPU cores for resource allocation
const numCPUs = os.cpus().length;
const totalMemory = os.totalmem();
console.log(`System has ${numCPUs} CPU cores and ${Math.round(totalMemory / 1024 / 1024 / 1024)}GB total memory`);

async function recordWebsite(url, duration = 10) {
  console.log(`Preparing to record ${url} for ${duration} seconds with Playwright...`);
  
  // Launch browser with appropriate configuration
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  });

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
    
    // Generate a unique filename for the recording
    const outputFilename = `recording-${uuidv4()}.webm`;
    const actualDuration = (Date.now() - startTime) / 1000;
    
    console.log(`Recording completed: ${outputFilename} (duration: ${actualDuration.toFixed(1)}s)`);
    return outputFilename;
  } catch (error) {
    console.error('Recording error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { recordWebsite }; 