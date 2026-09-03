const Redis = require('ioredis');
const config = require('../config');
const logger = require('../logger');

const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
});

redis.on('error', (err) => logger.error('Redis connection error:', err.message));
redis.on('connect', () => logger.info(`Connected to Redis at ${config.redis.url}`));

async function assertRedisReady() {
  await redis.ping();
}

module.exports = { redis, assertRedisReady };
