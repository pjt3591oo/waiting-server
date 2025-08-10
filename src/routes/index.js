const express = require('express');
const queueRoutes = require('./queue');

const router = express.Router();

router.use('/queue', queueRoutes);

module.exports = router;