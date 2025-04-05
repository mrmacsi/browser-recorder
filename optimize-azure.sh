#!/bin/bash

# Exit on error
set -e

echo "Applying performance optimizations for Azure Standard_F8s_v2 VM..."

# Hardware Acceleration Setup
echo "Setting up hardware acceleration..."
export HARDWARE_ACCELERATION=true
echo 'export HARDWARE_ACCELERATION=true' | sudo tee -a /etc/profile.d/hardware-accel.sh
sudo chmod +x /etc/profile.d/hardware-accel.sh

# Install latest GPU drivers
echo "Installing GPU drivers and utilities..."
sudo apt update
sudo apt install -y mesa-utils vainfo intel-gpu-tools mesa-va-drivers libva-drm2 libva-x11-2

# CPU Optimizations
echo "Applying CPU optimizations..."
# Set CPU governor to performance mode if running on Linux
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor || echo "Could not set CPU governor"
# Disable CPU throttling
echo 0 | sudo tee /proc/sys/kernel/nmi_watchdog || echo "Could not disable NMI watchdog"
# Set process priority for PM2
sudo nice -n -10 pm2 restart all || echo "Could not set process priority"

# Memory Optimizations
echo "Applying memory optimizations..."
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"
echo 'export NODE_OPTIONS="--max-old-space-size=8192"' | sudo tee /etc/profile.d/node-performance.sh
sudo chmod +x /etc/profile.d/node-performance.sh
# Optimize kernel memory settings
sudo sysctl -w vm.swappiness=10 vm.vfs_cache_pressure=50
# Make sysctl settings permanent
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
echo "vm.vfs_cache_pressure=50" | sudo tee -a /etc/sysctl.conf

# Increase RAM disk size
echo "Configuring 6GB RAM disk..."
if mount | grep /mnt/ramdisk > /dev/null; then
  sudo mount -t tmpfs -o size=6G,remount tmpfs /mnt/ramdisk
  echo "RAM disk resized to 6GB"
else
  sudo mkdir -p /mnt/ramdisk
  sudo mount -t tmpfs -o size=6G tmpfs /mnt/ramdisk
  echo "RAM disk created with 6GB"
fi
sudo chmod 1777 /mnt/ramdisk
# Update /etc/fstab for persistence
sudo sed -i 's/size=2G/size=6G/g' /etc/fstab || sudo bash -c 'echo "tmpfs /mnt/ramdisk tmpfs size=6G,mode=1777 0 0" >> /etc/fstab'

# Storage Optimizations - Use Azure temporary SSD
echo "Setting up Azure temporary SSD storage..."
mkdir -p /mnt/resource/browser-recorder/temp
chmod 777 /mnt/resource/browser-recorder/temp
echo "Checking disk I/O performance..."
iostat -x 1 3 || echo "iostat not available, install sysstat for I/O monitoring"

# Network Optimizations
echo "Applying network optimizations..."
sudo sysctl -w net.core.somaxconn=65535
sudo sysctl -w net.core.netdev_max_backlog=4096
sudo sysctl -w net.ipv4.tcp_keepalive_time=60
# Make network settings permanent
echo "net.core.somaxconn=65535" | sudo tee -a /etc/sysctl.conf
echo "net.core.netdev_max_backlog=4096" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_time=60" | sudo tee -a /etc/sysctl.conf

# Apply all sysctl changes
sudo sysctl -p

# Create taskset command for CPU affinity
# This runs PM2 with affinity to first 6 cores (0-5)
echo "Setting up CPU affinity script..."
cat > cpu-affinity.sh << 'EOF'
#!/bin/bash
taskset -c 0-5 pm2 start ecosystem.config.js
EOF
chmod +x cpu-affinity.sh

echo "Optimization complete! Please restart the service with CPU affinity:"
echo "  ./cpu-affinity.sh"
echo
echo "To monitor performance:"
echo "  - Check CPU usage: top -b -n 1 | head -20"
echo "  - Monitor memory: free -h"
echo "  - Track frame rates: grep \"FRAME_STATS\" logs/metrics/*.log | tail -5"
echo "  - Check process status: pm2 status" 