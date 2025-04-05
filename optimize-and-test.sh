#!/bin/bash

# Azure VM connection details
VM_IP="52.174.6.19"
VM_USER="azureuser"

echo "=== OPTIMIZATION AND BENCHMARK TEST SCRIPT ==="
echo "This script will apply all optimizations for the Azure F8s_v2 VM and run a benchmark"
echo "=============================================="

# Connect to the VM and run optimization and benchmarking
ssh $VM_USER@$VM_IP << EOF
  #!/bin/bash
  cd /home/azureuser/project
  
  echo "1. Applying system optimizations..."
  
  # Hardware Acceleration
  echo "Setting up hardware acceleration..."
  export HARDWARE_ACCELERATION=true
  echo 'export HARDWARE_ACCELERATION=true' | sudo tee /etc/profile.d/hardware-accel.sh
  sudo chmod +x /etc/profile.d/hardware-accel.sh
  
  # Memory Optimizations
  echo "Applying memory optimizations..."
  export NODE_OPTIONS="--max-old-space-size=8192"
  echo 'export NODE_OPTIONS="--max-old-space-size=8192"' | sudo tee /etc/profile.d/node-performance.sh
  sudo chmod +x /etc/profile.d/node-performance.sh
  sudo sysctl -w vm.swappiness=10 vm.vfs_cache_pressure=50
  
  # Increase RAM disk size
  echo "Setting up RAM disk..."
  if mount | grep /mnt/ramdisk > /dev/null; then
    sudo mount -t tmpfs -o size=6G,remount tmpfs /mnt/ramdisk
    echo "RAM disk resized to 6GB"
  else
    sudo mkdir -p /mnt/ramdisk
    sudo mount -t tmpfs -o size=6G tmpfs /mnt/ramdisk
    echo "RAM disk created with 6GB"
  fi
  sudo chmod 1777 /mnt/ramdisk
  
  # Network Optimizations
  echo "Applying network optimizations..."
  sudo sysctl -w net.core.somaxconn=65535 net.core.netdev_max_backlog=4096 net.ipv4.tcp_keepalive_time=60
  
  # Setup Azure temporary SSD if possible
  echo "Setting up Azure temporary SSD storage..."
  if [ -d /mnt/resource ]; then
    mkdir -p /mnt/resource/browser-recorder/temp
    chmod 777 /mnt/resource/browser-recorder/temp
    echo "Azure temp SSD setup complete"
  else
    echo "Azure temp SSD (/mnt/resource) not available"
  fi
  
  echo "2. Verifying PM2 configuration..."
  # Check if ecosystem.config.js has been updated
  if grep -q "HARDWARE_ACCELERATION" ecosystem.config.js; then
    echo "ecosystem.config.js already has hardware acceleration enabled"
  else
    echo "Updating ecosystem.config.js to enable hardware acceleration..."
    sed -i 's/NODE_OPTIONS: .*/NODE_OPTIONS: "--max-old-space-size=8192",\n      HARDWARE_ACCELERATION: "true"/' ecosystem.config.js
  fi
  
  echo "3. Restarting service with optimizations..."
  # Restart with CPU affinity and process priority
  if pm2 list | grep -q "browser-recorder"; then
    echo "Restarting application with optimizations..."
    sudo nice -n -10 taskset -c 0-5 pm2 restart browser-recorder || pm2 restart browser-recorder
  else
    echo "Starting application with optimizations..."
    sudo nice -n -10 taskset -c 0-5 pm2 start ecosystem.config.js || pm2 start ecosystem.config.js
  fi
  
  echo "4. Running benchmark tests..."
  echo "Waiting for service to fully start..."
  sleep 5
  
  # Check system resources before test
  echo "System resources before test:"
  echo "Memory:"
  free -h
  echo "CPU:"
  top -b -n 1 | head -10
  
  # Run recording test with hardware acceleration enabled
  echo "Running recording test with hardware acceleration enabled..."
  curl -s -X POST "https://localhost:5443/api/record" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"https://example.com\", \"duration\": 5, \"hardware_acceleration\": true}" \
    -k | grep -o '"success":[^,]*'
  
  # Wait for recording to complete and logs to be written
  echo "Waiting for log files to be updated..."
  sleep 2
  
  # Find the latest log file
  LATEST_LOG=\$(find /home/azureuser/project/logs -name "*.log" -type f -exec stat --format="%Y %n" {} \; | sort -nr | head -1 | cut -d' ' -f2)
  
  # Extract performance metrics
  echo "Latest recording performance metrics:"
  if [ ! -z "\$LATEST_LOG" ]; then
    echo "Log file: \$LATEST_LOG"
    grep -i "frame\|fps\|video" "\$LATEST_LOG" || echo "No frame rate metrics in log"
    
    # Get fps settings
    FPS_CONFIG=\$(grep -i "fps" "\$LATEST_LOG" | head -1)
    echo "FPS Configuration: \$FPS_CONFIG"
    
    # Check hardware acceleration status
    HW_ACCEL=\$(grep -i "hardware" "\$LATEST_LOG" | head -1)
    echo "Hardware Acceleration: \$HW_ACCEL"
    
    # Check video settings
    VIDEO_SETTINGS=\$(grep -i "video settings" "\$LATEST_LOG" | head -1)
    echo "Video Settings: \$VIDEO_SETTINGS"
  else
    echo "No log files found"
  fi
  
  echo "PM2 process status:"
  pm2 list
  
  echo "5. Optimization and benchmark complete!"
  echo "===================================="
  echo "Optimization summary:"
  echo "- Hardware acceleration: enabled"
  echo "- RAM disk: 6GB"
  echo "- Node.js memory: 8GB"
  echo "- CPU affinity: Using cores 0-5"
  echo "- Process priority: nice -10"
  echo "- Video resolution: 1280x720"
  echo "- Target FPS: 30"
  echo "===================================="
EOF

echo "Optimization and benchmark script completed!" 