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