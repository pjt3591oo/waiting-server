const { RedisContainer } = require('@testcontainers/redis');
const redis = require('redis');

class RedisTestHelper {
  constructor() {
    this.container = null;
    this.client = null;
  }

  async start() {
    // Start Redis container
    this.container = await new RedisContainer()
      .withExposedPorts(6379)
      .start();

    const host = this.container.getHost();
    const port = this.container.getMappedPort(6379);

    // Create Redis client
    this.client = redis.createClient({
      socket: {
        host,
        port,
      },
      legacyMode: false
    });

    this.client.on('error', (err) => {
      console.error('Redis Test Client Error:', err);
    });

    await this.client.connect();
    
    return this.client;
  }

  async stop() {
    if (this.client) {
      await this.client.quit();
    }
    if (this.container) {
      await this.container.stop();
    }
  }

  async cleanup() {
    if (this.client && this.client.isOpen) {
      await this.client.flushAll();
    }
  }

  getClient() {
    return this.client;
  }

  getConnectionUrl() {
    if (!this.container) {
      throw new Error('Container not started');
    }
    const host = this.container.getHost();
    const port = this.container.getMappedPort(6379);
    return `redis://${host}:${port}`;
  }
}

module.exports = RedisTestHelper;