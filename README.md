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

## Development

```bash
# Run in development mode
npm run dev
```

## Deployment

See the `deploy-instructions.md` file for various deployment options.
