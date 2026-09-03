const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../logger');
const { redis } = require('./redisClient');

const ITEMS_KEY = 'sentinel:queue:items';
const DUE_KEY = 'sentinel:queue:due';
const POLL_INTERVAL_MS = 1000;

let pollHandle = null;
let deps = null;

function init(dependencies) {
  deps = dependencies;
}

async function hold(intent, gate1Result, gate2Result) {
  const txnId = uuidv4();
  const record = {
    txnId,
    intent,
    attempts: 0,
    lastReason: gate2Result.reason,
    lastTelemetry: gate2Result.telemetry,
    queuedAt: new Date().toISOString(),
    status: 'QUEUED',
  };
  await redis.hset(ITEMS_KEY, txnId, JSON.stringify(record));
  await redis.zadd(DUE_KEY, Date.now() + config.network.backoffBaseMs, txnId);
  await deps.recordOutcome('QUEUE', intent.amount);
  const logEntry = await deps.pushLog({
    type: 'QUEUE',
    intentId: intent.intent_id,
    agentId: intent.agent_id,
    amount: intent.amount,
    message: `Held in Redis retry queue — ${gate2Result.reason}`,
  });
  deps.broadcast?.({ type: 'log', payload: logEntry });
  deps.broadcast?.({ type: 'queue_update' });
  return txnId;
}

async function snapshot() {
  const raw = await redis.hgetall(ITEMS_KEY);
  return Object.values(raw).map((s) => JSON.parse(s));
}

async function _claimDueItems(limit = 10) {
  const now = Date.now();
  const dueTxnIds = await redis.zrangebyscore(DUE_KEY, 0, now, 'LIMIT', 0, limit);
  const claimed = [];
  for (const txnId of dueTxnIds) {
    const removed = await redis.zrem(DUE_KEY, txnId);
    if (removed) claimed.push(txnId);
  }
  return claimed;
}

async function _processItem(txnId) {
  const raw = await redis.hget(ITEMS_KEY, txnId);
  if (!raw) return;
  const record = JSON.parse(raw);
  record.attempts += 1;
  const gate2Result = await deps.evaluateGate2();
  if (gate2Result.status === 'PASSED') {
    const payment = await deps.executePayment(record.intent);
    await deps.recordTransactionOutcome(payment.success, payment.latencyMs);
    if (payment.success) {
      await redis.hdel(ITEMS_KEY, txnId);
      await deps.recordAgentSpend(record.intent.agent_id, record.intent.amount);
      await deps.recordOutcome('EXECUTED', record.intent.amount);
      const logEntry = await deps.pushLog({
        type: 'EXECUTED',
        intentId: record.intent.intent_id,
        agentId: record.intent.agent_id,
        amount: record.intent.amount,
        message: `Queued transaction cleared after ${record.attempts} attempt(s). Order ${payment.orderId}`,
        orderId: payment.orderId,
        paymentLinkUrl: payment.paymentLinkUrl,
      });
      deps.broadcast?.({ type: 'log', payload: logEntry });
      deps.broadcast?.({ type: 'queue_update' });
      deps.broadcast?.({ type: 'stats_update' });
      return;
    }
    record.lastReason = `Razorpay execution failed: ${payment.error}`;
  } else {
    record.lastReason = gate2Result.reason;
    record.lastTelemetry = gate2Result.telemetry;
  }
  if (record.attempts >= config.network.maxRetryAttempts) {
    await redis.hdel(ITEMS_KEY, txnId);
    const logEntry = await deps.pushLog({
      type: 'GIVEN_UP',
      intentId: record.intent.intent_id,
      agentId: record.intent.agent_id,
      amount: record.intent.amount,
      message: `Gave up after ${record.attempts} attempts — ${record.lastReason}`,
    });
    deps.broadcast?.({ type: 'log', payload: logEntry });
    deps.broadcast?.({ type: 'queue_update' });
    return;
  }
  record.status = 'QUEUED';
  await redis.hset(ITEMS_KEY, txnId, JSON.stringify(record));
  const backoffMs = Math.min(config.network.backoffBaseMs * Math.pow(2, record.attempts), 120000);
  await redis.zadd(DUE_KEY, Date.now() + backoffMs, txnId);
  deps.broadcast?.({ type: 'queue_update' });
}

function startQueueWorker() {
  if (pollHandle) return;
  const tick = async () => {
    try {
      const due = await _claimDueItems();
      for (const txnId of due) await _processItem(txnId);
    } catch (e) {
      logger.error('Queue worker tick error:', e.message);
    }
  };
  pollHandle = setInterval(tick, POLL_INTERVAL_MS);
  logger.info(`Redis-backed retry queue worker started (poll every ${POLL_INTERVAL_MS}ms).`);
}

function stopQueueWorker() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

module.exports = { init, hold, snapshot, startQueueWorker, stopQueueWorker };
