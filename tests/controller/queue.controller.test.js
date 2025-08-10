import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import QueueController from '../../src/controllers/queueController';
import QueueService from '../../src/services/queueService';
import TokenService from '../../src/services/tokenService';
import QueueProcessor from '../../src/utils/queueProcessor';
import RedisTestHelper from '../helpers/redis-container';

describe('QueueController', () => {
  let queueController;
  let queueService;
  let tokenService;
  let queueProcessor;
  let redisHelper;
  let redisClient;
  let req, res, next;
  let mockIo;

  const mockConfig = {
    jwt: {
      secret: 'test-secret-key',
      expiresIn: '24h'
    },
    queue: {
      maxConcurrentUsers: 2,
      timeoutMinutes: 30,
      estimatedServiceTimeSeconds: 180
    }
  };

  beforeAll(async () => {
    console.log('beforeAll')
    // Start Redis container
    redisHelper = new RedisTestHelper();
    redisClient = await redisHelper.start();
  });

  afterAll(async () => {
    await redisHelper.stop();
  });

  beforeEach(async () => {
    console.log('beforeEach')
    
    // Clear Redis data
    await redisHelper.cleanup();

    // Mock Socket.io
    mockIo = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn()
    };

    // Create real service instances with test Redis
    queueService = new QueueService(redisClient, mockConfig);
    tokenService = new TokenService(mockConfig);
    queueProcessor = new QueueProcessor(mockIo, queueService, tokenService);

    // Create controller instance with real services
    queueController = new QueueController(queueService, tokenService, queueProcessor);

    // Mock Express request, response, and next
    req = {
      body: {},
      params: {},
      user: {},
      app: {
        get: vi.fn().mockReturnValue(mockIo)
      }
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      send: vi.fn()
    };

    next = vi.fn();
  });

  describe('joinQueue', () => {
    it('should return 400 if userId is missing', async () => {
      req.body = { email: 'test@example.com' };

      await queueController.joinQueue(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'userId is required'
      });
    });

    it('should return current status if user is already waiting', async () => {
      // Try to join again
      req.body = { userId: 'user123' };
      await queueController.joinQueue(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          status: 'active',
          canAccess: true
        })
      });
    });


    it('should emit queue-joined event via WebSocket', async () => {
      req.body = { userId: 'user123' };

      await queueController.joinQueue(req, res, next);

      expect(mockIo.to).toHaveBeenCalledWith('user-user123');
      expect(mockIo.emit).toHaveBeenCalledWith('queue-joined', expect.objectContaining({
        userId: 'user123',
        position: 1,
        queueToken: expect.any(String)
      }));
    });

    it('should notify processed users after queue processing', async () => {
      // Fill up active slots first (max 2)
      await redisClient.sAdd('active:users', 'active1');
      
      // Add users to queue
      await queueService.addToQueue('user456', {});
      await queueService.addToQueue('user789', {});
      
      // Now add another user which should trigger processing
      req.body = { userId: 'user123' };
      await queueController.joinQueue(req, res, next);

      // Since we have maxConcurrentUsers=2 and only 1 active, user456 should be processed
      expect(mockIo.to).toHaveBeenCalledWith('user-user456');
      expect(mockIo.emit).toHaveBeenCalledWith('queue-ready', expect.objectContaining({
        accessToken: expect.any(String),
        message: 'You can now access the service'
      }));
      
      // Verify user456 is now active
      const isActive = await redisClient.sIsMember('active:users', 'user456');
      expect(isActive).toBe(true);
    });

    it('should handle errors properly', async () => {
      // Force an error by closing Redis connection
      await redisClient.quit();
      
      req.body = { userId: 'user123' };
      await queueController.joinQueue(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      
      // Reconnect for other tests
      await redisClient.connect();
    });

    it('should return waiting status for new user', async () => {
      req.body = { userId: 'user123' };
      await queueController.joinQueue(req, res, next);
      
      req.body = { userId: 'user234' };
      await queueController.joinQueue(req, res, next);
      
      req.body = { userId: 'user345' };
      await queueController.joinQueue(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          status: 'waiting',
          position: 1,
          canAccess: false,
          estimatedWaitTime: expect.objectContaining({
            minutes: 3
          })
        })
      });
    });
  });

  describe('getQueueStatus', () => {
    it('should return 404 for user not in queue', async () => {
      req.params = { userId: 'user123' };

      await queueController.getQueueStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'User not found in queue'
      });
    });

    it('should return status for waiting user', async () => {
      // Add user to queue
      await queueService.addToQueue('user123', {});
      
      req.params = { userId: 'user123' };
      await queueController.getQueueStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          status: 'waiting',
          position: 1,
          canAccess: false,
          estimatedWaitTime: expect.objectContaining({
            minutes: 3
          })
        })
      });
    });

    it('should return status for active user', async () => {
      // Add user to active set
      await redisClient.sAdd('active:users', 'user123');
      
      req.params = { userId: 'user123' };
      await queueController.getQueueStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          status: 'active',
          canAccess: true
        })
      });
    });

    it('should handle errors properly', async () => {
      await redisClient.quit();
      
      req.params = { userId: 'user123' };
      await queueController.getQueueStatus(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      
      await redisClient.connect();
    });
  });

  describe('verifyAccess', () => {
    it('should return valid true for active user', async () => {
      // Add user to active set
      await redisClient.sAdd('active:users', 'user123');
      
      req.user = { userId: 'user123' };
      await queueController.verifyAccess(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          valid: true,
          userId: 'user123',
          status: 'active'
        }
      });
    });

    it('should return valid false for non-active user', async () => {
      // Add user to queue (waiting status)
      await queueService.addToQueue('user123', {});
      
      req.user = { userId: 'user123' };
      await queueController.verifyAccess(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          valid: false,
          userId: 'user123',
          status: 'waiting'
        }
      });
    });

    it('should handle errors properly', async () => {
      await redisClient.quit();
      
      req.user = { userId: 'user123' };
      await queueController.verifyAccess(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      
      await redisClient.connect();
    });
  });

  describe('getQueueInfo', () => {
    it('should return queue info successfully', async () => {
      // Setup some queue state
      await queueService.addToQueue('user1', {});
      await queueService.addToQueue('user2', {});
      await redisClient.sAdd('active:users', 'active1');

      await queueController.getQueueInfo(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          queueLength: 2,
          activeUsers: 1,
          maxConcurrentUsers: 2,
          availableSlots: 1,
          nextInQueue: expect.arrayContaining([
            expect.objectContaining({ userId: 'user1', position: 1 }),
            expect.objectContaining({ userId: 'user2', position: 2 })
          ])
        })
      });
    });

    it('should handle errors properly', async () => {
      await redisClient.quit();

      await queueController.getQueueInfo(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      
      await redisClient.connect();
    });
  });

  describe('clearQueue', () => {
    it('should clear queue successfully', async () => {
      // Add some data to clear
      await queueService.addToQueue('user1', {});
      await queueService.addToQueue('user2', {});
      await redisClient.sAdd('active:users', 'active1');

      await queueController.clearQueue(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          message: 'Queue cleared successfully'
        })
      });
      
      // Verify everything is cleared
      const queueLength = await redisClient.zCard('waiting:queue');
      const activeUsers = await redisClient.sCard('active:users');
      expect(queueLength).toBe(0);
      expect(activeUsers).toBe(0);
    });

    it('should emit queue-cleared event', async () => {
      await queueController.clearQueue(req, res, next);

      expect(mockIo.emit).toHaveBeenCalledWith('queue-cleared', {
        message: 'Queue has been cleared'
      });
    });

    it('should handle errors properly', async () => {
      await redisClient.quit();

      await queueController.clearQueue(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      
      await redisClient.connect();
    });
  });

  describe('leaveQueue', () => {
    it('should return 400 if userId is missing', async () => {
      req.params = {};

      await queueController.leaveQueue(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'userId is required'
      });
    });

    it('should remove user from queue successfully', async () => {
      // Add user to queue first
      await queueService.addToQueue('user123', {});
      
      req.params = { userId: 'user123' };
      await queueController.leaveQueue(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          removed: true,
          message: expect.stringContaining('Successfully')
        })
      });
      
      // Verify user is removed from queue
      const position = await queueService.getQueuePosition('user123');
      expect(position).toBeNull();
    });

    it('should emit queue-left event', async () => {
      await queueService.addToQueue('user123', {});
      
      req.params = { userId: 'user123' };
      await queueController.leaveQueue(req, res, next);

      expect(mockIo.to).toHaveBeenCalledWith('user-user123');
      expect(mockIo.emit).toHaveBeenCalledWith('queue-left', {
        message: 'You have left the queue',
        timestamp: expect.any(String)
      });
    });

    it('should update queue positions when queueProcessor exists', async () => {
      await queueService.addToQueue('user123', {});
      await queueService.addToQueue('user456', {});
      
      // Spy on updateQueuePositions
      const updateSpy = vi.spyOn(queueProcessor, 'updateQueuePositions');
      
      req.params = { userId: 'user123' };
      await queueController.leaveQueue(req, res, next);

      expect(updateSpy).toHaveBeenCalled();
    });

    it('should handle missing queueProcessor gracefully', async () => {
      // Create controller without queueProcessor
      const controllerWithoutProcessor = new QueueController(queueService, tokenService, null);
      await queueService.addToQueue('user123', {});
      
      req.params = { userId: 'user123' };
      await controllerWithoutProcessor.leaveQueue(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          removed: true
        })
      });
    });

    it('should handle errors properly', async () => {
      await redisClient.quit();
      
      req.params = { userId: 'user123' };
      await queueController.leaveQueue(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      
      await redisClient.connect();
    });
  });
});