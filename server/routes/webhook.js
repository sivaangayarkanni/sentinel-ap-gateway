const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');
const { pushLog, getIntentRecord, saveIntentRecord } = require('../data/store');
const { broadcast } = require('../ws');

const router = express.Router();

function verifySignature(rawBody, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature || '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post('/razorpay', async (req, res) => {
  if (!config.razorpay.webhookSecret) {
    logger.warn('Webhook received but RAZORPAY_WEBHOOK_SECRET is not set — rejecting.');
    return res.status(503).json({ error: 'WEBHOOK_UNCONFIGURED' });
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const signature = req.headers['x-razorpay-signature'];
  if (!verifySignature(raw, signature, config.razorpay.webhookSecret)) {
    return res.status(400).json({ error: 'INVALID_SIGNATURE' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'INVALID_JSON' });
  }

  const type = event.event;
  const payment = event.payload?.payment?.entity;
  const notes = payment?.notes || {};
  const intentId = notes.intent_id;
  const paymentId = payment?.id || null;
  const orderId = payment?.order_id || notes.razorpay_order_id || null;

  logger.info(`Razorpay webhook ${type} payment=${paymentId} intent=${intentId || '-'}`);

  if (type === 'payment.captured' && intentId) {
    const existing = (await getIntentRecord(intentId)) || { status: 'UNKNOWN', body: {} };
    existing.status = 'SETTLED';
    existing.body = {
      ...(existing.body || {}),
      settlement_status: 'CAPTURED',
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId || existing.body?.razorpay_order_id,
    };
    await saveIntentRecord(intentId, existing);
    const logEntry = await pushLog({
      type: 'SETTLED',
      intentId,
      agentId: notes.agent_id || existing.body?.agent_id || 'unknown',
      amount: payment?.amount ? payment.amount / 100 : existing.body?.amount || 0,
      message: `Payment captured. ${paymentId}`,
      paymentId,
      orderId,
    });
    broadcast({ type: 'log', payload: logEntry });
    broadcast({ type: 'stats_update' });
  }

  res.json({ ok: true });
});

module.exports = router;
