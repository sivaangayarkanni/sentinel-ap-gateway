const config = require('../config');
const logger = require('../logger');
const { redis } = require('../services/redisClient');
const razorpay = require('../services/razorpay');
const ws = require('../ws');

const EVENTS_KEY = 'sentinel:health:events';

async function recordHealthEvent(success, latencyMs, source) {
  const now = Date.now();
  const member = JSON.stringify({ ts: now, success, latencyMs, source, nonce: Math.random().toString(36).slice(2) });
  await redis.zadd(EVENTS_KEY, now, member);
  const cutoff = now - config.network.healthWindowSeconds * 1000;
  await redis.zremrangebyscore(EVENTS_KEY, 0, cutoff);
}

async function getRollingWindow() {
  const cutoff = Date.now() - config.network.healthWindowSeconds * 1000;
  const raw = await redis.zrangebyscore(EVENTS_KEY, cutoff, '+inf');
  return raw.map((s) => JSON.parse(s));
}

async function getCurrentHealth() {
  const events = await getRollingWindow();
  if (events.length === 0) {
    return { successRate: null, avgLatencyMs: null, sampleSize: 0, status: 'UNKNOWN' };
  }
  const successes = events.filter((e) => e.success).length;
  const successRate = successes / events.length;
  const avgLatencyMs = events.reduce((sum, e) => sum + e.latencyMs, 0) / events.length;
  return { successRate, avgLatencyMs, sampleSize: events.length, status: 'MEASURED' };
}

async function evaluateGate2() {
  const health = await getCurrentHealth();
  if (health.status === 'UNKNOWN') {
    return {
      status: 'FAILED',
      telemetry: health,
      reason: 'No health telemetry collected yet — background prober has not completed its first cycle.',
    };
  }
  const reasons = [];
  const healthOk = health.successRate >= config.network.upiHealthThreshold;
  if (!healthOk) {
    reasons.push(`Real measured success rate ${(health.successRate * 100).toFixed(1)}% (n=${health.sampleSize}) is below the required ${(config.network.upiHealthThreshold * 100).toFixed(0)}% threshold.`);
  }
  const latencyOk = health.avgLatencyMs <= config.network.maxAcceptableLatencyMs;
  if (!latencyOk) {
    reasons.push(`Real measured avg latency ${health.avgLatencyMs.toFixed(0)}ms exceeds the ${config.network.maxAcceptableLatencyMs}ms congestion threshold.`);
  }
  const status = healthOk && latencyOk ? 'PASSED' : 'FAILED';
  return {
    status,
    telemetry: {
      successRate: Number(health.successRate.toFixed(4)),
      avgLatencyMs: Number(health.avgLatencyMs.toFixed(0)),
      sampleSize: health.sampleSize,
      windowSeconds: config.network.healthWindowSeconds,
    },
    reason: status === 'PASSED' ? 'Payment rail is healthy (measured).' : reasons.join(' '),
  };
}

async function recordTransactionOutcome(success, latencyMs) {
  await recordHealthEvent(success, latencyMs, 'transaction');
}

let proberHandle = null;

function startHealthProber() {
  if (proberHandle) return;
  const tick = async () => {
    const result = await razorpay.probeApiHealth();
    await recordHealthEvent(result.success, result.latencyMs, 'probe');
    if (!result.success) logger.warn(`Health probe failed: ${result.error} (${result.latencyMs}ms)`);
    else logger.debug(`Health probe OK — ${result.latencyMs}ms`);
    ws.broadcast({ type: 'health_update', payload: await getCurrentHealth() });
  };
  tick();
  proberHandle = setInterval(tick, config.network.healthProbeIntervalMs);
  logger.info(`Health prober started — probing Razorpay every ${config.network.healthProbeIntervalMs}ms, rolling window ${config.network.healthWindowSeconds}s.`);
}

function stopHealthProber() {
  if (proberHandle) clearInterval(proberHandle);
  proberHandle = null;
}

module.exports = { evaluateGate2, getCurrentHealth, recordTransactionOutcome, startHealthProber, stopHealthProber };
