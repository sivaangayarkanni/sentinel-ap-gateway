const express = require('express');
const config = require('../config');
const { getStats, getLogs } = require('../data/store');
const queue = require('../services/queue');
const { getCurrentHealth } = require('../gates/networkHealth');

const router = express.Router();

router.get('/v1/dashboard/stats', async (req, res) => {
  const [stats, health] = await Promise.all([getStats(), getCurrentHealth()]);
  res.json({
    stats,
    health,
    config: {
      max_transaction_limit_inr: config.policy.maxTransactionLimitInr,
      rolling_limit_inr: config.policy.rollingLimitInr,
      upi_health_threshold: config.network.upiHealthThreshold,
      max_retry_attempts: config.network.maxRetryAttempts,
      sku_whitelist: config.policy.skuWhitelist,
      vendor_whitelist: config.policy.vendorWhitelist,
      health_window_seconds: config.network.healthWindowSeconds,
    },
  });
});

router.get('/v1/dashboard/logs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  res.json({ logs: await getLogs(limit) });
});

router.get('/v1/dashboard/queue', async (req, res) => {
  const items = await queue.snapshot();
  res.json({
    queue: items.map((i) => ({
      txn_id: i.txnId,
      intent_id: i.intent.intent_id,
      agent_id: i.intent.agent_id,
      amount: i.intent.amount,
      attempts: i.attempts,
      status: i.status,
      queued_at: i.queuedAt,
      last_reason: i.lastReason,
    })),
  });
});

module.exports = router;
