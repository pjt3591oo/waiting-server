const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const config = require('./config');
const redisClient = require('./config/redis');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const QueueProcessor = require('./utils/queueProcessor');
const queueService = require('./services/queueService');
const tokenService = require('./services/tokenService');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  }
});

// Initialize queue processor
const queueProcessor = new QueueProcessor(io);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws://localhost:3000", "http://localhost:3000"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
    },
  },
}));
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

// Socket-User mapping for disconnect handling
const socketUserMap = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-queue', (userId) => {
    socket.join(`user-${userId}`);
    socketUserMap.set(socket.id, userId);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      try {
        console.log(`Processing disconnect for user: ${userId}`);
        
        // Remove from queue/active status
        const result = await queueService.removeFromQueue(userId);
        console.log(`User ${userId} removed from queue:`, result);
        
        // Process queue to fill available slots
        const processedUsers = await queueService.processQueue();
        
        // Notify processed users
        for (const processedUserId of processedUsers) {
          const accessToken = tokenService.generateAccessToken(processedUserId);
          io.to(`user-${processedUserId}`).emit('queue-ready', {
            status: 'active',
            accessToken,
            message: 'You can now access the service',
            timestamp: new Date().toISOString()
          });
        }
        
        // Update queue positions for remaining users
        if (processedUsers.length > 0) {
          const queueInfo = await queueService.getQueueInfo();
          for (const user of queueInfo.nextInQueue) {
            io.to(`user-${user.userId}`).emit('queue-update', {
              position: user.position,
              estimatedWaitTime: user.estimatedWaitTime,
              timestamp: new Date().toISOString()
            });
          }
        }
        
        // Clean up mapping
        socketUserMap.delete(socket.id);
      } catch (error) {
        console.error(`Error handling disconnect for user ${userId}:`, error);
      }
    }
  });
});

// Make io accessible to routes
app.set('io', io);

// Start server
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, async () => {
  console.log(`Waiting queue server running on port ${PORT}`);
  
  // Test Redis connection
  try {
    await redisClient.ping();
    console.log('Redis connected successfully');
    
    // Start queue processor
    queueProcessor.start();
  } catch (error) {
    console.error('Redis connection failed:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Stop queue processor
  queueProcessor.stop();
  
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
  
  await redisClient.quit();
  process.exit(0);
});

module.exports = { app, io };