const Razorpay = require('razorpay');
const config = require('../config');
const logger = require('../logger');

if (!config.razorpay.keyId || !config.razorpay.keySecret) {
  throw new Error(
    'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set. Sentinel-AP does not run in mock mode — ' +
    'use real Razorpay TEST MODE keys (rzp_test_...) for non-production environments.'
  );
}

const client = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

logger.info(`Razorpay client initialized (key_id=${config.razorpay.keyId.slice(0, 12)}...).`);

async function executePayment(intent) {
  const startedAt = Date.now();
  try {
    const order = await client.orders.create({
      amount: Math.round(intent.amount * 100),
      currency: 'INR',
      receipt: String(intent.intent_id).slice(0, 40),
      notes: {
        agent_id: intent.agent_id,
        sku: intent.sku,
        vendor_id: intent.vendor_id,
        intent_id: intent.intent_id,
      },
    });

    let paymentLink = null;
    try {
      paymentLink = await client.paymentLink.create({
        amount: Math.round(intent.amount * 100),
        currency: 'INR',
        accept_partial: false,
        reference_id: String(intent.intent_id).slice(0, 40),
        description: `Sentinel-AP intent ${intent.intent_id} (${intent.sku})`,
        notes: {
          agent_id: intent.agent_id,
          sku: intent.sku,
          vendor_id: intent.vendor_id,
          intent_id: intent.intent_id,
          razorpay_order_id: order.id,
        },
      });
    } catch (linkErr) {
      logger.warn('Order created but payment link failed:', linkErr.error?.description || linkErr.message);
    }

    return {
      success: true,
      orderId: order.id,
      paymentId: null,
      paymentLinkId: paymentLink?.id || null,
      paymentLinkUrl: paymentLink?.short_url || null,
      settlementStatus: 'AWAITING_PAYMENT',
      raw: { order, paymentLink },
      latencyMs: Date.now() - startedAt,
    };
  } catch (e) {
    const message = e.error?.description || e.message || (e.statusCode ? `HTTP ${e.statusCode}` : 'Unknown Razorpay error');
    logger.error('Razorpay order creation failed:', message);
    return { success: false, error: message, raw: e.error || null, latencyMs: Date.now() - startedAt };
  }
}

async function probeApiHealth() {
  const startedAt = Date.now();
  try {
    await client.orders.all({ count: 1 });
    return { success: true, latencyMs: Date.now() - startedAt };
  } catch (e) {
    const message = e.error?.description || e.message || (e.statusCode ? `HTTP ${e.statusCode}` : 'Unknown error');
    return { success: false, latencyMs: Date.now() - startedAt, error: message };
  }
}

module.exports = { executePayment, probeApiHealth, client };
