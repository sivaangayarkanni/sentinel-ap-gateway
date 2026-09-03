const { redis } = require('../services/redisClient');

function rateLimit({ windowSeconds = 60, max = 30, prefix = 'rl', keyFn }) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const id = keyFn ? keyFn(req) : (req.ip || req.socket.remoteAddress || 'unknown');
      const key = `sentinel:${prefix}:${id}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSeconds);
      if (n > max) {
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many requests. Max ${max} per ${windowSeconds}s.`,
        });
      }
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - n)));
      next();
    } catch (e) {
      next();
    }
  };
}

module.exports = { rateLimit };
