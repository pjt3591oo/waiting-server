module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: '24h'
  },
  queue: {
    maxConcurrentUsers: parseInt(process.env.MAX_CONCURRENT_USERS) || 2,
    timeoutMinutes: parseInt(process.env.QUEUE_TIMEOUT_MINUTES) || 30,
    estimatedServiceTimeSeconds: 180, // 3 minutes average per user
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  }
};