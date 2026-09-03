const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const config = require('./config');
const logger = require('./logger');
const { assertRedisReady, redis } = require('./services/redisClient');

async function assertProductionReady() {
  const problems = [];

  if (!config.auth.jwtSecret) problems.push('AGENT_JWT_SECRET is not set.');
  if (!config.auth.adminApiKey) problems.push('ADMIN_API_KEY is not set (needed to register agents).');
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    problems.push('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set — use real Razorpay TEST MODE keys.');
  }

  try {
    await assertRedisReady();
  } catch (e) {
    problems.push(`Cannot reach Redis at ${config.redis.url}: ${e.message}`);
  }

  if (problems.length) {
    logger.error('❌ Sentinel-AP Gateway refused to start — this app has no mock/demo mode:');
    problems.forEach((p) => logger.error('   - ' + p));
    process.exit(1);
  }
}

async function main() {
  await assertProductionReady();

  const razorpay = require('./services/razorpay');
  const { evaluateGate2, recordTransactionOutcome, startHealthProber } = require('./gates/networkHealth');
  const { pushLog, recordOutcome, recordAgentSpend } = require('./data/store');
  const queue = require('./services/queue');
  const ws = require('./ws');

  const authRoutes = require('./routes/authRoutes');
  const transactionRoutes = require('./routes/transaction');
  const dashboardRoutes = require('./routes/dashboard');
  const webhookRoutes = require('./routes/webhook');

  queue.init({
    evaluateGate2,
    executePayment: razorpay.executePayment,
    recordTransactionOutcome,
    pushLog,
    recordOutcome,
    recordAgentSpend,
    broadcast: ws.broadcast,
  });

  const app = express();
  app.use(cors());
  app.use('/v1/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/', authRoutes);
  app.use('/v1/transaction', transactionRoutes);
  app.use('/', dashboardRoutes);

  app.get('/healthz', async (req, res) => {
    try {
      await redis.ping();
      res.json({ ok: true, service: 'sentinel-ap-gateway', env: config.server.environment, redis: 'connected' });
    } catch (e) {
      res.status(503).json({ ok: false, redis: 'unreachable', error: e.message });
    }
  });

  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ status: 'ERROR', message: 'Internal Sentinel-AP Gateway error.' });
  });

  const httpServer = http.createServer(app);
  ws.attach(httpServer);

  startHealthProber();
  queue.startQueueWorker();

  httpServer.listen(config.server.port, () => {
    logger.info(`🛡️  Sentinel-AP Gateway listening on port ${config.server.port} [${config.server.environment}]`);
    logger.info(`   Dashboard:  http://localhost:${config.server.port}`);
    logger.info(`   API:        POST http://localhost:${config.server.port}/v1/transaction/intent`);
    logger.info(`   WebSocket:  ws://localhost:${config.server.port}/ws`);
    logger.info(`   Redis:      ${config.redis.url}`);
  });
}

main().catch((e) => {
  logger.error('Fatal startup error:', e);
  process.exit(1);
});
