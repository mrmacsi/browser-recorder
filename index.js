const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const recorder = require('./recorder');
const http = require('http');
const https = require('https');

// Get the recordWebsite function from the recorder module
const { recordWebsite, recordWithPlatformSettings, recordMultiplePlatforms, getLatestLogFile } = recorder;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Ensure metrics directory exists
const metricsDir = path.join(__dirname, 'logs', 'metrics');
if (!fs.existsSync(metricsDir)) {
  fs.mkdirSync(metricsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 5443;
const isDev = process.env.NODE_ENV !== 'production';

// Enable CORS for development
if (isDev) {
  console.log('Running in development mode - CORS enabled for all origins');
  app.use(cors());
} else {
  // In production, only allow specific origins
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*'
  }));
}

// Parse JSON request bodies
app.use(express.json());

// Serve static files from the uploads directory with explicit MIME types
app.use('/uploads', (req, res, next) => {
  // Set the correct MIME type for webm files
  if (req.path.endsWith('.webm')) {
    res.set('Content-Type', 'video/webm');
  }
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  // Set Cache-Control headers
  setHeaders: (res, filePath) => {
    if (path.extname(filePath) === '.webm') {
      // No caching for videos for development purposes
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// API endpoint for recording a website
app.post('/api/record', async (req, res) => {
  let videoName = null;
  
  try {
    // Ensure required parameters
    const { url, duration, platform, platforms, resolution, quality, fps, speed } = req.body;
    
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }
    
    // Check for hardware acceleration flag
    if (req.body.hardware_acceleration !== undefined) {
      const enableHardware = req.body.hardware_acceleration === true;
      process.env.HARDWARE_ACCELERATION = enableHardware ? 'true' : 'false';
      console.log(`Setting hardware acceleration to: ${enableHardware ? 'enabled' : 'disabled'} for this recording`);
    }
    
    console.log(`Recording requested for URL: ${url}, duration: ${duration || 10}s`);
    
    // Handle multiple platforms if provided
    if (platforms && Array.isArray(platforms) && platforms.length > 0) {
      console.log(`Multi-platform recording requested: ${platforms.join(', ')}`);
      
      const result = await recordMultiplePlatforms(url, platforms, {
        resolution,
        duration: duration || 10,
        quality,
        fps,
        speed
      });
      
      if (result.error) {
        return res.status(500).json({
          success: false,
          error: result.error,
          logFile: result.logFile,
          logUrl: `/api/logs/${result.logFile}`
        });
      }
      
      // Get the host from request
      const host = req.get('host');
      const protocol = req.protocol;
      
      // Enhance the platform results with URLs
      const enhancedResults = result.platforms.map(platform => {
        if (!platform.success) return platform;
        
        return {
          ...platform,
          url: `/uploads/${platform.fileName}`,
          absoluteUrl: `${protocol}://${host}/uploads/${platform.fileName}`,
          logUrl: `/api/logs/${platform.logFile}`,
          metricsUrl: `/api/metrics/${platform.metricsFile}`
        };
      });
      
      // Return the multi-platform results
      return res.json({
        success: true,
        multiPlatform: true,
        sessionId: result.sessionId,
        platforms: enhancedResults,
        logFile: result.logFile,
        logUrl: `/api/logs/${result.logFile}`
      });
    }
    
    // Use platform settings if provided, otherwise use legacy method
    let result;
    if (platform || resolution || quality || fps) {
      result = await recordWithPlatformSettings(url, {
        platform,
        resolution,
        duration: duration || 10,
        quality,
        fps,
        speed
      });
    } else {
      // Call the recorder with the URL and optional duration
      result = await recordWebsite(url, duration || 10);
    }
    
    if (result.error) {
      return res.status(500).json({ 
        success: false, 
        error: result.error,
        logFile: result.logFile,
        logUrl: `/api/logs/${result.logFile}`,
        metricsFile: result.metricsFile,
        metricsUrl: `/api/metrics/${result.metricsFile}`
      });
    }
    
    const fileName = result.fileName;
    videoName = fileName;
    
    // Get the filename from the result
    const resultFilename = fileName;
    const logFilename = result.logFile;
    const metricsFilename = result.metricsFile;
    
    // Check if we have a valid filename
    if (!resultFilename) {
      console.error('No filename returned from recording process');
      return res.status(500).json({
        success: false,
        error: 'Recording failed',
        message: 'No filename returned from recording process',
        logFile: logFilename,
        metricsFile: metricsFilename
      });
    }
    
    // Get file information
    const resultPath = path.join(uploadsDir, resultFilename);
    let fileSize = 0;
    
    try {
      if (fs.existsSync(resultPath)) {
        fileSize = fs.statSync(resultPath).size;
      } else {
        console.error(`Result file not found: ${resultPath}`);
      }
    } catch (err) {
      console.error(`Error checking result file: ${err.message}`);
    }
    
    // Get the host from request
    const host = req.get('host');
    const protocol = req.protocol;
    
    // Build the absolute URL
    const fileUrl = `/uploads/${resultFilename}`;
    const absoluteUrl = `${protocol}://${host}/uploads/${resultFilename}`;
    
    // Determine the content type
    const isImage = resultFilename.endsWith('.png');
    
    // Return the recording details
    res.json({
      success: true,
      filename: resultFilename,
      url: fileUrl,
      absoluteUrl: absoluteUrl,
      logFile: logFilename,
      logUrl: `/api/logs/${logFilename}`,
      metricsFile: metricsFilename,
      metricsUrl: `/api/metrics/${metricsFilename}`,
      fileSize: fileSize,
      fileType: isImage ? 'image/png' : 'video/webm'
    });
  } catch (error) {
    console.error('Error during recording:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: 'unified-server'
  });
});

// List all recordings in the uploads directory
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const stats = fs.statSync(path.join(uploadsDir, file));
        
        // Get the host from request
        const host = req.get('host');
        const protocol = req.protocol;
        
        return {
          filename: file,
          url: `/uploads/${file}`,
          absoluteUrl: `${protocol}://${host}/uploads/${file}`,
          size: stats.size,
          created: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json({
      count: files.length,
      files
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Delete a specific recording file
app.delete('/api/files/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    
    // Check if file exists and ensure it's a webm file for security
    if (!fs.existsSync(filePath) || !filename.endsWith('.webm')) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        message: 'The requested file does not exist or is not a valid recording'
      });
    }
    
    // Delete the file
    fs.unlinkSync(filePath);
    console.log(`Deleted file: ${filename}`);
    
    res.json({
      success: true,
      message: 'File deleted successfully',
      filename: filename
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to get the latest log
app.get('/api/last-log', (req, res) => {
  try {
    const logFile = getLatestLogFile();
    
    if (!logFile) {
      return res.status(404).json({
        success: false,
        error: 'No log files found'
      });
    }
    
    const logContent = fs.readFileSync(logFile.path, 'utf8');
    
    res.json({
      success: true,
      filename: logFile.name,
      time: new Date(logFile.time).toISOString(),
      content: logContent
    });
  } catch (error) {
    console.error('Error retrieving last log:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to get a specific log file
app.get('/api/logs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const logPath = path.join(logsDir, filename);
    
    // Check if file exists and ensure it's a log file for security
    if (!fs.existsSync(logPath) || !filename.endsWith('.log')) {
      return res.status(404).json({
        success: false,
        error: 'Log file not found',
        message: 'The requested log file does not exist or is not a valid log'
      });
    }
    
    // Read the log file
    const logContent = fs.readFileSync(logPath, 'utf8');
    
    // Return the log content
    res.json({
      success: true,
      filename: filename,
      time: fs.statSync(logPath).mtime.toISOString(),
      content: logContent
    });
  } catch (error) {
    console.error('Error retrieving log file:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to get the latest metrics file
app.get('/api/latest-metrics', (req, res) => {
  try {
    // Find the latest metrics file
    const metricFiles = fs.readdirSync(metricsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(metricsDir, file);
        return {
          name: file,
          path: filePath,
          time: fs.statSync(filePath).mtime.getTime()
        };
      })
      .sort((a, b) => b.time - a.time); // Sort by most recent first
    
    if (metricFiles.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No metrics files found'
      });
    }
    
    const latestMetrics = metricFiles[0];
    const metricsContent = fs.readFileSync(latestMetrics.path, 'utf8');
    
    // Extract frame rate metrics
    const frameRateLines = metricsContent.split('\n')
      .filter(line => line.includes('FRAME_STATS') || line.includes('FRAME_METRICS'));
    
    res.json({
      success: true,
      filename: latestMetrics.name,
      time: new Date(latestMetrics.time).toISOString(),
      content: metricsContent,
      frameRateMetrics: frameRateLines
    });
  } catch (error) {
    console.error('Error retrieving latest metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to get a specific metrics file
app.get('/api/metrics/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const metricsPath = path.join(metricsDir, filename);
    
    // Check if file exists and ensure it's a log file for security
    if (!fs.existsSync(metricsPath) || !filename.endsWith('.log')) {
      return res.status(404).json({
        success: false,
        error: 'Metrics file not found',
        message: 'The requested metrics file does not exist or is not a valid log'
      });
    }
    
    // Read the metrics file
    const metricsContent = fs.readFileSync(metricsPath, 'utf8');
    
    // Extract frame rate metrics
    const frameRateLines = metricsContent.split('\n')
      .filter(line => line.includes('FRAME_STATS') || line.includes('FRAME_METRICS'));
    
    // Return the metrics content
    res.json({
      success: true,
      filename: filename,
      time: fs.statSync(metricsPath).mtime.toISOString(),
      content: metricsContent,
      frameRateMetrics: frameRateLines
    });
  } catch (error) {
    console.error('Error retrieving metrics file:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Route to toggle hardware acceleration
app.post('/api/toggle-hardware-acceleration', async (req, res) => {
  try {
    const enableHardware = req.body.enable === true;
    // Set the environment variable for the current process
    process.env.HARDWARE_ACCELERATION = enableHardware ? 'true' : 'false';
    
    console.log(`Setting hardware acceleration to: ${enableHardware ? 'enabled' : 'disabled'}`);
    
    // Return result
    res.json({
      success: true,
      hardwareAcceleration: enableHardware,
      message: `Hardware acceleration ${enableHardware ? 'enabled' : 'disabled'}`
    });
  } catch (error) {
    console.error(`Error toggling hardware acceleration: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add API endpoint to list all metrics files
app.get('/api/metrics', (req, res) => {
  try {
    // Check if metrics directory exists
    if (!fs.existsSync(metricsDir)) {
      return res.status(404).json({
        success: false,
        error: 'Metrics directory not found'
      });
    }
    
    // Read the metrics directory
    const files = fs.readdirSync(metricsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(metricsDir, file);
        return {
          name: file,
          path: filePath,
          size: fs.statSync(filePath).size,
          time: fs.statSync(filePath).mtime.getTime()
        };
      })
      .sort((a, b) => b.time - a.time); // Sort by most recent first
    
    // Return the list of metrics files
    res.json({
      success: true,
      count: files.length,
      files: files.map(file => ({
        filename: file.name,
        size: file.size,
        time: new Date(file.time).toISOString(),
        url: `/api/metrics/${file.name}`
      }))
    });
  } catch (error) {
    console.error('Error listing metrics files:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to list all previous recording runs
app.get('/api/recordings', async (req, res) => {
  try {
    // Check required directories
    if (!fs.existsSync(uploadsDir) || !fs.existsSync(logsDir) || !fs.existsSync(metricsDir)) {
      return res.status(404).json({
        success: false,
        error: 'Required directories not found'
      });
    }
    
    // Get all video files from uploads directory
    const videoFiles = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const stats = fs.statSync(path.join(uploadsDir, file));
        return {
          filename: file,
          path: path.join(uploadsDir, file),
          size: stats.size,
          created: stats.mtime.getTime()
        };
      });
    
    // Get all log files
    const logFiles = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.log') && file.startsWith('recording-'))
      .map(file => {
        const stats = fs.statSync(path.join(logsDir, file));
        return {
          filename: file,
          path: path.join(logsDir, file),
          size: stats.size,
          created: stats.mtime.getTime()
        };
      });
    
    // Get all metrics files
    const metricsFiles = fs.readdirSync(metricsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const stats = fs.statSync(path.join(metricsDir, file));
        return {
          filename: file,
          path: path.join(metricsDir, file),
          size: stats.size,
          created: stats.mtime.getTime()
        };
      });
    
    // Extract session IDs and timestamps from filenames
    const recordingSessions = [];
    const processedIds = new Set();
    
    // Helper function to extract session ID from filename
    const extractSessionId = (filename) => {
      // Expected format: recording-SESSIONID-TIMESTAMP.log or recording-SESSIONID-TIMESTAMP.webm
      const match = filename.match(/(?:recording|metrics)-([a-f0-9]{8})-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
      return match ? match[1] : null;
    };
    
    // Extract timestamp from filename
    const extractTimestamp = (filename) => {
      const match = filename.match(/(?:recording|metrics)-(?:[a-f0-9]{8})-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
      return match ? match[1] : null;
    };
    
    // Process video files first
    for (const video of videoFiles) {
      const sessionId = extractSessionId(video.filename);
      if (!sessionId || processedIds.has(sessionId)) continue;
      
      const timestamp = extractTimestamp(video.filename);
      if (!timestamp) continue;
      
      // Format the timestamp for creating a valid Date object
      const formattedTimestamp = timestamp.replace(/-/g, ':').replace('T', ' ');
      
      // Find matching log file
      const matchingLog = logFiles.find(log => log.filename.includes(sessionId));
      // Find matching metrics file
      const matchingMetrics = metricsFiles.find(metric => metric.filename.includes(sessionId));
      
      // Get log content for URL and additional info
      let url = null;
      let platform = 'UNKNOWN';
      let duration = 0;
      let resolution = 'UNKNOWN';
      let quality = 'standard';
      
      if (matchingLog) {
        try {
          const logContent = fs.readFileSync(matchingLog.path, 'utf8');
          // Extract URL from log
          let urlMatch = logContent.match(/Recording requested for URL: ([^,\s]+)/);
          if (!urlMatch) {
            urlMatch = logContent.match(/Starting balanced recording session .+ for ([^,\s]+)/);
          }
          if (!urlMatch) {
            urlMatch = logContent.match(/Loading page with high quality settings: ([^,\s]+)/);
          }
          if (urlMatch) url = urlMatch[1];
          
          // Extract platform
          let platformMatch = logContent.match(/platform=([A-Z_0-9]+)/i);
          if (!platformMatch) {
            platformMatch = logContent.match(/platform: ([A-Z_0-9]+)/i);
          }
          if (!platformMatch) {
            // Try to determine platform from dimensions
            if (logContent.includes('SQUARE format')) {
              platform = 'SQUARE';
            } else if (logContent.includes('VERTICAL_9_16 format') || 
                      (logContent.includes('aspect ratio') && logContent.includes('9:16'))) {
              platform = 'VERTICAL_9_16';
            } else if (logContent.includes('STANDARD_16_9 format') || 
                      (logContent.includes('aspect ratio') && logContent.includes('16:9'))) {
              platform = 'STANDARD_16_9';
            }
          } else {
            platform = platformMatch[1];
          }
          
          // Extract duration
          let durationMatch = logContent.match(/duration: (\d+)s/);
          if (!durationMatch) {
            durationMatch = logContent.match(/Recording high quality video for (\d+) seconds/);
          }
          if (!durationMatch) {
            durationMatch = logContent.match(/RECORDING_START.+DURATION=(\d+)s/);
          }
          if (durationMatch) duration = parseInt(durationMatch[1]);
          
          // Extract resolution
          let resolutionMatch = logContent.match(/Video settings: (\d+)x(\d+)/);
          if (!resolutionMatch) {
            resolutionMatch = logContent.match(/size: \{ width: (\d+), height: (\d+) \}/);
          }
          if (!resolutionMatch) {
            resolutionMatch = logContent.match(/viewport: \{ width: (\d+), height: (\d+) \}/);
          }
          if (resolutionMatch) {
            const width = resolutionMatch[1];
            const height = resolutionMatch[2];
            if (width && height) {
              resolution = `${width}x${height}`;
            }
          }
          
          // Extract additional information
          const qualityMatch = logContent.match(/Quality profile: ([a-z]+)/i);
          if (qualityMatch) quality = qualityMatch[1].toLowerCase();
          
        } catch (err) {
          console.error(`Error reading log file ${matchingLog.path}: ${err.message}`);
        }
      }
      
      // Get host for URLs
      const host = req.get('host');
      const protocol = req.protocol;
      
      // Create recording session entry
      recordingSessions.push({
        sessionId,
        timestamp: video.created ? new Date(video.created).toISOString() : new Date().toISOString(),
        url,
        platform,
        duration,
        resolution,
        quality: quality || 'standard',
        video: {
          filename: video.filename,
          url: `/uploads/${video.filename}`,
          absoluteUrl: `${protocol}://${host}/uploads/${video.filename}`,
          size: video.size,
          created: new Date(video.created).toISOString()
        },
        log: matchingLog ? {
          filename: matchingLog.filename,
          url: `/api/logs/${matchingLog.filename}`,
          size: matchingLog.size,
          created: new Date(matchingLog.created).toISOString()
        } : null,
        metrics: matchingMetrics ? {
          filename: matchingMetrics.filename,
          url: `/api/metrics/${matchingMetrics.filename}`,
          size: matchingMetrics.size,
          created: new Date(matchingMetrics.created).toISOString()
        } : null
      });
      
      processedIds.add(sessionId);
    }
    
    // Sort by timestamp, most recent first
    recordingSessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Track multi-platform sessions
    const multiPlatformSessions = new Map();
    
    // Also scan for parent session logs to detect multi-platform sessions
    console.log('Scanning for parent session logs...');
    const parentSessionLogs = logFiles
      .filter(file => !file.filename.includes('metrics-'))
      .map(file => {
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          
          // Check for parent session indicators
          const isParentSession = content.includes('Starting multi-platform recording session') || 
                                 content.includes('MULTI_PLATFORM_PARENT_SESSION');
                                 
          console.log(`Checking file ${file.filename}: ${isParentSession ? 'IS PARENT SESSION' : 'not parent session'}`);
          
          if (isParentSession) {
            // Extract parent session ID
            let sessionId = extractSessionId(file.filename);
            
            // If we couldn't get from filename, try to extract from content
            if (!sessionId) {
              const sessionIdMatch = content.match(/Starting multi-platform recording session ([a-f0-9]{8}) for/);
              if (sessionIdMatch) {
                sessionId = sessionIdMatch[1];
              }
              
              // Try another pattern
              if (!sessionId) {
                const altSessionIdMatch = content.match(/MULTI_PLATFORM_PARENT_SESSION,ID=([a-f0-9]{8})/);
                if (altSessionIdMatch) {
                  sessionId = altSessionIdMatch[1];
                }
              }
            }
            
            if (!sessionId) {
              console.log(`  - Could not extract session ID from ${file.filename}`);
              return null;
            }
            
            console.log(`  - Found parent session ID: ${sessionId}`);
            
            // Extract platforms from the log
            let platforms = [];
            const platformsMatch = content.match(/Platforms: ([^,\n]+(?:, [^,\n]+)*)/);
            if (!platformsMatch) {
              // Try another pattern
              const altPlatformsMatch = content.match(/MULTI_PLATFORM_PARENT_SESSION,ID=[a-f0-9]{8},PLATFORMS=([^,\n]+(?:,[^,\n]+)*)/);
              if (altPlatformsMatch) {
                platforms = altPlatformsMatch[1].split(',').map(p => p.trim());
              }
            } else {
              platforms = platformsMatch[1].split(', ').map(p => p.trim());
            }
            console.log(`  - Found platforms: ${platforms.join(', ')}`);
            
            // Extract URL from the log
            let url = null;
            const urlMatch = content.match(/URL: ([^,\s]+)/);
            if (urlMatch) {
              url = urlMatch[1];
              console.log(`  - Found URL: ${url}`);
            }
            
            return {
              sessionId,
              filename: file.filename,
              path: file.path,
              platforms,
              url
            };
          }
          return null;
        } catch (err) {
          console.error(`Error reading file ${file.path}: ${err.message}`);
          return null;
        }
      })
      .filter(item => item !== null);

    console.log(`Found ${parentSessionLogs.length} parent session logs`);

    // Process parent session logs to find any missing multi-platform groups
    parentSessionLogs.forEach(parentLog => {
      console.log(`Processing parent session ${parentLog.sessionId}...`);
      
      // Skip if we already processed this session ID through multiPlatformSessions
      if (multiPlatformSessions.has(parentLog.sessionId)) {
        console.log(`  - Already processed through multiPlatformSessions`);
        return;
      }
      
      // Find all child recordings
      const childRecordings = recordingSessions.filter(r => {
        // Check if this sessionId is mentioned in the parent log as a child
        const childSessionIdPattern = new RegExp(`result: recording-(${r.sessionId})-`, 'i');
        return childSessionIdPattern.test(fs.readFileSync(parentLog.path, 'utf8'));
      });
      
      console.log(`  - Found ${childRecordings.length} child recordings`);
      
      if (childRecordings.length > 0) {
        // Sort recordings by platform to ensure consistent ordering
        childRecordings.sort((a, b) => {
          const platformOrder = { 'STANDARD_16_9': 1, 'SQUARE': 2, 'VERTICAL_9_16': 3 };
          return (platformOrder[a.platform] || 999) - (platformOrder[b.platform] || 999);
        });
        
        // Create a multi-platform session entry
        recordingSessions.push({
          sessionId: parentLog.sessionId,
          timestamp: childRecordings[0].timestamp,
          url: parentLog.url || childRecordings[0].url,
          isMultiPlatform: true,
          platformCount: childRecordings.length,
          duration: childRecordings[0].duration,
          parentLog: {
            filename: parentLog.filename,
            url: `/api/logs/${parentLog.filename}`,
            path: parentLog.path
          },
          platforms: childRecordings.map(r => ({
            platform: r.platform,
            video: r.video,
            log: r.log,
            metrics: r.metrics,
            resolution: r.resolution,
            sessionId: r.sessionId
          }))
        });
        
        // Remove the individual recordings
        childRecordings.forEach(r => {
          const index = recordingSessions.findIndex(s => s.sessionId === r.sessionId);
          if (index !== -1) {
            console.log(`  - Removing individual recording ${r.sessionId} (now part of group)`);
            recordingSessions.splice(index, 1);
          }
        });
        
        console.log(`  - Created multi-platform entry for session ${parentLog.sessionId}`);
      } else {
        console.log(`  - No child recordings found for parent ${parentLog.sessionId}`);
      }
    });
    
    // Return the results
    res.json({
      success: true,
      count: recordingSessions.length,
      recordings: recordingSessions
    });
  } catch (error) {
    console.error('Error listing recordings:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to get the latest frame rates from metrics
app.get('/api/frame-rates', (req, res) => {
  try {
    // Get metrics directory
    const metricsDir = path.join(__dirname, 'logs', 'metrics');
    if (!fs.existsSync(metricsDir)) {
      return res.status(404).json({
        success: false,
        error: 'Metrics directory not found'
      });
    }
    
    // Read the metrics directory for the most recent files
    const files = fs.readdirSync(metricsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(metricsDir, file);
        return {
          name: file,
          path: filePath,
          time: fs.statSync(filePath).mtime.getTime()
        };
      })
      .sort((a, b) => b.time - a.time); // Sort by most recent first
    
    // Take the 5 most recent metrics files
    const recentFiles = files.slice(0, 5);
    const frameRateData = [];
    
    // Extract frame rate metrics from each file
    recentFiles.forEach(file => {
      try {
        const fileContent = fs.readFileSync(file.path, 'utf8');
        const frameRateLines = fileContent.split('\n')
          .filter(line => line.includes('FRAME_STATS') || line.includes('FPS='));
        
        if (frameRateLines.length > 0) {
          frameRateData.push({
            file: file.name,
            time: new Date(file.time).toISOString(),
            metrics: frameRateLines
          });
        }
      } catch (readError) {
        console.error(`Error reading metrics file ${file.name}: ${readError.message}`);
      }
    });
    
    // Return the frame rate data
    res.json({
      success: true,
      count: frameRateData.length,
      frameRates: frameRateData
    });
  } catch (error) {
    console.error('Error retrieving frame rates:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to delete a specific recording session and all its files
app.delete('/api/recordings/:sessionId', (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    
    if (!sessionId || sessionId.length !== 8) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session ID',
        message: 'Session ID must be 8 characters long'
      });
    }
    
    console.log(`Attempting to delete recording session: ${sessionId}`);
    
    // First check if this is a parent session by looking for its log file
    const parentLogFile = fs.readdirSync(logsDir)
      .filter(file => file.includes(sessionId) && file.endsWith('.log'))
      .find(file => {
        try {
          const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
          return content.includes('Starting multi-platform recording session') || 
                 content.includes('MULTI_PLATFORM_PARENT_SESSION');
        } catch (err) {
          return false;
        }
      });
    
    let childSessionIds = [];
    
    // If this is a parent session, get the child session IDs
    if (parentLogFile) {
      console.log(`Found parent session log: ${parentLogFile}`);
      try {
        const content = fs.readFileSync(path.join(logsDir, parentLogFile), 'utf8');
        
        // Extract child session IDs from the parent log
        const childIdMatches = content.matchAll(/result: recording-([a-f0-9]{8})-/g);
        for (const match of childIdMatches) {
          if (match[1] && !childSessionIds.includes(match[1])) {
            childSessionIds.push(match[1]);
            console.log(`Found child session ID: ${match[1]}`);
          }
        }
      } catch (err) {
        console.error(`Error reading parent log file: ${err.message}`);
      }
    }
    
    // Add the parent session ID to the list of IDs to delete
    const allSessionIds = [sessionId, ...childSessionIds];
    console.log(`Deleting files for sessions: ${allSessionIds.join(', ')}`);
    
    // Find all files associated with all session IDs
    let videoFiles = [];
    let logFiles = [];
    let metricsFiles = [];
    
    allSessionIds.forEach(id => {
      // Find video files for this session ID
      const sessionVideoFiles = fs.readdirSync(uploadsDir)
        .filter(file => file.includes(id) && file.endsWith('.webm'))
        .map(file => path.join(uploadsDir, file));
      
      // Find log files for this session ID
      const sessionLogFiles = fs.readdirSync(logsDir)
        .filter(file => file.includes(id) && file.endsWith('.log'))
        .map(file => path.join(logsDir, file));
      
      // Find metrics files for this session ID
      const sessionMetricsFiles = fs.readdirSync(metricsDir)
        .filter(file => file.includes(id) && file.endsWith('.log'))
        .map(file => path.join(metricsDir, file));
      
      videoFiles = [...videoFiles, ...sessionVideoFiles];
      logFiles = [...logFiles, ...sessionLogFiles];
      metricsFiles = [...metricsFiles, ...sessionMetricsFiles];
    });
    
    // Combine all files
    const allFiles = [...videoFiles, ...logFiles, ...metricsFiles];
    
    if (allFiles.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No files found',
        message: `No files found for session ID: ${sessionId}`
      });
    }
    
    // Delete all files
    const deletedFiles = [];
    const failedFiles = [];
    
    allFiles.forEach(filePath => {
      try {
        const fileName = path.basename(filePath);
        fs.unlinkSync(filePath);
        deletedFiles.push(fileName);
        console.log(`Deleted file: ${fileName}`);
      } catch (err) {
        failedFiles.push({
          path: filePath,
          error: err.message
        });
        console.error(`Failed to delete file ${filePath}: ${err.message}`);
      }
    });
    
    // Return the results
    res.json({
      success: true,
      sessionId,
      childSessions: childSessionIds,
      message: `Deleted ${deletedFiles.length} files for session ID: ${sessionId} and its child sessions`,
      deleted: {
        count: deletedFiles.length,
        files: deletedFiles
      },
      failed: {
        count: failedFiles.length,
        files: failedFiles
      }
    });
    
  } catch (error) {
    console.error(`Error deleting session: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Add API endpoint to delete all recordings
app.delete('/api/recordings', (req, res) => {
  try {
    console.log('Attempting to delete all recording sessions');
    
    // Find all files in all directories
    const videoFiles = fs.existsSync(uploadsDir) ? 
      fs.readdirSync(uploadsDir)
        .filter(file => file.endsWith('.webm'))
        .map(file => path.join(uploadsDir, file)) : [];
      
    const logFiles = fs.existsSync(logsDir) ?
      fs.readdirSync(logsDir)
        .filter(file => file.endsWith('.log') && file.startsWith('recording-'))
        .map(file => path.join(logsDir, file)) : [];
      
    const metricsFiles = fs.existsSync(metricsDir) ?
      fs.readdirSync(metricsDir)
        .filter(file => file.endsWith('.log'))
        .map(file => path.join(metricsDir, file)) : [];
    
    // Combine all files
    const allFiles = [...videoFiles, ...logFiles, ...metricsFiles];
    
    if (allFiles.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No files found',
        message: 'No recording files found to delete'
      });
    }
    
    // Delete all files
    const deletedFiles = [];
    const failedFiles = [];
    
    allFiles.forEach(filePath => {
      try {
        const fileName = path.basename(filePath);
        fs.unlinkSync(filePath);
        deletedFiles.push(fileName);
        console.log(`Deleted file: ${fileName}`);
      } catch (err) {
        failedFiles.push({
          path: filePath,
          error: err.message
        });
        console.error(`Failed to delete file ${filePath}: ${err.message}`);
      }
    });
    
    // Return the results
    res.json({
      success: true,
      message: `Deleted ${deletedFiles.length} files across all recording sessions`,
      deleted: {
        count: deletedFiles.length,
        videoCount: videoFiles.length,
        logCount: logFiles.length,
        metricsCount: metricsFiles.length
      },
      failed: {
        count: failedFiles.length,
        files: failedFiles
      }
    });
    
  } catch (error) {
    console.error(`Error deleting all sessions: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  }
});

// Create server based on environment
let server;

if (isDev) {
  // Development mode - use HTTP
  console.log('Starting HTTP server in development mode');
  server = http.createServer(app);
} else {
  // Production mode - use HTTPS
  console.log('Starting HTTPS server in production mode');
  
  try {
    // Try to read SSL certificates
    const privateKeyPath = process.env.SSL_KEY_PATH || path.join(__dirname, 'ssl', 'privkey.pem');
    const certificatePath = process.env.SSL_CERT_PATH || path.join(__dirname, 'ssl', 'cert.pem');
    
    if (fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath)) {
      const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
      const certificate = fs.readFileSync(certificatePath, 'utf8');
      const credentials = { key: privateKey, cert: certificate };
      
      server = https.createServer(credentials, app);
      console.log('SSL certificates loaded successfully');
    } else {
      console.error('SSL certificates not found. HTTPS server cannot start.');
      console.error(`Looked for certificates at: ${privateKeyPath} and ${certificatePath}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error loading SSL certificates:', error.message);
    process.exit(1);
  }
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${isDev ? 'HTTP' : 'HTTPS'})`);
}).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please kill the process using this port.`);
    process.exit(1);
        } else {
          console.error('Server error:', err);
        }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => console.log('Server closed'));
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => console.log('Server closed'));
  process.exit(0);
}); 