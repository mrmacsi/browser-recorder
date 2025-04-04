# Deployment Instructions

## Option 1: Deploy to Railway (Requires paid plan)

Railway is the recommended platform due to its simplicity and performance for containerized apps. However, it requires a paid plan for this type of application.

1. **Install the Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**:
   ```bash
   railway login
   ```

3. **Initialize a new project**:
   ```bash
   railway init
   ```
   - Select your workspace
   - Create a new project

4. **Link your local repo**:
   ```bash
   railway link
   ```

5. **Deploy your app**:
   ```bash
   railway up
   ```

6. **Set up domain (optional)**:
   ```bash
   railway domain
   ```

7. **Update resources if needed** in the Railway dashboard to ensure sufficient memory for Puppeteer.

## Option 2: Deploy to Render

Render is a good alternative that provides a free tier that can handle this application.

1. **Sign up/Login to Render**: [render.com](https://render.com)

2. **Create a new Web Service**:
   - Click "New" > "Web Service"
   - Connect your GitHub/GitLab repository
   - Navigate to the `backend` directory

3. **Configure the service**:
   - Name: `sector-analytics-recorder`
   - Runtime: Docker
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Add the environment variable: `PORT=5000`

4. **Set up disk storage**:
   - In Advanced settings, add disk storage
   - Name: `uploads`
   - Mount Path: `/app/uploads`
   - Size: 1 GB (adjust as needed)

5. **Select an appropriate plan**: 
   - The "Starter" plan should be sufficient for testing
   - Scale up as needed based on usage

6. **Click "Create Web Service"**

## Option 3: Run on a VPS (Digital Ocean, Linode, etc.)

For more control and potentially lower costs with high usage:

1. **Create a VPS** with at least 2GB RAM

2. **Install Docker and Docker Compose**

3. **Deploy using Docker**:
   ```bash
   docker build -t recorder-backend .
   docker run -p 5000:5000 -v $(pwd)/uploads:/app/uploads recorder-backend
   ```

## After Deployment (Any Platform)

1. **Update the frontend code** in `src/components/RecordingButton.tsx`:
   ```typescript
   const apiUrl = process.env.NODE_ENV === 'production' 
     ? 'https://your-deployed-url.com/api/record'  // Update this
     : 'http://localhost:5000/api/record';
   ```

2. **Test the deployment**:
   - Visit your app at `/recording`
   - Try creating a recording
   - Check that the video is generated and accessible

## Troubleshooting

- If Puppeteer fails to launch, increase memory allocation (at least 1GB recommended)
- If recordings are not saving, check disk permissions
- For performance issues, upgrade the plan to provide more CPU resources 