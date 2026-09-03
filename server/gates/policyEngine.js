const config = require('../config');
const { getAgentSpend } = require('../data/store');

const REQUIRED_FIELDS = ['agent_id', 'intent_id', 'amount', 'currency', 'vendor_id', 'sku', 'timestamp'];
const SUSPICIOUS_PATTERN = /<script|{{|}}|\bignore (all|previous)\b|\bsystem prompt\b/i;

function checkNonAmbiguity(intent) {
  for (const field of REQUIRED_FIELDS) {
    if (intent[field] === undefined || intent[field] === null || intent[field] === '') {
      return { ok: false, reason: `Missing required field: '${field}'. Intent payload is ambiguous.` };
    }
  }
  if (typeof intent.amount !== 'number' || Number.isNaN(intent.amount) || intent.amount <= 0) {
    return { ok: false, reason: `'amount' must be a positive number. Received: ${JSON.stringify(intent.amount)}` };
  }
  if (typeof intent.currency !== 'string' || intent.currency.toUpperCase() !== 'INR') {
    return { ok: false, reason: `Unsupported or missing currency: '${intent.currency}'. Only INR is supported.` };
  }
  for (const field of ['agent_id', 'intent_id', 'vendor_id', 'sku']) {
    if (SUSPICIOUS_PATTERN.test(String(intent[field]))) {
      return { ok: false, reason: `Field '${field}' contains suspicious / injection-like content and was rejected.` };
    }
  }
  if (Number.isNaN(Date.parse(intent.timestamp))) {
    return { ok: false, reason: `'timestamp' is not a valid ISO-8601 date: '${intent.timestamp}'` };
  }
  return { ok: true };
}

function checkBudgetCap(intent) {
  if (intent.amount > config.policy.maxTransactionLimitInr) {
    return {
      ok: false,
      reason: `Amount ₹${intent.amount.toLocaleString('en-IN')} exceeds the hard per-transaction cap of ₹${config.policy.maxTransactionLimitInr.toLocaleString('en-IN')}.`,
    };
  }
  return { ok: true };
}

async function checkVelocity(intent) {
  const windowStartMs = Date.now() - config.policy.rollingWindowHours * 3600 * 1000;
  const spentSoFar = await getAgentSpend(intent.agent_id, windowStartMs);
  if (spentSoFar + intent.amount > config.policy.rollingLimitInr) {
    return {
      ok: false,
      reason: `Agent '${intent.agent_id}' has spent ₹${spentSoFar.toLocaleString('en-IN')} in the last ${config.policy.rollingWindowHours}h. Adding ₹${intent.amount.toLocaleString('en-IN')} would breach the rolling velocity limit of ₹${config.policy.rollingLimitInr.toLocaleString('en-IN')}.`,
    };
  }
  return { ok: true };
}

function checkSkuWhitelist(intent) {
  if (config.policy.skuWhitelist.length && !config.policy.skuWhitelist.includes(intent.sku)) {
    return { ok: false, reason: `SKU '${intent.sku}' is not on the approved procurement whitelist.` };
  }
  return { ok: true };
}

function checkVendorWhitelist(intent) {
  if (config.policy.vendorWhitelist.length && !config.policy.vendorWhitelist.includes(intent.vendor_id)) {
    return { ok: false, reason: `Vendor '${intent.vendor_id}' is not on the approved vendor whitelist.` };
  }
  return { ok: true };
}

async function evaluateGate1(intent) {
  const checks = [
    ['INTENT_NON_AMBIGUITY', checkNonAmbiguity],
    ['BUDGET_CAP', checkBudgetCap],
    ['VELOCITY_LIMIT', checkVelocity],
    ['SKU_WHITELIST', checkSkuWhitelist],
    ['VENDOR_WHITELIST', checkVendorWhitelist],
  ];
  for (const [code, fn] of checks) {
    const result = await fn(intent);
    if (!result.ok) return { status: 'FAILED', failedCheck: code, reason: result.reason };
  }
  return { status: 'PASSED', failedCheck: null, reason: 'All policy checks passed.' };
}

module.exports = { evaluateGate1, REQUIRED_FIELDS };
