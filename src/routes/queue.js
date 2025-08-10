const express = require('express');
const queueController = require('../controllers/queueController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Join the queue
router.post('/join', queueController.joinQueue);

// Leave the queue
router.delete('/leave/:userId', queueController.leaveQueue);

// Get queue status
router.get('/status/:userId', queueController.getQueueStatus);

// Verify access token
router.post('/verify', authMiddleware, queueController.verifyAccess);

// Admin endpoints
router.get('/info', queueController.getQueueInfo);
router.post('/clear', queueController.clearQueue);

module.exports = router;