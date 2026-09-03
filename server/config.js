require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT || '8080', 10),
    environment: process.env.ENVIRONMENT || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  policy: {
    maxTransactionLimitInr: parseFloat(process.env.MAX_TRANSACTION_LIMIT_INR || '10000'),
    rollingLimitInr: parseFloat(process.env.ROLLING_LIMIT_INR || '25000'),
    rollingWindowHours: parseFloat(process.env.ROLLING_WINDOW_HOURS || '24'),
    skuWhitelist: (process.env.SKU_WHITELIST ||
      'SKU-CLOUD-COMPUTE-01,SKU-STATIONERY-001,SKU-CLOUD-CREDITS-002,SKU-SAAS-LICENSE-03')
      .split(',').map(s => s.trim()).filter(Boolean),
    vendorWhitelist: (process.env.VENDOR_WHITELIST ||
      'vnd_razorpay_whitelisted,vendor_amazon_biz,vendor_aws,vnd_saas_partner')
      .split(',').map(s => s.trim()).filter(Boolean),
  },
  network: {
    upiHealthThreshold: parseFloat(process.env.UPI_HEALTH_THRESHOLD || '0.95'),
    maxAcceptableLatencyMs: parseFloat(process.env.MAX_ACCEPTABLE_LATENCY_MS || '4000'),
    maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '5', 10),
    backoffBaseMs: parseInt(process.env.BACKOFF_BASE_MS || '3000', 10),
    healthProbeIntervalMs: parseInt(process.env.HEALTH_PROBE_INTERVAL_MS || '10000', 10),
    healthWindowSeconds: parseInt(process.env.HEALTH_WINDOW_SECONDS || '300', 10),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  auth: {
    jwtSecret: process.env.AGENT_JWT_SECRET,
    jwtIssuer: process.env.JWT_ISSUER || 'sentinel-ap-gateway',
    jwtAudience: process.env.JWT_AUDIENCE || 'sentinel-ap-transactions',
    tokenTtlSeconds: parseInt(process.env.AGENT_JWT_TTL_SECONDS || '900', 10),
    adminApiKey: process.env.ADMIN_API_KEY,
  },
};

module.exports = config;
