# Use Node.js 18 as the base image
FROM node:18-slim

# Install dependencies required for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    fonts-noto-color-emoji \
    fonts-liberation \
    libvulkan1 \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install ffmpeg for video recording
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy app source
COPY . .

# Create uploads directory
RUN mkdir -p uploads && chmod 777 uploads

# Expose the port
EXPOSE 5443

# Set the command
CMD ["npm", "start"] 