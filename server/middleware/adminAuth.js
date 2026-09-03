const crypto = require('crypto');
const config = require('../config');

function timingSafeMatch(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!config.auth.adminApiKey) {
    return res.status(500).json({
      error: 'SERVER_MISCONFIGURED',
      message: 'ADMIN_API_KEY is not set on the server.',
    });
  }
  const provided = req.headers['x-admin-key'];
  if (!timingSafeMatch(provided, config.auth.adminApiKey)) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing X-Admin-Key header.' });
  }
  next();
}

module.exports = { requireAdmin, timingSafeMatch };
