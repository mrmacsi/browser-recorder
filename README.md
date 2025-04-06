# Browser Recorder

A service for recording website interactions and animations using headless browsers.

## Features

- Record any website as video
- Configurable recording duration
- API-based for easy integration
- Uses Playwright for high-quality recordings

## Installation

```bash
# Clone the repository
git clone https://github.com/mrmacsi/browser-recorder.git
cd browser-recorder

# Install dependencies
npm install

# Install Playwright Chromium
npx playwright install chromium

# Create SSL certificates for local development
mkdir -p ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ssl/privkey.pem -out ssl/cert.pem -subj "/CN=localhost" -addext "subjectAltName = IP:127.0.0.1"

# Run the installation script (for server deployment)
chmod +x install.sh
./install.sh
```

## API Usage

### Record a website

```bash
curl -k -X POST https://localhost:5443/api/record \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "duration": 10}'
```

### Get recording status

```bash
curl -k https://localhost:5443/api/health
```

### List recorded videos

```bash
curl -k https://localhost:5443/api/files
```

## API Endpoints

### Record a Website
`POST /api/record`

Parameters:
- `url` (required): URL to record
- `duration` (optional): Recording duration in seconds (default: 10)
- `platform` (optional): Platform format (STANDARD_16_9, VERTICAL_9_16, SQUARE)
- `resolution` (optional): Video resolution (720p, 1080p, 2k)

### Multi-Platform Recording
The `/api/record` endpoint now supports simultaneous recording for multiple platforms!

Parameters:
- `url` (required): URL to record
- `duration` (optional): Recording duration in seconds (default: 10)
- `platforms` (required): Array of platform formats to record simultaneously (e.g., ["STANDARD_16_9", "VERTICAL_9_16", "SQUARE"])
- `resolution` (optional): Video resolution for all recordings (720p, 1080p, 2k)
- `quality` (optional): Video quality (low, balanced, high)
- `fps` (optional): Frame rate for the recording

Example request:
```json
{
  "url": "https://example.com",
  "duration": 10,
  "platforms": ["STANDARD_16_9", "VERTICAL_9_16", "SQUARE"],
  "resolution": "1080p",
  "quality": "balanced"
}
```

The API will return an object with all platform recordings:
```json
{
  "success": true,
  "multiPlatform": true,
  "sessionId": "3186b6a4",
  "platforms": [
    {
      "platform": "STANDARD_16_9",
      "success": true,
      "fileName": "recording-abc123.webm",
      "url": "/uploads/recording-abc123.webm",
      "absoluteUrl": "http://example.com/uploads/recording-abc123.webm",
      "logFile": "recording-abc123.log",
      "logUrl": "/api/logs/recording-abc123.log"
    },
    {
      "platform": "VERTICAL_9_16",
      "success": true,
      "fileName": "recording-def456.webm",
      "url": "/uploads/recording-def456.webm",
      "absoluteUrl": "http://example.com/uploads/recording-def456.webm",
      "logFile": "recording-def456.log",
      "logUrl": "/api/logs/recording-def456.log"
    },
    {
      "platform": "SQUARE",
      "success": true,
      "fileName": "recording-ghi789.webm",
      "url": "/uploads/recording-ghi789.webm",
      "absoluteUrl": "http://example.com/uploads/recording-ghi789.webm",
      "logFile": "recording-ghi789.log",
      "logUrl": "/api/logs/recording-ghi789.log"
    }
  ],
  "logFile": "recording-multi-session.log",
  "logUrl": "/api/logs/recording-multi-session.log"
}
```

### List All Files

```bash
curl -k https://localhost:5443/api/files
```

### Delete a Specific Recording
`DELETE /api/recordings/:sessionId`

Deletes all files (video, log, metrics) associated with a specific recording session ID.

### Delete All Recordings
`DELETE /api/recordings`

Deletes all recording files from the system, including all videos, logs, and metrics files.

Example response:
```json
{
  "success": true,
  "message": "Deleted 211 files across all recording sessions",
  "deleted": {
    "count": 211,
    "videoCount": 40,
    "logCount": 96,
    "metricsCount": 75
  },
  "failed": {
    "count": 0,
    "files": []
  }
}
```

## Development

```bash
# Run in development mode
npm run dev
```

## Deployment

See the `deploy-instructions.md` file for various deployment options.

## Ubuntu Server Support

This application includes support for running on Ubuntu Server with RAM disk optimization. The RAM disk setup is automatically handled by the `install.sh` script during installation.

For Ubuntu-specific details, see [README-ubuntu.md](README-ubuntu.md).
