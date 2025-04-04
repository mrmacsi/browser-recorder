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
    const filename = await recordWebsite(url, duration);
    
    // Check if the file exists
    const filePath = path.join(uploadsDir, filename);
    let fileSize = null;
    
    if (!fs.existsSync(filePath)) {
      console.error(`Warning: Generated file ${filePath} does not exist`);
    } else {
      console.log(`File exists and is ready to be served: ${filePath}`);
      // Get file size for logging
      const stats = fs.statSync(filePath);
      fileSize = stats.size;
      console.log(`File size: ${fileSize} bytes`);
    }
    
    // Get the host from request
    const host = req.get('host');
    const protocol = req.protocol;
    
    // Build the absolute URL
    const fileUrl = `/uploads/${filename}`;
    const absoluteUrl = `${protocol}://${host}/uploads/${filename}`;
    
    // Return the recording details
    res.json({
      success: true,
      filename,
      url: fileUrl,
      absoluteUrl: absoluteUrl,
      fileSize
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

// List all recordings endpoint
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => {
        const filePath = path.join(uploadsDir, file);
        const stats = fs.statSync(filePath);
        
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
      });
    
    res.json({
      count: files.length,
      files
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Setup SSL certificates for HTTPS
let privateKey, certificate, credentials;
try {
  privateKey = fs.readFileSync('/etc/ssl/browser-recorder/privkey.pem', 'utf8');
  certificate = fs.readFileSync('/etc/ssl/browser-recorder/cert.pem', 'utf8');
  credentials = { key: privateKey, cert: certificate };
  console.log('SSL certificates loaded successfully');
} catch (error) {
  console.warn('SSL certificates not found or cannot be read:', error.message);
  console.warn('HTTPS server will not be started');
}

// Create HTTP server
const httpServer = http.createServer(app);

// Create HTTPS server if credentials available
let httpsServer;
if (credentials) {
  httpsServer = https.createServer(credentials, app);
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