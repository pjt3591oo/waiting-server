const redis = require('redis');
const config = require('./index');

const client = redis.createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
  },
  legacyMode: false
});

client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

client.on('connect', () => {
  console.log('Redis Client Connected');
});

// Connect to Redis
(async () => {
  try {
    await client.connect();
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
  }
})();

module.exports = client;