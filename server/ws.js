/**
 * Real-time WebSocket broadcast layer for the dashboard. Replaces HTTP
 * polling entirely — the browser gets pushed a message the instant a
 * gate decision, queue change, or stats update happens server-side.
 */

const WebSocket = require('ws');
const logger = require('./logger');

let wss = null;

function attach(httpServer) {
  wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket) => {
    logger.debug('Dashboard WebSocket client connected.');
    socket.send(JSON.stringify({ type: 'connected', payload: { message: 'Sentinel-AP live feed connected.' } }));

    socket.on('close', () => logger.debug('Dashboard WebSocket client disconnected.'));
    socket.on('error', (e) => logger.warn('WebSocket client error:', e.message));
  });

  logger.info('WebSocket server attached at /ws');
  return wss;
}

function broadcast(message) {
  if (!wss) return;
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

module.exports = { attach, broadcast };
