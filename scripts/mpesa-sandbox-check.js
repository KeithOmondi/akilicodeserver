/**
 * Read-only sanity check for Daraja SANDBOX credentials.
 * Only asks Safaricom for an OAuth token; sends no payment, touches no database.
 *   node scripts/mpesa-sandbox-check.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');

(async () => {
  const env = process.env.MPESA_ENV || 'sandbox';
  if (env !== 'sandbox') { console.log('MPESA_ENV is', env, '- refusing to run against production.'); process.exit(1); }
  const key = process.env.MPESA_CONSUMER_KEY, secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) { console.log('MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET missing'); process.exit(1); }
  try {
    const r = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      auth: { username: key, password: secret }, timeout: 15000,
    });
    console.log('OK: Safaricom sandbox accepted the credentials (token expires in', r.data.expires_in, 's).');
  } catch (e) {
    console.log('FAILED:', e.response ? `HTTP ${e.response.status}` : e.message);
    process.exit(1);
  }
  const cb = process.env.MPESA_CALLBACK_URL || '';
  console.log('Callback base URL :', cb.replace(/\/\/[^/]+/, (h) => '//' + h.slice(2)));
  console.log('Callback is public:', /^https:\/\/(?!localhost|127\.)/.test(cb) ? 'looks public' : 'NOT public - Safaricom cannot reach it. Use a tunnel (see docs/DARAJA_SANDBOX_E2E.md).');
  console.log('Shortcode         :', process.env.MPESA_SHORTCODE, '(sandbox test shortcode is 174379)');
})();
