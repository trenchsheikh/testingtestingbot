# 🚀 AsterDex Telegram Bot - Deployment Guide

This guide will walk you through deploying your AsterDex Telegram bot to production on various platforms.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Platform-Specific Deployment](#platform-specific-deployment)
4. [Post-Deployment Configuration](#post-deployment-configuration)
5. [Monitoring & Maintenance](#monitoring--maintenance)
6. [Troubleshooting](#troubleshooting)
7. [Security Checklist](#security-checklist)

## 🔧 Prerequisites

### Required Accounts & Services
- **Telegram Bot Token** (from @BotFather)
- **MongoDB Atlas Account** (or self-hosted MongoDB)
- **Deployment Platform Account** (Render, Railway, Heroku, etc.)
- **GitHub Account** (for code repository)

### System Requirements
- **Node.js** v18.x or later
- **npm** v8.x or later
- **Git** for version control

## ⚙️ Environment Setup

### 1. Create Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# MongoDB Configuration
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority&appName=YourApp
DB_NAME=asteroid_bot

# Encryption Key (Generate a secure random string)
ENCRYPTION_KEY=your_32_character_encryption_key_here

# BSC RPC Configuration
BSC_RPC_URL=https://bsc-dataseed.binance.org/

# Optional: Redis for caching (if using)
REDIS_URL=redis://your-redis-url:6379
```

### 2. Generate Secure Encryption Key

```bash
# Generate a secure 32-character encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. MongoDB Setup

#### Option A: MongoDB Atlas (Recommended)
1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a new cluster
3. Create a database user
4. Whitelist your deployment platform's IP (or use 0.0.0.0/0 for all IPs)
5. Get your connection string

#### Option B: Self-hosted MongoDB
1. Install MongoDB on your server
2. Configure authentication
3. Set up SSL/TLS certificates

## 🌐 Platform-Specific Deployment

### Option 1: Render (Recommended for Beginners)

#### Step 1: Prepare Repository
```bash
# Initialize git repository
git init
git add .
git commit -m "Initial commit"

# Create GitHub repository and push
git remote add origin https://github.com/yourusername/asteroid-bot.git
git push -u origin main
```

#### Step 2: Deploy on Render
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure deployment:
   - **Name**: `asteroid-telegram-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Starter` (free tier available)

#### Step 3: Environment Variables
In Render dashboard, go to your service → Environment:
- Add all variables from your `.env` file
- **Important**: Replace `your_telegram_bot_token_here` with actual token
- **Important**: Replace MongoDB URI with actual credentials

#### Step 4: Deploy
- Click "Create Web Service"
- Wait for deployment to complete
- Check logs for any errors

### Option 2: Railway

#### Step 1: Install Railway CLI
```bash
npm install -g @railway/cli
```

#### Step 2: Deploy
```bash
# Login to Railway
railway login

# Initialize project
railway init

# Add environment variables
railway variables set TELEGRAM_BOT_TOKEN=your_token_here
railway variables set MONGO_URI=your_mongodb_uri_here
railway variables set DB_NAME=asteroid_bot
railway variables set ENCRYPTION_KEY=your_encryption_key_here
railway variables set BSC_RPC_URL=https://bsc-dataseed.binance.org/

# Deploy
railway up
```

### Option 3: Heroku

#### Step 1: Install Heroku CLI
```bash
# Download from https://devcenter.heroku.com/articles/heroku-cli
```

#### Step 2: Deploy
```bash
# Login to Heroku
heroku login

# Create Heroku app
heroku create your-bot-name

# Set environment variables
heroku config:set TELEGRAM_BOT_TOKEN=your_token_here
heroku config:set MONGO_URI=your_mongodb_uri_here
heroku config:set DB_NAME=asteroid_bot
heroku config:set ENCRYPTION_KEY=your_encryption_key_here
heroku config:set BSC_RPC_URL=https://bsc-dataseed.binance.org/

# Deploy
git push heroku main
```

### Option 4: VPS/Cloud Server

#### Step 1: Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Install MongoDB (if self-hosting)
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
```

#### Step 2: Deploy Application
```bash
# Clone repository
git clone https://github.com/yourusername/asteroid-bot.git
cd asteroid-bot

# Install dependencies
npm install

# Create .env file
nano .env
# Add your environment variables

# Start with PM2
pm2 start src/index.js --name "asteroid-bot"
pm2 save
pm2 startup
```

## 🔧 Post-Deployment Configuration

### 1. Verify Deployment
```bash
# Check if bot is running
curl https://your-app-url.com

# Should return: "Bot is running"
```

### 2. Test Bot Functionality
1. Open Telegram and find your bot
2. Send `/start` command
3. Verify wallet creation
4. Test balance checking
5. Test trading functionality

### 3. Set Up Monitoring

#### Health Check Endpoint
Your bot includes a health check at the root URL:
- **URL**: `https://your-app-url.com`
- **Expected Response**: "Bot is running"

#### Log Monitoring
```bash
# For PM2 deployments
pm2 logs asteroid-bot

# For Render/Heroku
# Check logs in dashboard
```

## 📊 Monitoring & Maintenance

### 1. Performance Monitoring

#### Memory Usage
The bot includes built-in memory monitoring:
- Logs memory usage every 30 seconds
- Automatic cleanup of rate limiting data
- Graceful shutdown on memory issues

#### Error Tracking
- All errors are logged with timestamps
- User-friendly error messages
- Stack traces for debugging

### 2. Regular Maintenance

#### Database Cleanup
```javascript
// Optional: Add periodic cleanup of old sessions
// Add this to your database.js file
export async function cleanupOldSessions() {
  const database = await connectToDatabase();
  const users = database.collection('users');
  
  // Remove sessions older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await users.deleteMany({ 
    lastActivity: { $lt: thirtyDaysAgo } 
  });
}
```

#### Log Rotation
```bash
# For PM2 deployments
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 3. Backup Strategy

#### Database Backups
```bash
# MongoDB Atlas provides automatic backups
# For self-hosted MongoDB:
mongodump --uri="mongodb://username:password@host:port/database" --out=backup/
```

#### Code Backups
- Use Git for version control
- Tag stable releases
- Keep deployment scripts in repository

## 🚨 Troubleshooting

### Common Issues

#### 1. Bot Not Responding
```bash
# Check if process is running
pm2 status

# Check logs
pm2 logs asteroid-bot

# Restart if needed
pm2 restart asteroid-bot
```

#### 2. Database Connection Issues
```bash
# Test MongoDB connection
node -e "import('./src/database.js').then(() => console.log('DB OK')).catch(console.error)"

# Check MongoDB URI format
echo $MONGO_URI
```

#### 3. Memory Issues
```bash
# Check memory usage
pm2 monit

# Restart if memory is high
pm2 restart asteroid-bot
```

#### 4. API Rate Limiting
- Check if you're hitting API rate limits
- Implement exponential backoff
- Monitor API response times

### Debug Mode
```bash
# Enable debug logging
export DEBUG=*
npm start
```

## 🔒 Security Checklist

### Pre-Deployment
- [ ] All environment variables are set
- [ ] MongoDB password is secure and not in code
- [ ] Encryption key is randomly generated
- [ ] API keys are properly encrypted
- [ ] Rate limiting is enabled
- [ ] Input validation is in place

### Post-Deployment
- [ ] Bot responds to commands
- [ ] Database connection is working
- [ ] Error handling is functioning
- [ ] Memory usage is stable
- [ ] Logs are being generated
- [ ] Health check endpoint is accessible

### Ongoing Security
- [ ] Regular security updates
- [ ] Monitor for unusual activity
- [ ] Backup data regularly
- [ ] Review logs for errors
- [ ] Update dependencies regularly

## 📞 Support & Resources

### Documentation
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

### Monitoring Tools
- **Uptime Monitoring**: UptimeRobot, Pingdom
- **Error Tracking**: Sentry, Bugsnag
- **Performance**: New Relic, DataDog

### Community
- [Telegram Bot Development](https://t.me/BotSupport)
- [MongoDB Community](https://community.mongodb.com/)

## 🎯 Production Checklist

Before going live, ensure:

- [ ] All environment variables are configured
- [ ] MongoDB connection is working
- [ ] Bot token is valid and active
- [ ] All features are tested
- [ ] Error handling is comprehensive
- [ ] Monitoring is set up
- [ ] Backup strategy is in place
- [ ] Security measures are implemented
- [ ] Documentation is complete
- [ ] Support plan is ready

---

## 🚀 Quick Start Commands

```bash
# Clone and setup
git clone https://github.com/yourusername/asteroid-bot.git
cd asteroid-bot
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Test locally
npm start

# Deploy to Render
# 1. Push to GitHub
# 2. Connect to Render
# 3. Set environment variables
# 4. Deploy

# Deploy to Railway
railway login
railway init
railway variables set TELEGRAM_BOT_TOKEN=your_token
railway up

# Deploy to VPS
pm2 start src/index.js --name "asteroid-bot"
pm2 save
pm2 startup
```

---

**🎉 Congratulations! Your AsterDex Telegram bot is now ready for production deployment!**

For additional support or questions, please refer to the troubleshooting section or create an issue in the repository.
