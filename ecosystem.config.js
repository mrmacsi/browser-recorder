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
      HTTPS_PORT: 5443,
      NODE_OPTIONS: '--max-old-space-size=4096',
      SSL_KEY_PATH: '/etc/ssl/browser-recorder/privkey.pem',
      SSL_CERT_PATH: '/etc/ssl/browser-recorder/cert.pem'
    },
  }]
}; 