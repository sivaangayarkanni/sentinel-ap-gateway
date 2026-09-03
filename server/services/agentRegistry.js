const crypto = require('crypto');
const { redis } = require('./redisClient');

const KEY_PREFIX = 'sentinel:agent:';

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function generateClientSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

async function registerAgent(agentId, { scopes = ['transaction:intent'] } = {}) {
  const key = KEY_PREFIX + agentId;
  const exists = await redis.exists(key);
  if (exists) {
    const err = new Error(`Agent '${agentId}' is already registered.`);
    err.code = 'AGENT_EXISTS';
    throw err;
  }

  const clientSecret = generateClientSecret();
  await redis.hset(key, {
    secretHash: hashSecret(clientSecret),
    scopes: JSON.stringify(scopes),
    createdAt: new Date().toISOString(),
    status: 'ACTIVE',
  });

  return { agentId, clientSecret, scopes };
}

async function revokeAgent(agentId) {
  const key = KEY_PREFIX + agentId;
  const exists = await redis.exists(key);
  if (!exists) return false;
  await redis.hset(key, 'status', 'REVOKED');
  return true;
}

async function verifyCredentials(agentId, clientSecret) {
  const key = KEY_PREFIX + agentId;
  const record = await redis.hgetall(key);
  if (!record || !record.secretHash) return null;
  if (record.status !== 'ACTIVE') return null;

  const providedHash = hashSecret(clientSecret);
  const a = Buffer.from(providedHash);
  const b = Buffer.from(record.secretHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { agentId, scopes: JSON.parse(record.scopes || '[]'), status: record.status };
}

async function getAgentStatus(agentId) {
  const key = KEY_PREFIX + agentId;
  const record = await redis.hgetall(key);
  if (!record || !record.status) return null;
  return { agentId, status: record.status, scopes: JSON.parse(record.scopes || '[]'), createdAt: record.createdAt };
}

module.exports = { registerAgent, revokeAgent, verifyCredentials, getAgentStatus };
