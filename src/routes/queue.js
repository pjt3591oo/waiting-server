const express = require('express');
const QueueController = require('../controllers/queueController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

module.exports = (app) => {
  // Get services from app
  const queueService = app.get('queueService');
  const tokenService = app.get('tokenService');
  const queueProcessor = app.get('queueProcessor');
  
  // Create controller instance
  const queueController = new QueueController(queueService, tokenService, queueProcessor);
  
  // Join the queue
  router.post('/join', queueController.joinQueue.bind(queueController));
  
  // Leave the queue
  router.delete('/leave/:userId', queueController.leaveQueue.bind(queueController));
  
  // Get queue status
  router.get('/status/:userId', queueController.getQueueStatus.bind(queueController));
  
  // Verify access token - need to pass tokenService to middleware
  router.post('/verify', authMiddleware(tokenService), queueController.verifyAccess.bind(queueController));
  
  // Admin endpoints
  router.get('/info', queueController.getQueueInfo.bind(queueController));
  router.post('/clear', queueController.clearQueue.bind(queueController));
  
  return router;
};