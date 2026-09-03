const express = require('express');
const { evaluateGate1 } = require('../gates/policyEngine');
const { evaluateGate2, recordTransactionOutcome } = require('../gates/networkHealth');
const razorpay = require('../services/razorpay');
const queue = require('../services/queue');
const {
  pushLog, recordOutcome, recordAgentSpend,
  claimIntent, saveIntentRecord, getIntentRecord, releaseIntent,
} = require('../data/store');
const logger = require('../logger');
const { requireAgentAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { broadcast } = require('../ws');

const router = express.Router();
router.use(requireAgentAuth);
router.use(rateLimit({
  windowSeconds: 60,
  max: 40,
  prefix: 'rl:txn',
  keyFn: (req) => `${req.agent?.agentId || 'anon'}:${req.ip}`,
}));

function acceptedPayload(intent, paymentResult) {
  return {
    status: 'ACCEPTED',
    gate_status: { gate_1_policy: 'PASSED', gate_2_network: 'PASSED' },
    settlement_status: paymentResult.settlementStatus,
    razorpay_order_id: paymentResult.orderId,
    razorpay_payment_id: paymentResult.paymentId,
    payment_link_id: paymentResult.paymentLinkId,
    payment_link_url: paymentResult.paymentLinkUrl,
    executed_at: new Date().toISOString(),
    note: 'Order + payment link created on Razorpay. Funds settle only after payment.captured webhook.',
  };
}

router.post('/intent', async (req, res) => {
  const intent = req.body || {};
  if (!intent.agent_id && req.agent?.agentId) intent.agent_id = req.agent.agentId;
  logger.info(`Intent received: ${intent.intent_id} from ${intent.agent_id} for ₹${intent.amount}`);

  if (intent.agent_id && req.agent?.agentId && intent.agent_id !== req.agent.agentId) {
    return res.status(403).json({
      status: 'BLOCKED',
      error: 'AGENT_MISMATCH',
      message: `Token belongs to '${req.agent.agentId}' but intent claims agent_id '${intent.agent_id}'.`,
    });
  }

  if (intent.intent_id) {
    const first = await claimIntent(intent.intent_id);
    if (!first) {
      const existing = await getIntentRecord(intent.intent_id);
      if (existing && existing.status === 'FAILED') {
        await releaseIntent(intent.intent_id);
        const claimed = await claimIntent(intent.intent_id);
        if (!claimed) {
          return res.status(409).json({ status: 'DUPLICATE', error: 'IDEMPOTENCY_CONFLICT', previous: existing });
        }
      } else {
        return res.status(409).json({
          status: 'DUPLICATE',
          error: 'IDEMPOTENCY_CONFLICT',
          message: `intent_id '${intent.intent_id}' has already been submitted.`,
          previous: existing,
        });
      }
    }
  }

  const gate1Result = await evaluateGate1(intent);
  if (gate1Result.status === 'FAILED') {
    await recordOutcome('BLOCK_POLICY', typeof intent.amount === 'number' ? intent.amount : 0);
    const logEntry = await pushLog({
      type: 'BLOCK',
      intentId: intent.intent_id || 'unknown',
      agentId: intent.agent_id || 'unknown',
      amount: intent.amount || 0,
      message: gate1Result.reason,
    });
    broadcast({ type: 'log', payload: logEntry });
    broadcast({ type: 'stats_update' });
    const body = {
      status: 'BLOCKED',
      gate_status: { gate_1_policy: 'FAILED', gate_2_network: 'SKIPPED' },
      violation: { gate: 'GATE_1_POLICY', check: gate1Result.failedCheck, reason: gate1Result.reason },
      executed_at: null,
    };
    if (intent.intent_id) await saveIntentRecord(intent.intent_id, { status: 'BLOCKED', body });
    return res.status(403).json(body);
  }

  const gate2Result = await evaluateGate2();
  if (gate2Result.status === 'FAILED') {
    const txnId = await queue.hold(intent, gate1Result, gate2Result);
    broadcast({ type: 'stats_update' });
    const body = {
      status: 'QUEUED',
      gate_status: { gate_1_policy: 'PASSED', gate_2_network: 'FAILED' },
      queue: {
        queued_transaction_id: txnId,
        reason: gate2Result.reason,
        telemetry: gate2Result.telemetry,
        retry_policy: 'exponential_backoff',
      },
      executed_at: null,
    };
    if (intent.intent_id) await saveIntentRecord(intent.intent_id, { status: 'QUEUED', body });
    return res.status(202).json(body);
  }

  const paymentResult = await razorpay.executePayment(intent);
  await recordTransactionOutcome(paymentResult.success, paymentResult.latencyMs);

  if (!paymentResult.success) {
    recordOutcome('BLOCK_NETWORK', intent.amount);
    const logEntry = await pushLog({
      type: 'BLOCK',
      intentId: intent.intent_id,
      agentId: intent.agent_id,
      amount: intent.amount,
      message: `Razorpay execution failed: ${paymentResult.error}`,
    });
    broadcast({ type: 'log', payload: logEntry });
    broadcast({ type: 'stats_update' });
    const body = {
      status: 'FAILED',
      gate_status: { gate_1_policy: 'PASSED', gate_2_network: 'PASSED' },
      error: paymentResult.error,
      executed_at: null,
    };
    if (intent.intent_id) await saveIntentRecord(intent.intent_id, { status: 'FAILED', body });
    return res.status(502).json(body);
  }

  await recordAgentSpend(intent.agent_id, intent.amount);
  await recordOutcome('EXECUTED', intent.amount);
  const logEntry = await pushLog({
    type: 'ACCEPTED',
    intentId: intent.intent_id,
    agentId: intent.agent_id,
    amount: intent.amount,
    message: `Rail accepted. Order ${paymentResult.orderId}` + (paymentResult.paymentLinkUrl ? ` | pay: ${paymentResult.paymentLinkUrl}` : ''),
    orderId: paymentResult.orderId,
    paymentLinkUrl: paymentResult.paymentLinkUrl,
  });
  broadcast({ type: 'log', payload: logEntry });
  broadcast({ type: 'stats_update' });
  const body = acceptedPayload(intent, paymentResult);
  if (intent.intent_id) await saveIntentRecord(intent.intent_id, { status: 'ACCEPTED', body });
  return res.status(200).json(body);
});

module.exports = router;
