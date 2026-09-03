const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { registerAgent, revokeAgent, verifyCredentials, getAgentStatus } = require('../services/agentRegistry');
const logger = require('../logger');
const { requireAdmin } = require('../middleware/adminAuth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/v1/agents/register', requireAdmin, async (req, res) => {
  const { agent_id, scopes } = req.body || {};
  if (!agent_id) return res.status(400).json({ error: 'INVALID_REQUEST', message: "'agent_id' is required." });

  try {
    const result = await registerAgent(agent_id, { scopes });
    logger.info(`Registered new agent: ${agent_id}`);
    res.status(201).json({
      agent_id: result.agentId,
      client_secret: result.clientSecret,
      scopes: result.scopes,
      warning: 'Store this client_secret now — it will not be shown again.',
    });
  } catch (e) {
    if (e.code === 'AGENT_EXISTS') return res.status(409).json({ error: 'AGENT_EXISTS', message: e.message });
    logger.error('Agent registration failed:', e);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: e.message });
  }
});

router.post('/v1/agents/:agentId/revoke', requireAdmin, async (req, res) => {
  const ok = await revokeAgent(req.params.agentId);
  if (!ok) return res.status(404).json({ error: 'NOT_FOUND', message: 'Agent not found.' });
  res.json({ agent_id: req.params.agentId, status: 'REVOKED' });
});

router.get('/v1/agents/:agentId', requireAdmin, async (req, res) => {
  const status = await getAgentStatus(req.params.agentId);
  if (!status) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(status);
});

router.post('/v1/auth/token', rateLimit({
  windowSeconds: 60,
  max: 20,
  prefix: 'rl:token',
  keyFn: (req) => `${req.ip}:${(req.body && req.body.agent_id) || 'na'}`,
}), async (req, res) => {
  const { agent_id, client_secret } = req.body || {};
  if (!agent_id || !client_secret) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: "'agent_id' and 'client_secret' are required." });
  }

  const agent = await verifyCredentials(agent_id, client_secret);
  if (!agent) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Agent not found, revoked, or secret incorrect.' });
  }

  const jti = uuidv4();
  const token = jwt.sign(
    { sub: agent.agentId, scope: agent.scopes.join(' ') },
    config.auth.jwtSecret,
    {
      issuer: config.auth.jwtIssuer,
      audience: config.auth.jwtAudience,
      expiresIn: config.auth.tokenTtlSeconds,
      jwtid: jti,
    }
  );

  res.json({ access_token: token, token_type: 'Bearer', expires_in: config.auth.tokenTtlSeconds });
});

module.exports = router;
