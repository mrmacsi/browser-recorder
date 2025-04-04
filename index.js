const express = require('express');
const cors = require('cors');
const path = require('path');
const { recordWebsite } = require('./recorder');

const app = express();
const PORT = process.env.PORT || 5001;

// More permissive CORS for local development
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  // Allow all origins in development
  app.use(cors());
  console.log('Running in development mode - CORS enabled for all origins');
} else {
  // Production CORS settings - more permissive to work with multiple frontends
  app.use(cors({
    origin: '*', // Allow all origins in production for now
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  console.log('Running in production mode - CORS enabled for all origins');
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root endpoint to verify the API is running
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Sector Analytics Recorder API is running',
    version: '1.0.0',
    endpoints: {
      status: '/api/status',
      test: '/api/test',
      record: '/api/record (POST)'
    }
  });
});

// Add a test endpoint to verify API is working
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API is working properly!' });
});

// Increase timeout for long-running recording requests
app.use((req, res, next) => {
  // Set a longer timeout for recording requests (5 minutes)
  if (req.path.includes('/api/record')) {
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000); // 5 minutes
  }
  next();
});

app.post('/api/record', async (req, res) => {
  try {
    const { url = 'http://localhost:8080/animated-global-graph?record=true', duration = 10 } = req.body;
    let recordUrl = url;
    
    // Extract speed parameter if provided
    const { speed } = req.body;
    
    // Add speed parameter to URL if provided
    if (speed && !recordUrl.includes('speed=')) {
      // Check if URL already has query parameters
      recordUrl += recordUrl.includes('?') ? `&speed=${speed}` : `?speed=${speed}`;
    }

    if (!recordUrl.startsWith('http')) {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    
    if (duration < 1 || duration > 60) {
      return res.status(400).json({ error: 'Duration must be between 1 and 60 seconds' });
    }

    console.log(`Received recording request for URL: ${recordUrl}, duration: ${duration}s${speed ? `, speed: ${speed}` : ''}`);
    const filename = await recordWebsite(recordUrl, duration);
    
    // Construct the complete URL to the video file
    const videoUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;

    res.json({ success: true, videoUrl, filename });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `The requested endpoint ${req.method} ${req.path} does not exist`
  });
});

// Handle other errors
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Server Error',
    message: isDev ? err.message : 'An unexpected error occurred'
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 