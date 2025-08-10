class QueueProcessor {
  constructor(io, queueService, tokenService) {
    this.io = io;
    this.queueService = queueService;
    this.tokenService = tokenService;
    this.processingInterval = null;
  }

  start() {
    // Process queue every 5 seconds
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error) {
        console.error('Queue processing error:', error);
      }
    }, 5000);

    console.log('Queue processor started');
  }

  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('Queue processor stopped');
    }
  }

  async processQueue() {
    const processedUsers = await this.queueService.processQueue();
    
    if (processedUsers.length > 0) {
      console.log(`Processing ${processedUsers.length} users from queue`);
      
      // Notify processed users
      for (const userId of processedUsers) {
        const accessToken = this.tokenService.generateAccessToken(userId);
        
        // Send notification via WebSocket
        this.io.to(`user-${userId}`).emit('queue-ready', {
          status: 'active',
          accessToken,
          message: 'You can now access the service',
          timestamp: new Date().toISOString()
        });
      }
      
      // Update queue positions for remaining users
      await this.updateQueuePositions();
    }
  }

  async updateQueuePositions() {
    const queueInfo = await this.queueService.getQueueInfo();
    
    // Notify each user in queue about their updated position
    for (const user of queueInfo.nextInQueue) {
      this.io.to(`user-${user.userId}`).emit('queue-update', {
        position: user.position,
        estimatedWaitTime: user.estimatedWaitTime,
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = QueueProcessor;