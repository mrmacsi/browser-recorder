#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || '5443';
const API_PROTOCOL = process.env.API_PROTOCOL || 'http';
const API_PATH = '/api/latest-metrics';
const REFRESH_INTERVAL = 1000; // Check every second

const ANSI_RESET = "\x1b[0m";
const ANSI_RED = "\x1b[31m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_MAGENTA = "\x1b[35m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_BOLD = "\x1b[1m";

// Function to format metrics for display
function formatMetrics(metrics) {
  if (!metrics || !metrics.frameRateMetrics || metrics.frameRateMetrics.length === 0) {
    return `${ANSI_YELLOW}No frame rate metrics available${ANSI_RESET}`;
  }

  let output = `${ANSI_CYAN}${ANSI_BOLD}FRAME RATE METRICS:${ANSI_RESET}\n`;
  
  // Process each metric line
  metrics.frameRateMetrics.forEach(line => {
    if (line.includes('FRAME_STATS')) {
      const parts = line.split(',');
      const timestamp = line.match(/\[(.*?)\]/)?.[1] || 'unknown';
      
      let formattedLine = `${ANSI_BOLD}[${timestamp}]${ANSI_RESET} `;
      
      // Parse and format FPS
      const fpsMatch = line.match(/FPS=(\d+)/);
      if (fpsMatch) {
        const fps = parseInt(fpsMatch[1]);
        let fpsColor = ANSI_RED;
        if (fps >= 30) fpsColor = ANSI_GREEN;
        else if (fps >= 20) fpsColor = ANSI_YELLOW;
        
        formattedLine += `${fpsColor}${fps} FPS${ANSI_RESET} `;
      }
      
      // Parse and format average frame time
      const avgTimeMatch = line.match(/AVG_TIME=([\d.]+)ms/);
      if (avgTimeMatch) {
        const avgTime = parseFloat(avgTimeMatch[1]);
        let timeColor = ANSI_RED;
        if (avgTime < 30) timeColor = ANSI_GREEN;
        else if (avgTime < 50) timeColor = ANSI_YELLOW;
        
        formattedLine += `${timeColor}Avg: ${avgTime}ms${ANSI_RESET} `;
      }
      
      // Parse and format min/max
      const minMatch = line.match(/MIN=([\d.]+)ms/);
      const maxMatch = line.match(/MAX=([\d.]+)ms/);
      if (minMatch && maxMatch) {
        formattedLine += `${ANSI_BLUE}Min: ${minMatch[1]}ms${ANSI_RESET} ${ANSI_MAGENTA}Max: ${maxMatch[1]}ms${ANSI_RESET}`;
      }
      
      output += formattedLine + '\n';
    }
    else if (line.includes('RECORDING_STATS')) {
      const timestamp = line.match(/\[(.*?)\]/)?.[1] || 'unknown';
      output += `${ANSI_BOLD}[${timestamp}] ${ANSI_GREEN}RECORDING SUMMARY:${ANSI_RESET} ${line.replace(/.*RECORDING_STATS,/, '')}\n`;
    }
  });
  
  return output;
}

// Function to fetch metrics from API
function fetchMetrics() {
  return new Promise((resolve, reject) => {
    const requestLib = API_PROTOCOL === 'https' ? https : http;
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: API_PATH,
      method: 'GET',
      rejectUnauthorized: false // For self-signed certificates
    };
    
    const req = requestLib.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch metrics: ${res.statusCode}`));
        }
        
        try {
          const metrics = JSON.parse(data);
          resolve(metrics);
        } catch (error) {
          reject(new Error(`Failed to parse metrics: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

// Function to clear terminal
function clearTerminal() {
  process.stdout.write('\x1Bc');
}

// Function to watch for metrics updates
async function watchMetrics() {
  let lastFilename = null;
  
  console.log(`${ANSI_BOLD}${ANSI_CYAN}🔍 Frame Rate Metrics Monitor${ANSI_RESET}`);
  console.log(`${ANSI_YELLOW}Connecting to ${API_PROTOCOL}://${API_HOST}:${API_PORT}${API_PATH}${ANSI_RESET}`);
  console.log(`${ANSI_YELLOW}Press Ctrl+C to exit${ANSI_RESET}`);
  
  // Main loop to check for updates
  setInterval(async () => {
    try {
      const metrics = await fetchMetrics();
      
      // Only update if we have a new metrics file
      if (metrics.filename !== lastFilename) {
        clearTerminal();
        console.log(`${ANSI_BOLD}${ANSI_CYAN}🔍 Frame Rate Metrics Monitor${ANSI_RESET}`);
        console.log(`${ANSI_YELLOW}Metrics File: ${metrics.filename} (${new Date(metrics.time).toLocaleString()})${ANSI_RESET}`);
        console.log(formatMetrics(metrics));
        
        lastFilename = metrics.filename;
      }
    } catch (error) {
      clearTerminal();
      console.log(`${ANSI_BOLD}${ANSI_CYAN}🔍 Frame Rate Metrics Monitor${ANSI_RESET}`);
      console.log(`${ANSI_RED}Error: ${error.message}${ANSI_RESET}`);
      console.log(`${ANSI_YELLOW}Waiting for server to be available...${ANSI_RESET}`);
    }
  }, REFRESH_INTERVAL);
}

// Start watching metrics
watchMetrics();

// Handle clean exit on Ctrl+C
process.on('SIGINT', () => {
  console.log(`\n${ANSI_YELLOW}Exiting frame rate monitor.${ANSI_RESET}`);
  process.exit(0);
}); 