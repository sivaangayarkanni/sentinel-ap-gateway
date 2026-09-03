const jwt = require('jsonwebtoken');
const config = require('../config');
const { getAgentStatus } = require('../services/agentRegistry');

async function requireAgentAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      status: 'BLOCKED',
      error: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, {
      issuer: config.auth.jwtIssuer,
      audience: config.auth.jwtAudience,
    });
  } catch (e) {
    return res.status(401).json({ status: 'BLOCKED', error: 'INVALID_TOKEN', message: e.message });
  }

  const agentStatus = await getAgentStatus(payload.sub);
  if (!agentStatus || agentStatus.status !== 'ACTIVE') {
    return res.status(403).json({ status: 'BLOCKED', error: 'AGENT_REVOKED', message: `Agent '${payload.sub}' is not active.` });
  }

  req.agent = { agentId: payload.sub, scope: payload.scope };
  next();
}

module.exports = { requireAgentAuth };
