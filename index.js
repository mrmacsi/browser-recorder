const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { recordWebsite } = require('./recorder');
const http = require('http');
const https = require('https');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 5001;
const HTTPS_PORT = process.env.HTTPS_PORT || 5443;

// Enable CORS for development
if (process.env.NODE_ENV !== 'production') {
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
        time: fs.statSync(path.join(uploadsDir, file)).mtime.getTime()
      }));
    
    // Record the website - this will create a new file in uploads directory
    await recordWebsite(url, duration);
    
    // Get all files in uploads directory after recording
    const afterFiles = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => ({
        name: file,
        path: path.join(uploadsDir, file),
        time: fs.statSync(path.join(uploadsDir, file)).mtime.getTime(),
        size: fs.statSync(path.join(uploadsDir, file)).size
      }))
      .sort((a, b) => b.time - a.time); // Sort by most recent
    
    // Find the most recent file that wasn't there before
    let newFiles = afterFiles.filter(file => 
      !initialFiles.some(initial => initial.name === file.name) || 
      initialFiles.some(initial => initial.name === file.name && initial.time < file.time)
    );
    
    // If we didn't find any new files, just use the most recent file
    if (newFiles.length === 0 && afterFiles.length > 0) {
      console.log('No new files found. Using the most recent file.');
      newFiles = [afterFiles[0]];
    }
    
    // Check if we found any file
    if (newFiles.length === 0) {
      console.error('No video files found after recording');
      return res.status(500).json({
        success: false,
        error: 'Recording failed',
        message: 'No video files found after recording'
      });
    }
    
    // Use the most recent file
    const videoFile = newFiles[0];
    console.log(`Using video file: ${videoFile.name} (${videoFile.size} bytes)`);
    
    // Get the host from request
    const host = req.get('host');
    const protocol = req.protocol;
    
    // Build the absolute URL
    const fileUrl = `/uploads/${videoFile.name}`;
    const absoluteUrl = `${protocol}://${host}/uploads/${videoFile.name}`;
    
    // Return the recording details
    res.json({
      success: true,
      filename: videoFile.name,
      url: fileUrl,
      absoluteUrl: absoluteUrl,
      fileSize: videoFile.size
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

// Create HTTP server
const httpServer = http.createServer(app);

// Setup SSL certificates for HTTPS
let httpsServer;
try {
  // Try to read SSL certificates if available
  const privateKeyPath = process.env.SSL_KEY_PATH || '/etc/ssl/browser-recorder/privkey.pem';
  const certificatePath = process.env.SSL_CERT_PATH || '/etc/ssl/browser-recorder/cert.pem';
  
  if (fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath)) {
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    const certificate = fs.readFileSync(certificatePath, 'utf8');
    const credentials = { key: privateKey, cert: certificate };
    
    // Create HTTPS server with the certificates
    httpsServer = https.createServer(credentials, app);
    console.log('SSL certificates loaded successfully');
  } else {
    console.warn('SSL certificates not found at standard path or environment variables.');
    console.warn('HTTPS server will not be started.');
  }
} catch (error) {
  console.warn('Error loading SSL certificates:', error.message);
  console.warn('HTTPS server will not be started');
}

// Start HTTP server
httpServer.listen(PORT, () => {
  console.log(`HTTP Server running on port ${PORT}`);
});

// Start HTTPS server if available
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`HTTPS Server running on port ${HTTPS_PORT}`);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => console.log('HTTP server closed'));
  if (httpsServer) {
    httpsServer.close(() => console.log('HTTPS server closed'));
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  httpServer.close(() => console.log('HTTP server closed'));
  if (httpsServer) {
    httpsServer.close(() => console.log('HTTPS server closed'));
  }
  process.exit(0);
}); 