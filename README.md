# Sentinel-AP Gateway (Production)

**Middleware Security & Infrastructure Gate for Autonomous AI Agent Transactions**

A real, non-mocked implementation. No simulated payments, no fake network telemetry, no demo auth backdoor. Every gate decision is driven by actual data: real Razorpay API calls, real Redis persistence, real JWT-based agent credentials.

## Hard requirements (the app refuses to start without these)

| Requirement | Why |
|---|---|
| **Redis** reachable at `REDIS_URL` | Durable retry queue, agent registry, decision log, health telemetry |
| **Real Razorpay keys** (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) | Order creation and Gate 2 health prober. Test-mode keys (`rzp_test_...`) are fine |
| **`AGENT_JWT_SECRET`** | Signs/verifies agent access tokens |
| **`ADMIN_API_KEY`** | Required to register or revoke agents |

There is no mock fallback. If any of the above is missing, `npm start` exits.

## Setup

```bash
npm install
cp .env.example .env
# set RAZORPAY_KEY_ID/SECRET, AGENT_JWT_SECRET, ADMIN_API_KEY, REDIS_URL
redis-server &
npm start
```

Open http://localhost:8080 for the live dashboard.

## Auth

1. Operator registers an agent with `X-Admin-Key` → `POST /v1/agents/register` (client_secret shown once, only hash stored).
2. Agent exchanges `agent_id` + `client_secret` → `POST /v1/auth/token` (15 min JWT).
3. Agent calls `POST /v1/transaction/intent` with `Authorization: Bearer <token>`.
4. Revoke immediately: `POST /v1/agents/:agentId/revoke`.

## Gates

- **Gate 1** — policy: budget cap, rolling velocity, SKU/vendor whitelist, intent non-ambiguity.
- **Gate 2** — real Razorpay health (`orders.all` probe + transaction outcomes in a Redis rolling window). Unhealthy rail → queue, no override.

## Settlement (honest)

`POST /v1/transaction/intent` responses:

- `ACCEPTED` (200) — order + payment link created. `settlement_status: AWAITING_PAYMENT`. Fields: `razorpay_order_id`, `payment_link_url`. `razorpay_payment_id` is null until capture.
- `BLOCKED` (403) — Gate 1 failed.
- `QUEUED` (202) — Gate 2 failed; Redis retry queue.
- `FAILED` (502) — Razorpay rejected the order. Same `intent_id` may be retried.
- `DUPLICATE` (409) — intent already processed.

`POST /v1/webhooks/razorpay` (raw body + `X-Razorpay-Signature`, needs `RAZORPAY_WEBHOOK_SECRET`): on `payment.captured` the intent becomes `SETTLED` and the real `pay_...` id is stored. That is the only place a payment id is written.

## Dashboard

WebSocket `/ws` pushes log / stats / queue / health. REST: `/v1/dashboard/stats`, `/logs`, `/queue`, `/healthz`.

## Constraint

Sandbox egress cannot reach `api.razorpay.com`. Fail-safe queue on real 403 is intended. Live `ACCEPTED` + later `pay_` id needs test keys and normal internet + webhook.

## v1.1 (2026-09-03)

- Honest settlement: order + payment link, not a fake pay id
- Webhook capture with HMAC verification
- Timing-safe admin key compare
- Redis rate limits on token + intent
- Idempotency stores previous response; FAILED intents can retry
