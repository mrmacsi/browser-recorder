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
git clone https://github.com/yourusername/browser-recorder.git
cd browser-recorder

# Install dependencies
npm install

# Run the installation script (for server deployment)
chmod +x install.sh
./install.sh
```

## API Usage

### Record a website

```bash
curl -X POST http://localhost:5001/api/record \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "duration": 10}'
```

Response:
```json
{
  "filename": "recording-8f7d8f7d-8f7d-8f7d-8f7d-8f7d8f7d8f7d.webm",
  "url": "/uploads/recording-8f7d8f7d-8f7d-8f7d-8f7d-8f7d8f7d8f7d.webm"
}
```

### Get recording status

```bash
curl http://localhost:5001/api/health
```

## Development

```bash
# Run in development mode
npm run dev
```

## Deployment

See the `deploy-instructions.md` file for various deployment options. 