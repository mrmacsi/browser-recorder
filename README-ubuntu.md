# Ubuntu Server RAM Disk Setup for Browser Recorder

This document explains how RAM disk support works on Ubuntu Server for optimal performance with the Browser Recorder application.

## Why Use a RAM Disk?

A RAM disk provides several advantages for video recording and processing:

- **Speed**: Much faster than regular disk I/O
- **Reduced wear**: No writes to SSDs, extending lifespan
- **Consistent performance**: Not affected by disk fragmentation or other I/O operations
- **Improved reliability**: Reduced chance of I/O bottlenecks during recording

## Automatic Setup

The RAM disk is automatically set up during installation when you run the `install.sh` script:

```bash
# Clone the repository if you haven't already
git clone https://github.com/your-repo/browser-recorder.git
cd browser-recorder

# Run the installation script (includes RAM disk setup)
sudo ./install.sh
```

The installation process:
1. Creates a RAM disk at `/mnt/recorder_ramdisk`
2. Sets appropriate permissions
3. Configures the RAM disk to persist across reboots
4. Creates a systemd service to periodically clean up old files

## Manual Setup

If you need to manually set up the RAM disk for any reason:

```bash
# Create the mount point
sudo mkdir -p /mnt/recorder_ramdisk

# Mount a 2GB RAM disk
sudo mount -t tmpfs -o size=2G tmpfs /mnt/recorder_ramdisk

# Set permissions
sudo chmod 1777 /mnt/recorder_ramdisk

# For persistence across reboots, add to /etc/fstab:
echo "tmpfs /mnt/recorder_ramdisk tmpfs rw,size=2G,mode=1777 0 0" | sudo tee -a /etc/fstab

# Create cleanup service
cat > /tmp/ramdisk-monitor.service << EOF
[Unit]
Description=Monitor and clean browser recorder RAM disk
After=local-fs.target

[Service]
Type=simple
ExecStart=/bin/bash -c 'while true; do find /mnt/recorder_ramdisk -type f -mmin +60 -delete; sleep 3600; done'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/ramdisk-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ramdisk-monitor
sudo systemctl start ramdisk-monitor
```

## Verifying the Setup

To verify that the RAM disk is properly set up:

```bash
# Check if mounted
mount | grep recorder_ramdisk

# Check disk usage and size
df -h /mnt/recorder_ramdisk

# Check permissions
ls -la /mnt/recorder_ramdisk
```

## Adjusting RAM Disk Size

The default size is 2GB. To change this:

1. Edit `/etc/fstab` and change the `size=2G` parameter
2. Remount the RAM disk: `sudo mount -o remount /mnt/recorder_ramdisk`

## Monitoring and Maintenance

The setup script creates a systemd service that automatically removes files older than 1 hour from the RAM disk. You can check its status with:

```bash
sudo systemctl status ramdisk-monitor
```

To manually clean the RAM disk:

```bash
sudo find /mnt/recorder_ramdisk -type f -delete
```

## Troubleshooting

If you encounter issues:

1. **RAM disk not mounted after reboot**: 
   - Check `/etc/fstab` for errors
   - Try manual mounting: `sudo mount /mnt/recorder_ramdisk`

2. **Permission errors**:
   - Reset permissions: `sudo chmod 1777 /mnt/recorder_ramdisk`

3. **Out of memory errors**:
   - Reduce the RAM disk size in `/etc/fstab`
   - Ensure your server has enough physical RAM

4. **Application not using RAM disk**:
   - Verify the application is configured to use `/mnt/recorder_ramdisk`
   - Check for file permissions issues

## Best Practices

- Monitor free RAM to ensure your server has enough memory
- Don't store permanent data on the RAM disk (it's lost on reboot)
- Regular maintenance to remove old files is important

## Additional Resources

- [Ubuntu tmpfs documentation](https://help.ubuntu.com/community/Tmpfs)
- [More about RAM disks in Linux](https://www.linuxbabe.com/command-line/create-ramdisk-ubuntu) 