const { redis } = require('../services/redisClient');

const LOG_KEY = 'sentinel:logs';
const STATS_KEY = 'sentinel:stats';
const LEDGER_PREFIX = 'sentinel:ledger:';
const MAX_LOG_ENTRIES = 500;
const INTENT_PREFIX = 'sentinel:intent:';
const INTENT_TTL = 24 * 3600;

async function pushLog(entry) {
  const record = { ts: new Date().toISOString(), ...entry };
  await redis.lpush(LOG_KEY, JSON.stringify(record));
  await redis.ltrim(LOG_KEY, 0, MAX_LOG_ENTRIES - 1);
  return record;
}

async function getLogs(limit = 50) {
  const raw = await redis.lrange(LOG_KEY, 0, limit - 1);
  return raw.map((s) => JSON.parse(s));
}

async function recordOutcome(outcome, amount) {
  const multi = redis.multi();
  multi.hincrby(STATS_KEY, 'total', 1);
  if (outcome === 'EXECUTED') {
    multi.hincrby(STATS_KEY, 'executed', 1);
    multi.hincrbyfloat(STATS_KEY, 'totalValueExecutedInr', amount);
  } else if (outcome === 'BLOCK_POLICY') {
    multi.hincrby(STATS_KEY, 'blockedPolicy', 1);
    multi.hincrbyfloat(STATS_KEY, 'totalValueProtectedInr', amount);
  } else if (outcome === 'BLOCK_NETWORK') {
    multi.hincrby(STATS_KEY, 'blockedNetwork', 1);
  } else if (outcome === 'QUEUE') {
    multi.hincrby(STATS_KEY, 'queued', 1);
  }
  await multi.exec();
}

async function getStats() {
  const raw = await redis.hgetall(STATS_KEY);
  return {
    total: parseInt(raw.total || '0', 10),
    executed: parseInt(raw.executed || '0', 10),
    blockedPolicy: parseInt(raw.blockedPolicy || '0', 10),
    blockedNetwork: parseInt(raw.blockedNetwork || '0', 10),
    queued: parseInt(raw.queued || '0', 10),
    totalValueProtectedInr: parseFloat(raw.totalValueProtectedInr || '0'),
    totalValueExecutedInr: parseFloat(raw.totalValueExecutedInr || '0'),
  };
}

async function getAgentSpend(agentId, windowStartMs) {
  const key = LEDGER_PREFIX + agentId;
  const entries = await redis.zrangebyscore(key, windowStartMs, '+inf');
  return entries.reduce((sum, e) => sum + parseFloat(e.split(':')[1]), 0);
}

async function recordAgentSpend(agentId, amount) {
  const key = LEDGER_PREFIX + agentId;
  const now = Date.now();
  const member = `${now}:${amount}:${Math.random().toString(36).slice(2)}`;
  await redis.zadd(key, now, member);
  await redis.expire(key, 7 * 24 * 3600);
}

async function claimIntent(intentId) {
  const key = INTENT_PREFIX + intentId;
  const first = await redis.set(key, JSON.stringify({ status: 'PENDING', ts: new Date().toISOString() }), 'EX', INTENT_TTL, 'NX');
  return first === 'OK';
}

async function saveIntentRecord(intentId, record) {
  await redis.set(INTENT_PREFIX + intentId, JSON.stringify(record), 'EX', INTENT_TTL);
}

async function getIntentRecord(intentId) {
  const raw = await redis.get(INTENT_PREFIX + intentId);
  return raw ? JSON.parse(raw) : null;
}

async function releaseIntent(intentId) {
  await redis.del(INTENT_PREFIX + intentId);
}

module.exports = {
  pushLog, getLogs, recordOutcome, getStats, getAgentSpend, recordAgentSpend,
  claimIntent, saveIntentRecord, getIntentRecord, releaseIntent,
};
