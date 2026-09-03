/* global fetch, WebSocket */
(() => {
  const API = '';
  let ACCESS_TOKEN = null;
  let AUTH_AGENT_ID = null;
  let CONFIG = null;
  let ws = null;

  const el = (id) => document.getElementById(id);
  const fmtInr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const escapeHtml = (str) => { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };

  function connectWs() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.onopen = () => setWsStatus(true);
    ws.onclose = () => { setWsStatus(false); setTimeout(connectWs, 2000); };
    ws.onerror = () => setWsStatus(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'log') { prependLog(msg.payload); refreshStats(); }
      else if (msg.type === 'stats_update') refreshStats();
      else if (msg.type === 'queue_update') refreshQueue();
      else if (msg.type === 'health_update') renderHealth(msg.payload);
    };
  }

  function setWsStatus(connected) {
    const pill = el('wsStatusPill');
    const text = el('wsStatusText');
    if (connected) {
      pill.style.color = 'var(--green)';
      pill.style.borderColor = 'rgba(43,217,124,0.3)';
      text.textContent = 'LIVE — WEBSOCKET CONNECTED';
    } else {
      pill.style.color = 'var(--red)';
      pill.style.borderColor = 'rgba(255,84,112,0.3)';
      text.textContent = 'DISCONNECTED — RECONNECTING…';
    }
  }

  async function bootstrap() {
    const statsData = await (await fetch(`${API}/v1/dashboard/stats`)).json();
    CONFIG = statsData.config;
    populateSelect('f_sku', CONFIG.sku_whitelist);
    populateSelect('f_vendor', CONFIG.vendor_whitelist);
    renderStats(statsData.stats);
    renderHealth(statsData.health);
    refreshLogs();
    refreshQueue();
    connectWs();
  }

  function populateSelect(id, whitelist) {
    const select = el(id);
    select.innerHTML = '';
    (whitelist || []).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      select.appendChild(opt);
    });
  }

  el('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const agentId = el('f_cred_agent_id').value.trim();
    const clientSecret = el('f_client_secret').value;
    const authBtn = el('authBtn');
    authBtn.disabled = true;
    try {
      const res = await fetch(`${API}/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, client_secret: clientSecret }),
      });
      const data = await res.json();
      if (!res.ok) {
        el('authStatusValue').textContent = `${data.error}: ${data.message}`;
        el('authStatusValue').style.color = 'var(--red)';
        return;
      }
      ACCESS_TOKEN = data.access_token;
      AUTH_AGENT_ID = agentId;
      el('authStatusValue').textContent = `Authenticated as ${agentId} — token expires in ${data.expires_in}s`;
      el('authStatusValue').style.color = 'var(--green)';
      el('submitBtn').disabled = false;
    } catch (err) {
      el('authStatusValue').textContent = `Network error: ${err.message}`;
      el('authStatusValue').style.color = 'var(--red)';
    } finally {
      authBtn.disabled = false;
    }
  });

  const NODE_X = { agent: 7, gate1: 33.5, gate2: 66.5, exec: 93 };

  function setGateVisual(gateNum, state) {
    const ring = el(`gate${gateNum}Ring`);
    const label = el(`gate${gateNum}State`);
    ring.className = 'gate-ring';
    label.className = 'gate-state';
    if (state === 'active') { ring.classList.add('gate-ring--idle', 'gate-ring--active'); label.textContent = 'CHECKING…'; }
    else if (state === 'pass') { ring.classList.add('gate-ring--pass'); label.classList.add('gate-state--pass'); label.textContent = 'PASSED'; }
    else if (state === 'fail') { ring.classList.add('gate-ring--fail'); label.classList.add('gate-state--fail'); label.textContent = 'FAILED'; }
    else if (state === 'hold') { ring.classList.add('gate-ring--hold'); label.classList.add('gate-state--hold'); label.textContent = 'HOLDING'; }
    else { ring.classList.add('gate-ring--idle'); label.textContent = 'STANDBY'; }
  }

  function resetGates() { setGateVisual(1, 'idle'); setGateVisual(2, 'idle'); el('execSub').textContent = 'Awaiting intent'; }
  function setBanner(text, mood) {
    const banner = el('outcomeBanner');
    banner.className = 'outcome-banner' + (mood ? ` ${mood}` : '');
    el('outcomeText').textContent = text;
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function spawnChip(amount, sku) {
    const layer = el('chipLayer');
    const chip = document.createElement('div');
    chip.className = 'txn-chip';
    chip.innerHTML = `<span class="chip-amt">${fmtInr(amount)}</span><span>${escapeHtml(sku)}</span>`;
    chip.style.left = `${NODE_X.agent}%`;
    chip.style.top = '28px';
    layer.appendChild(chip);
    return chip;
  }

  async function animateOutcome(intent, response, httpStatus) {
    resetGates();
    setBanner(`Processing intent ${intent.intent_id} — ₹${intent.amount.toLocaleString('en-IN')} for ${intent.sku}…`);
    const chip = spawnChip(intent.amount, intent.sku);
    await sleep(50);
    chip.style.left = `${NODE_X.gate1}%`;
    setGateVisual(1, 'active');
    await sleep(650);
    if (response?.gate_status?.gate_1_policy === 'FAILED') {
      setGateVisual(1, 'fail');
      chip.classList.add('chip--fail');
      setBanner(`BLOCKED at Gate 1 — ${response.violation?.reason || 'Policy violation.'}`, 'bad');
      await sleep(1400); chip.classList.add('chip--fadeout'); setTimeout(() => chip.remove(), 500); return;
    }
    setGateVisual(1, 'pass'); chip.classList.add('chip--pass'); await sleep(280);
    chip.style.left = `${NODE_X.gate2}%`; setGateVisual(2, 'active'); await sleep(650);
    if (response?.gate_status?.gate_2_network === 'FAILED') {
      setGateVisual(2, 'hold'); chip.classList.remove('chip--pass'); chip.classList.add('chip--hold');
      setBanner(`QUEUED (Redis-backed) — ${response.queue?.reason || ''}`, 'warn');
      await sleep(1200); chip.classList.add('chip--fadeout'); setTimeout(() => chip.remove(), 500); refreshQueue(); return;
    }
    setGateVisual(2, 'pass'); await sleep(280);
    chip.style.left = `${NODE_X.exec}%`; el('execSub').textContent = 'Executing…'; await sleep(600);
    if (httpStatus === 200) {
      el('execSub').textContent = 'Cleared';
      setBanner(`ACCEPTED — order ${response.razorpay_order_id || 'n/a'} · ${response.settlement_status || 'AWAITING_PAYMENT'}` + (response.payment_link_url ? ` · ${response.payment_link_url}` : ''), 'ok');
    } else {
      el('execSub').textContent = 'Failed';
      setBanner(`Razorpay execution failed: ${response.error}`, 'bad');
    }
    await sleep(1300); chip.classList.add('chip--fadeout'); setTimeout(() => chip.remove(), 500);
  }

  function buildIntent() {
    return {
      agent_id: AUTH_AGENT_ID,
      intent_id: `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      amount: Number(el('f_amount').value),
      currency: 'INR',
      vendor_id: el('f_vendor').value,
      sku: el('f_sku').value,
      timestamp: new Date().toISOString(),
    };
  }

  el('intentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ACCESS_TOKEN) { setBanner('Authenticate first — get an access token above.', 'bad'); return; }
    const submitBtn = el('submitBtn');
    submitBtn.disabled = true;
    const intent = buildIntent();
    try {
      const res = await fetch(`${API}/v1/transaction/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
        body: JSON.stringify(intent),
      });
      const data = await res.json();
      await animateOutcome(intent, data, res.status);
    } catch (err) {
      setBanner(`Network error talking to Sentinel-AP: ${err.message}`, 'bad');
    } finally {
      submitBtn.disabled = false;
      refreshStats();
    }
  });

  function renderStats(stats) {
    el('statTotal').textContent = stats.total;
    el('statExecuted').textContent = stats.executed;
    el('statBlocked').textContent = stats.blockedPolicy;
    el('statQueued').textContent = stats.queued;
    el('statProtected').textContent = fmtInr(stats.totalValueProtectedInr);
    el('statExecutedValue').textContent = fmtInr(stats.totalValueExecutedInr);
  }

  function renderHealth(health) {
    const box = el('healthValue');
    if (!health || health.status === 'UNKNOWN' || health.successRate === null) {
      box.textContent = 'Waiting for first probe…'; return;
    }
    box.textContent = `${(health.successRate * 100).toFixed(1)}% success · ${Math.round(health.avgLatencyMs)}ms avg · n=${health.sampleSize} (real Razorpay API)`;
    box.style.color = health.successRate >= (CONFIG?.upi_health_threshold ?? 0.95) ? 'var(--green)' : 'var(--red)';
  }

  async function refreshStats() {
    const data = await (await fetch(`${API}/v1/dashboard/stats`)).json();
    renderStats(data.stats);
    renderHealth(data.health);
    el('razorpayModeText').textContent = 'RAZORPAY — LIVE INTEGRATION';
  }

  function prependLog(log) {
    const feed = el('logFeed');
    if (feed.querySelector('.empty-state')) feed.innerHTML = '';
    const entry = document.createElement('div');
    entry.className = `log-entry log-entry--${log.type}`;
    entry.innerHTML = `<div class="log-top"><span class="log-tag">${log.type}</span><span>${new Date(log.ts).toLocaleTimeString('en-IN')}</span></div><div class="log-msg">${escapeHtml(log.agentId)} · ${escapeHtml(log.intentId)} · ${fmtInr(log.amount)} — ${escapeHtml(log.message)}</div>`;
    feed.prepend(entry);
    while (feed.children.length > 30) feed.removeChild(feed.lastChild);
  }

  async function refreshLogs() {
    const data = await (await fetch(`${API}/v1/dashboard/logs?limit=30`)).json();
    const feed = el('logFeed');
    if (!data.logs.length) { feed.innerHTML = '<div class="empty-state">Waiting for transaction activity…</div>'; return; }
    feed.innerHTML = data.logs.map((log) => `<div class="log-entry log-entry--${log.type}"><div class="log-top"><span class="log-tag">${log.type}</span><span>${new Date(log.ts).toLocaleTimeString('en-IN')}</span></div><div class="log-msg">${escapeHtml(log.agentId)} · ${escapeHtml(log.intentId)} · ${fmtInr(log.amount)} — ${escapeHtml(log.message)}</div></div>`).join('');
  }

  async function refreshQueue() {
    const data = await (await fetch(`${API}/v1/dashboard/queue`)).json();
    const list = el('queueList');
    if (!data.queue.length) {
      list.innerHTML = '<div class="empty-state">No transactions currently queued.</div>'; return;
    }
    list.innerHTML = data.queue.map((q) => `<div class="queue-item"><div class="queue-item-top"><span class="queue-item-id">${escapeHtml(q.intent_id)}</span><span class="queue-item-amt">${fmtInr(q.amount)}</span></div><div class="queue-item-reason">${escapeHtml(q.last_reason || '')}</div><div class="queue-item-meta">agent=${escapeHtml(q.agent_id)} · attempt ${q.attempts}</div></div>`).join('');
  }

  bootstrap();
})();
