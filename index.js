const express = require('express');
const cors = require('cors');
const path = require('path');
const { recordWebsite } = require('./recorder');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 5001;

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

// Check for HTTPS requests - redirect to HTTP if needed
app.use((req, res, next) => {
  // Check if the original request was HTTPS
  const forwardedProto = req.headers['x-forwarded-proto'];
  
  if (forwardedProto === 'https') {
    // If it's an HTTPS request coming through a proxy
    const host = req.headers.host;
    const newUrl = `http://${host}${req.originalUrl}`;
    console.log(`HTTPS detected, redirecting to HTTP: ${newUrl}`);
    return res.redirect(newUrl);
  }
  
  next();
});

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
    if (!fs.existsSync(filePath)) {
      console.error(`Warning: Generated file ${filePath} does not exist`);
    } else {
      console.log(`File exists and is ready to be served: ${filePath}`);
      // Get file size for logging
      const stats = fs.statSync(filePath);
      console.log(`File size: ${stats.size} bytes`);
    }
    
    // Get the host from request
    const host = req.get('host');
    const protocol = req.protocol;
    
    // Build the absolute URL
    let fileUrl = `/uploads/${filename}`;
    let absoluteUrl = `${protocol}://${host}/uploads/${filename}`;
    
    // Return the recording details
    res.json({
      filename,
      url: fileUrl,
      absoluteUrl: absoluteUrl,
      fileSize: fs.existsSync(filePath) ? fs.statSync(filePath).size : null
    });
  } catch (error) {
    console.error('Error during recording:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// List all recordings endpoint
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.webm'))
      .map(file => ({
        filename: file,
        url: `/uploads/${file}`,
        size: fs.statSync(path.join(uploadsDir, file)).size,
        created: fs.statSync(path.join(uploadsDir, file)).mtime.toISOString()
      }));
    
    res.json({
      count: files.length,
      files
    });
  } catch (error) {
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Add a more descriptive error for HTTPS URLs
app.get('/https:*', (req, res) => {
  const host = req.get('host');
  const correctUrl = `http://${host}/api/health`;
  
  res.status(400).send(`
    <html>
      <head><title>HTTP Only Service</title></head>
      <body>
        <h1>This service only supports HTTP</h1>
        <p>Please use <a href="${correctUrl}">${correctUrl}</a> instead.</p>
        <p>The URL you tried to access appears to be using HTTPS, which is not supported by this service.</p>
      </body>
    </html>
  `);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Browser recorder service running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
}); 