const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { recordWebsite, getLatestLogFile } = require('./recorder');
const http = require('http');
const https = require('https');

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
    const { url, duration } = req.body;
    
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
    
    // Call the recorder with the URL and optional duration
    const result = await recordWebsite(url, duration || 10);
    
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