const { v4: uuidv4 } = require('uuid');

const QUEUE_KEY = 'waiting:queue';
const ACTIVE_USERS_KEY = 'active:users';
const USER_DATA_PREFIX = 'user:data:';

class QueueService {
  constructor(redisClient, config) {
    this.redisClient = redisClient;
    this.config = config;
  }

  async addToQueue(userId, userData) {
    const timestamp = Date.now();
    const queueToken = uuidv4();
    
    // Store user data
    await this.redisClient.hSet(`${USER_DATA_PREFIX}${userId}`, 
      'userId', userId,
      'queueToken', queueToken,
      'joinedAt', timestamp.toString(),
      'email', userData.email || '',
      'metadata', JSON.stringify(userData.metadata || {})
    );
    
    // Set expiration for user data
    await this.redisClient.expire(`${USER_DATA_PREFIX}${userId}`, this.config.queue.timeoutMinutes * 60);
    
    // Add to queue (sorted set with timestamp as score)
    await this.redisClient.zAdd(QUEUE_KEY, {
      score: timestamp,
      value: userId
    });
    
    // Get position in queue
    const position = await this.getQueuePosition(userId);
    
    return {
      userId,
      queueToken,
      position,
      estimatedWaitTime: this.calculateWaitTime(position)
    };
  }

  async getQueuePosition(userId) {
    const rank = await this.redisClient.zRank(QUEUE_KEY, userId);
    return rank !== null ? rank + 1 : null;
  }

  async getQueueStatus(userId) {
    const position = await this.getQueuePosition(userId);
    if (position === null) {
      // Check if user is already active
      const isActive = await this.redisClient.sIsMember(ACTIVE_USERS_KEY, userId);
      if (isActive) {
        return { status: 'active', canAccess: true };
      }
      return { status: 'not_in_queue', canAccess: false };
    }

    const totalInQueue = await this.redisClient.zCard(QUEUE_KEY);
    const activeUsers = await this.redisClient.sCard(ACTIVE_USERS_KEY);
    
    return {
      status: 'waiting',
      position,
      totalInQueue,
      activeUsers,
      estimatedWaitTime: this.calculateWaitTime(position),
      canAccess: false
    };
  }

  async processQueue() {
    const activeUsers = await this.redisClient.sCard(ACTIVE_USERS_KEY);
    const availableSlots = this.config.queue.maxConcurrentUsers - activeUsers;
    
    if (availableSlots <= 0) return [];
    
    // Get users from front of queue
    const nextUsers = await this.redisClient.zRange(QUEUE_KEY, 0, availableSlots - 1);
    const processedUsers = [];
    
    for (const userId of nextUsers) {
      // Remove from queue
      await this.redisClient.zRem(QUEUE_KEY, userId);
      
      // Add to active users
      await this.redisClient.sAdd(ACTIVE_USERS_KEY, userId);
      
      // Set expiration for active status
      await this.redisClient.expire(`active:${userId}`, this.config.queue.timeoutMinutes * 60);
      
      processedUsers.push(userId);
    }
    
    return processedUsers;
  }

  async removeFromActive(userId) {
    await this.redisClient.sRem(ACTIVE_USERS_KEY, userId);
    await this.redisClient.del(`${USER_DATA_PREFIX}${userId}`);
  }

  async removeFromQueue(userId) {
    // Remove from waiting queue
    const removed = await this.redisClient.zRem(QUEUE_KEY, userId);
    
    // Remove user data
    await this.redisClient.del(`${USER_DATA_PREFIX}${userId}`);
    
    // Also check if user is in active users and remove
    await this.redisClient.sRem(ACTIVE_USERS_KEY, userId);
    
    return {
      removed: removed > 0,
      message: removed > 0 ? 'Successfully left the queue' : 'User not found in queue'
    };
  }

  async getQueueInfo() {
    const queueLength = await this.redisClient.zCard(QUEUE_KEY);
    const activeUsers = await this.redisClient.sCard(ACTIVE_USERS_KEY);
    const queueMembers = await this.redisClient.zRangeWithScores(QUEUE_KEY, 0, 9);
    
    return {
      queueLength,
      activeUsers,
      maxConcurrentUsers: this.config.queue.maxConcurrentUsers,
      availableSlots: this.config.queue.maxConcurrentUsers - activeUsers,
      nextInQueue: queueMembers.map((member, index) => ({
        userId: member.value,
        position: index + 1,
        joinedAt: new Date(member.score).toISOString(),
        estimatedWaitTime: this.calculateWaitTime(index + 1)
      }))
    };
  }

  async clearQueue() {
    await this.redisClient.del(QUEUE_KEY);
    await this.redisClient.del(ACTIVE_USERS_KEY);
    
    // Clear all user data
    const keys = await this.redisClient.keys(`${USER_DATA_PREFIX}*`);
    if (keys.length > 0) {
      await this.redisClient.del(keys);
    }
    
    return { message: 'Queue cleared successfully' };
  }

  calculateWaitTime(position) {
    if (!position) return 0;
    
    // Calculate based on average service time and concurrent users
    const batchPosition = Math.ceil(position / this.config.queue.maxConcurrentUsers);
    const estimatedSeconds = batchPosition * this.config.queue.estimatedServiceTimeSeconds;
    
    return {
      seconds: estimatedSeconds,
      minutes: Math.ceil(estimatedSeconds / 60),
      formatted: this.formatWaitTime(estimatedSeconds)
    };
  }

  formatWaitTime(seconds) {
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} hours ${remainingMinutes} minutes`;
  }
}

module.exports = QueueService;