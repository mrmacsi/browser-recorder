#!/bin/bash

# Azure VM connection details
VM_IP="52.174.6.19"
VM_USER="azureuser"
PROJECT_DIR="/home/azureuser/project"

echo "Connecting to $VM_USER@$VM_IP and updating application..."

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
  
  echo "Checking if PM2 is running the application..."
  if pm2 list | grep -q "browser-recorder"; then
    echo "Restarting application with PM2..."
    pm2 restart browser-recorder
  else
    echo "Starting application with PM2..."
    pm2 start ecosystem.config.js
  fi
  
  echo "Checking application health..."
  curl -k https://localhost:5443/api/health
  
  echo "Update complete!"
EOF

echo "Script execution finished." 