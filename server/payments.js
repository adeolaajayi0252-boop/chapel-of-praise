// Payment provider integration boundary.
//
// This app never collects or stores raw card details — that is the whole
// point of using a hosted-checkout provider like Paystack or Flutterwave.
// The flow is always: server asks the provider to create a payment session
// -> member is redirected to the provider's own hosted page to actually
// pay -> provider calls our webhook -> we verify that webhook's signature
// -> only THEN do we mark the giving record as paid.
//
// We never trust a client-side "payment succeeded" message on its own.
//
// No API keys are hardcoded anywhere in this file. Set ONE of:
//   PAYSTACK_SECRET_KEY   (https://dashboard.paystack.com/#/settings/developers)
//   FLUTTERWAVE_SECRET_KEY (https://dashboard.flutterwave.com/settings/apis)
// as an environment variable on your hosting platform. If neither is set,
// the giving flow correctly reports that no payment provider is configured
// yet, rather than pretending to work.

import https from 'node:https';
import crypto from 'node:crypto';

function httpsRequestJSON({ hostname, path, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname, path, method,
      headers: {
        ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(chunks); } catch { parsed = { raw: chunks }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export function activeProvider() {
  if (process.env.PAYSTACK_SECRET_KEY) return 'paystack';
  if (process.env.FLUTTERWAVE_SECRET_KEY) return 'flutterwave';
  return null;
}

// amountNaira: whole naira amount (e.g. 5000 for ₦5,000)
export async function createCheckoutSession({ provider, email, amountNaira, reference, category, callbackUrl }) {
  if (provider === 'paystack') {
    const res = await httpsRequestJSON({
      hostname: 'api.paystack.co',
      path: '/transaction/initialize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        email,
        amount: Math.round(amountNaira * 100), // Paystack uses kobo
        reference,
        callback_url: callbackUrl,
        metadata: { category }
      }
    });
    if (res.status >= 200 && res.status < 300 && res.body.status) {
      return { ok: true, authorizationUrl: res.body.data.authorization_url, reference };
    }
    return { ok: false, error: res.body.message || 'Paystack initialization failed' };
  }

  if (provider === 'flutterwave') {
    const res = await httpsRequestJSON({
      hostname: 'api.flutterwave.com',
      path: '/v3/payments',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: {
        tx_ref: reference,
        amount: amountNaira,
        currency: 'NGN',
        redirect_url: callbackUrl,
        customer: { email },
        meta: { category }
      }
    });
    if (res.status >= 200 && res.status < 300 && res.body.status === 'success') {
      return { ok: true, authorizationUrl: res.body.data.link, reference };
    }
    return { ok: false, error: res.body.message || 'Flutterwave initialization failed' };
  }

  return { ok: false, error: 'No payment provider is configured.' };
}

// Verifies a transaction server-side by asking the provider directly
// (never trust the amount/status the client reports).
export async function verifyTransaction({ provider, reference }) {
  if (provider === 'paystack') {
    const res = await httpsRequestJSON({
      hostname: 'api.paystack.co',
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const ok = res.status === 200 && res.body.data && res.body.data.status === 'success';
    return { ok, amount: ok ? res.body.data.amount / 100 : null, raw: res.body };
  }
  if (provider === 'flutterwave') {
    const res = await httpsRequestJSON({
      hostname: 'api.flutterwave.com',
      path: `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
    });
    const ok = res.status === 200 && res.body.data && res.body.data.status === 'successful';
    return { ok, amount: ok ? res.body.data.amount : null, raw: res.body };
  }
  return { ok: false, amount: null, raw: null };
}

// Validates an incoming webhook's signature so a forged request can't mark
// a gift as paid. Paystack signs with HMAC-SHA512 of the raw body using the
// secret key; Flutterwave sends a static verif-hash header to compare.
export function verifyWebhookSignature({ provider, rawBody, headers }) {
  if (provider === 'paystack') {
    const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '').update(rawBody).digest('hex');
    const got = headers['x-paystack-signature'] || '';
    const a = Buffer.from(expected); const b = Buffer.from(got);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (provider === 'flutterwave') {
    const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH || '';
    const got = headers['verif-hash'] || '';
    if (!expected) return false;
    const a = Buffer.from(expected); const b = Buffer.from(got);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}
