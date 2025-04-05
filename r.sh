#!/bin/bash

# Azure VM connection details
VM_IP="52.174.6.19"
VM_USER="azureuser"
PROJECT_DIR="/home/azureuser/project"

echo "Connecting to $VM_USER@$VM_IP and updating application with performance optimizations..."

# Connect to the VM, pull the latest changes and restart the application
ssh $VM_USER@$VM_IP << EOF
  echo "Changing to project directory..."
  cd $PROJECT_DIR
  
  echo "Setting Git to trust the project directory..."
  sudo git config --global --add safe.directory $PROJECT_DIR
  
  echo "Pulling latest changes from git with sudo..."
  sudo git pull
  
  echo "Ensuring logs and metrics directories exist with proper permissions..."
  sudo mkdir -p $PROJECT_DIR/logs
  sudo mkdir -p $PROJECT_DIR/logs/metrics
  sudo chmod 777 $PROJECT_DIR/logs
  sudo chmod 777 $PROJECT_DIR/logs/metrics
  
  # Setup Azure temp SSD directory for better performance, with better error handling
  echo "Setting up storage optimizations..."
  if [ -d "/mnt/resource" ]; then
    echo "Azure temp SSD detected, creating working directory..."
    mkdir -p /mnt/resource/browser-recorder/temp 2>/dev/null || sudo mkdir -p /mnt/resource/browser-recorder/temp
    chmod 777 /mnt/resource/browser-recorder/temp 2>/dev/null || sudo chmod 777 /mnt/resource/browser-recorder/temp
    echo "Azure temp SSD setup complete"
  else
    echo "Azure temp SSD not available, using standard temp directory"
  fi
  
  # Apply performance optimizations
  echo "Applying hardware acceleration optimization..."
  export HARDWARE_ACCELERATION=true
  echo 'export HARDWARE_ACCELERATION=true' | sudo tee /etc/profile.d/hardware-accel.sh
  sudo chmod +x /etc/profile.d/hardware-accel.sh
  
  # Set Node.js memory options
  echo "Setting up Node.js with increased memory..."
  export NODE_OPTIONS="--max-old-space-size=8192"
  
  # Apply CPU optimization with better error handling
  echo "Optimizing CPU settings..."
  if [ -d "/sys/devices/system/cpu/cpu0/cpufreq" ]; then
    echo "CPU frequency scaling available, setting governor to performance"
    echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null || echo "Could not set CPU governor (permission denied)"
  else
    echo "CPU frequency scaling not available on this VM"
  fi
  
  # Apply memory optimizations if possible
  echo "Optimizing kernel memory settings..."
  sudo sysctl -w vm.swappiness=10 vm.vfs_cache_pressure=50 || echo "Could not set memory optimizations"
  
  # Increase RAM disk size
  echo "Setting up RAM disk..."
  if mount | grep /mnt/ramdisk > /dev/null; then
    echo "Existing RAM disk found, resizing to 6GB"
    sudo mount -t tmpfs -o size=6G,remount tmpfs /mnt/ramdisk || echo "Could not resize RAM disk"
    sudo chmod 1777 /mnt/ramdisk
  else
    echo "No RAM disk found, creating a new one (6GB)"
    sudo mkdir -p /mnt/ramdisk 2>/dev/null
    sudo mount -t tmpfs -o size=6G tmpfs /mnt/ramdisk 2>/dev/null || echo "Could not create RAM disk"
    sudo chmod 1777 /mnt/ramdisk 2>/dev/null
  fi
  
  # Apply network optimizations
  echo "Optimizing network settings..."
  sudo sysctl -w net.core.somaxconn=65535 net.core.netdev_max_backlog=4096 net.ipv4.tcp_keepalive_time=60 || echo "Could not set network optimizations"
  
  echo "Checking if PM2 is running the application with CPU affinity..."
  if pm2 list | grep -q "browser-recorder"; then
    echo "Restarting application with PM2 and process priority..."
    # Try first with taskset, but fall back to regular restart if it fails
    sudo nice -n -10 taskset -c 0-5 pm2 restart browser-recorder 2>/dev/null || pm2 restart browser-recorder
  else
    echo "Starting application with PM2 and CPU affinity..."
    # Try first with taskset, but fall back to regular start if it fails
    sudo nice -n -10 taskset -c 0-5 pm2 start ecosystem.config.js 2>/dev/null || pm2 start ecosystem.config.js
  fi
  
  echo "Checking application health..."
  curl -k https://localhost:5443/api/health
  
  echo "Checking free memory..."
  free -h
  
  echo "Update complete! Optimizations applied."
EOF

echo "Script execution finished." 