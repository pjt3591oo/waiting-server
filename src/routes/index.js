const express = require('express');

module.exports = (app) => {
  const router = express.Router();
  
  // Import and setup queue routes with app
  const queueRoutes = require('./queue')(app);
  router.use('/queue', queueRoutes);
  
  return router;
};