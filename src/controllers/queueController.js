const queueService = require('../services/queueService');
const tokenService = require('../services/tokenService');

class QueueController {
  async joinQueue(req, res, next) {
    try {
      const { userId, email, metadata } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }
      
      // Check if already in queue or active
      const currentStatus = await queueService.getQueueStatus(userId);
      if (currentStatus.status === 'waiting') {
        return res.json({
          success: true,
          data: currentStatus
        });
      }
      
      if (currentStatus.status === 'active') {
        const accessToken = tokenService.generateAccessToken(userId);
        return res.json({
          success: true,
          data: {
            status: 'active',
            accessToken,
            canAccess: true
          }
        });
      }
      
      // Add to queue
      const queueData = await queueService.addToQueue(userId, { email, metadata });
      
      // Notify via WebSocket
      const io = req.app.get('io');
      io.to(`user-${userId}`).emit('queue-joined', queueData);
      
      // Try to process queue immediately
      const processedUsers = await queueService.processQueue();
      
      // Notify processed users
      for (const processedUserId of processedUsers) {
        const accessToken = tokenService.generateAccessToken(processedUserId);
        io.to(`user-${processedUserId}`).emit('queue-ready', {
          accessToken,
          message: 'You can now access the service'
        });
      }
      
      res.status(201).json({
        success: true,
        data: queueData
      });
    } catch (error) {
      next(error);
    }
  }

  async getQueueStatus(req, res, next) {
    try {
      const { userId } = req.params;
      
      const status = await queueService.getQueueStatus(userId);
      
      if (status.status === 'not_in_queue') {
        return res.status(404).json({
          success: false,
          error: 'User not found in queue'
        });
      }
      
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyAccess(req, res, next) {
    try {
      // Token is already verified by auth middleware
      const { userId } = req.user;
      
      const status = await queueService.getQueueStatus(userId);
      
      res.json({
        success: true,
        data: {
          valid: status.status === 'active',
          userId,
          status: status.status
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getQueueInfo(req, res, next) {
    try {
      const info = await queueService.getQueueInfo();
      
      res.json({
        success: true,
        data: info
      });
    } catch (error) {
      next(error);
    }
  }

  async clearQueue(req, res, next) {
    try {
      // In production, add proper authentication/authorization
      const result = await queueService.clearQueue();
      
      // Notify all connected clients
      const io = req.app.get('io');
      io.emit('queue-cleared', {
        message: 'Queue has been cleared'
      });
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  async leaveQueue(req, res, next) {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }
      
      const result = await queueService.removeFromQueue(userId);
      
      // Notify via WebSocket
      const io = req.app.get('io');
      io.to(`user-${userId}`).emit('queue-left', {
        message: 'You have left the queue',
        timestamp: new Date().toISOString()
      });
      
      // Update queue positions for remaining users
      const queueProcessor = require('../utils/queueProcessor');
      const processor = new queueProcessor(io);
      await processor.updateQueuePositions();
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new QueueController();