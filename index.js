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
  const url = req.body.url || 'https://example.com';
  const duration = Math.min(Math.max(parseInt(req.body.duration || 10), 1), 60);
  
  try {
    console.log(`Recording request received for ${url} (${duration}s)`);
    
    // Ensure uploads directory exists before proceeding
    if (!fs.existsSync(uploadsDir)) {
      console.log(`Creating uploads directory: ${uploadsDir}`);
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    // Get the initial files in uploads directory
    const initialFiles = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => ({
        name: file,
        path: path.join(uploadsDir, file),
        time: fs.statSync(path.join(uploadsDir, file)).mtime.getTime(),
        size: fs.statSync(path.join(uploadsDir, file)).size
      }));
    
    // Remove tiny blank files that may exist from previous recordings
    initialFiles.forEach(file => {
      if (file.name.startsWith('blank-') && file.size < 1000) {
        try {
          console.log(`Removing blank placeholder file: ${file.name}`);
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error(`Error removing blank file: ${err.message}`);
        }
      }
    });
    
    // Record the website - this will create a new file in uploads directory
    const recordingResult = await recordWebsite(url, duration);
    
    // Check if there was an error during recording
    if (recordingResult.error) {
      return res.status(500).json({
        success: false,
        error: 'Recording failed',
        message: recordingResult.error,
        logFile: recordingResult.logFile
      });
    }
    
    // Get the filename from the result
    const resultFilename = recordingResult.fileName;
    const logFilename = recordingResult.logFile;
    
    // Check if we have a valid filename
    if (!resultFilename) {
      console.error('No filename returned from recording process');
      return res.status(500).json({
        success: false,
        error: 'Recording failed',
        message: 'No filename returned from recording process',
        logFile: logFilename
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