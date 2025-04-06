#!/bin/bash

# Exit on error
set -e
# Print commands before executing
set -x

# Detect OS
DISTRO=$(lsb_release -i -s)
UBUNTU_VERSION=$(lsb_release -r -s)

echo "Installing on $DISTRO $UBUNTU_VERSION"

# Repository directory is expected to be already cloned by the VM creation script
REPO_DIR="."

# Install or update Node.js to version 18.x (required for Playwright)
echo "Setting up Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js version meets minimum requirements
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"
REQUIRED_NODE_VERSION="v14.0.0"

# Compare versions to ensure we have at least Node.js 14
if [[ "$(printf '%s\n' "$REQUIRED_NODE_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_NODE_VERSION" ]]; then
  echo "ERROR: Node.js version must be 14.0.0 or higher for Playwright to work"
  exit 1
fi

# Install system dependencies with additional performance-focused packages
echo "Installing system dependencies with performance optimizations..."
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  libxcomposite1 \
  libxdamage1 \
  xvfb \
  chromium-browser \
  libnss3 \
  libgbm1 \
  openssl \
  net-tools \
  ffmpeg \
  vainfo \
  intel-gpu-tools \
  mesa-va-drivers \
  libva-drm2 \
  libva-x11-2 \
  i965-va-driver \
  intel-media-va-driver \
  libvdpau-va-gl1 \
  vdpauinfo \
  htop \
  iotop \
  sysstat \
  bc \
  jq

# Kill any existing processes that might be using port 5443
echo "Ensuring port 5443 is free..."
sudo lsof -ti:5443 | xargs -r sudo kill || true

# Stop any existing PM2 processes to avoid port conflicts
if command -v pm2 &> /dev/null; then
  echo "Stopping any existing PM2 processes..."
  pm2 kill || true
fi

# Install Playwright dependencies
echo "Installing Playwright dependencies..."
sudo npx playwright install-deps chromium
npx playwright install chromium

# Install npm dependencies
echo "Installing npm packages..."
npm install

# Install PM2 with monitoring capabilities
echo "Installing PM2 with performance monitoring..."
sudo npm install -g pm2

# Set up memory management improvements
echo "Configuring system for better memory management..."
# Adjust swappiness to reduce disk I/O
sudo sysctl -w vm.swappiness=10
# Add swappiness setting to persist on reboots
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf

# Create a RAM disk for temporary files to improve I/O performance
echo "Setting up RAM disk for temporary files with proper permissions..."
sudo mkdir -p /mnt/ramdisk
sudo mount -t tmpfs -o size=2G tmpfs /mnt/ramdisk
# Make RAM disk world-writable (sticky bit + 777 permissions)
sudo chmod 1777 /mnt/ramdisk
# Make RAM disk mount persistent with proper permissions
echo "tmpfs /mnt/ramdisk tmpfs size=2G,mode=1777 0 0" | sudo tee -a /etc/fstab

# Set up the recorder-specific RAM disk for Ubuntu Server
echo "Setting up dedicated RAM disk for the browser recorder..."
RECORDER_RAMDISK_PATH="/mnt/recorder_ramdisk"

# Create the mount point if it doesn't exist
if [ ! -d "$RECORDER_RAMDISK_PATH" ]; then
  echo "Creating mount point at $RECORDER_RAMDISK_PATH"
  sudo mkdir -p "$RECORDER_RAMDISK_PATH"
else
  echo "Mount point already exists at $RECORDER_RAMDISK_PATH"
  
  # Check if already mounted, and unmount it first
  if mount | grep -q "$RECORDER_RAMDISK_PATH"; then
    echo "Unmounting existing RAM disk at $RECORDER_RAMDISK_PATH"
    sudo umount "$RECORDER_RAMDISK_PATH"
  fi
fi

# Add to /etc/fstab if not already present
if ! grep -q "$RECORDER_RAMDISK_PATH" /etc/fstab; then
  echo "Adding RAM disk entry to /etc/fstab"
  echo "tmpfs $RECORDER_RAMDISK_PATH tmpfs rw,size=2G,mode=1777 0 0" | sudo tee -a /etc/fstab
  echo "Entry added to /etc/fstab"
else
  echo "RAM disk entry already exists in /etc/fstab"
fi

# Mount the RAM disk
echo "Mounting recorder RAM disk..."
sudo mount "$RECORDER_RAMDISK_PATH"

# Set permissions
sudo chmod 1777 "$RECORDER_RAMDISK_PATH"
echo "Set permissions to 1777 (rwxrwxrwt)"

# Create a systemd service to clean the RAM disk
echo "Creating RAM disk monitoring and cleanup service..."

# Create the service file
cat > /tmp/ramdisk-monitor.service << EOF
[Unit]
Description=Monitor and clean browser recorder RAM disk
After=local-fs.target

[Service]
Type=simple
ExecStart=/bin/bash -c 'while true; do find $RECORDER_RAMDISK_PATH -type f -mmin +60 -delete; sleep 3600; done'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Move the service file to the systemd directory
sudo mv /tmp/ramdisk-monitor.service /etc/systemd/system/

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable ramdisk-monitor
sudo systemctl start ramdisk-monitor

echo "Recorder RAM disk setup complete with auto-cleanup service"

# Ensure uploads and logs directories exist with proper permissions
echo "Setting up uploads and logs directories with proper permissions..."
sudo mkdir -p ${REPO_DIR}/uploads ${REPO_DIR}/logs
sudo chmod 777 ${REPO_DIR}/uploads ${REPO_DIR}/logs

# Set up performance-optimized NODE_OPTIONS
echo "Configuring Node.js for improved performance..."
echo 'export NODE_OPTIONS="--max-old-space-size=4096"' | sudo tee -a /etc/profile.d/node-performance.sh
sudo chmod +x /etc/profile.d/node-performance.sh
source /etc/profile.d/node-performance.sh

# Check for hardware acceleration capabilities
echo "Checking for hardware acceleration capabilities..."
HAS_HARDWARE_ACCEL=false

# Check for GPU availability
if command -v lspci &> /dev/null; then
  if lspci | grep -i 'vga\|3d\|2d' | grep -i 'nvidia\|intel\|amd' &> /dev/null; then
    echo "GPU detected via lspci"
    HAS_HARDWARE_ACCEL=true
  fi
fi

# Check for VA-API support
if command -v vainfo &> /dev/null && vainfo &> /dev/null; then
  echo "Hardware acceleration is available via VA-API!"
  HAS_HARDWARE_ACCEL=true
fi

if [ "$HAS_HARDWARE_ACCEL" = true ]; then
  echo "Hardware acceleration is available!"
  echo 'export HARDWARE_ACCELERATION="true"' | sudo tee -a /etc/profile.d/node-performance.sh
  # Load the environment variable right away
  export HARDWARE_ACCELERATION="true"
else
  echo "Hardware acceleration is not available."
  echo 'export HARDWARE_ACCELERATION="false"' | sudo tee -a /etc/profile.d/node-performance.sh
  # Load the environment variable right away
  export HARDWARE_ACCELERATION="false"
fi

# Configure systemd optimization for video performance
echo "Optimizing system for video performance..."
# Disable unnecessary services
if systemctl list-unit-files | grep -q 'snapd.service'; then
  sudo systemctl stop snapd.service snapd.socket snapd.apparmor.service || true
  sudo systemctl disable snapd.service snapd.socket snapd.apparmor.service || true
  echo "Disabled snapd services for better performance"
fi

# Configure CPU governor for performance if available
if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]; then
  echo "Setting CPU governor to performance mode..."
  echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor || true
fi

# Setup process priority for better performance
echo "* soft nice -10" | sudo tee -a /etc/security/limits.conf
echo "* soft rtprio 99" | sudo tee -a /etc/security/limits.conf

# Setup SSL certificates
echo "Setting up SSL certificates..."
# Create directory for certificates
sudo mkdir -p /etc/ssl/browser-recorder

# Generate self-signed certificate
echo "Generating self-signed SSL certificate..."
SERVER_IP=$(curl -s http://ifconfig.me)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/browser-recorder/privkey.pem \
  -out /etc/ssl/browser-recorder/cert.pem \
  -subj "/CN=$SERVER_IP" \
  -addext "subjectAltName = IP:$SERVER_IP"

# Set proper permissions
sudo chmod 600 /etc/ssl/browser-recorder/privkey.pem
sudo chmod 644 /etc/ssl/browser-recorder/cert.pem

# Create optimized PM2 configuration for production
echo "Creating optimized PM2 configuration..."
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'browser-recorder',
    script: 'index.js',
    instances: 'max',
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5443,
      NODE_OPTIONS: '--max-old-space-size=4096',
      SSL_KEY_PATH: '/etc/ssl/browser-recorder/privkey.pem',
      SSL_CERT_PATH: '/etc/ssl/browser-recorder/cert.pem'
    },
  }]
};
EOF

# Start browser-recorder with PM2
echo "Starting browser-recorder service with PM2..."
NODE_OPTIONS="--max-old-space-size=4096" pm2 start ecosystem.config.js

# Setup PM2 to start on boot
echo "Configuring PM2 to start on system boot..."
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME || true

echo "Installation completed successfully!"
echo "The browser recorder service is now running and configured for optimal performance."
echo "HTTPS endpoint: https://localhost:5443"
