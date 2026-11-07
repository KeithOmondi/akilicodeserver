import './setup';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import app from '../src/app';

let server: http.Server;
let base = '';
before(async () => {
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  setTimeout(() => process.exit(0), 100).unref();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('CORS: allowed origin is echoed, unknown origin is not, never "*"', async () => {
  const ok = await fetch(base + '/', { headers: { origin: 'https://app.example.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
  const bad = await fetch(base + '/', { headers: { origin: 'https://evil.example.net' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('Safaricom URLs: wrong secret looks like a missing route', async () => {
  for (const p of ['/api/v1/mpesa/callback/nope', '/api/v1/mpesa/c2b/confirm/nope', '/api/v1/mpesa/c2b/validate/nope']) {
    assert.equal((await post(p, { Body: {} })).status, 404);
  }
});

test('Old un-secreted callback URL no longer exists', async () => {
  assert.equal((await post('/api/v1/mpesa/callback', { Body: {} })).status, 404);
});

test('Registration rejects bad input (and a smuggled admin role) before touching the DB', async () => {
  const r = await post('/api/v1/auth/register', { name: 'A', email: 'nope', phone: '1', password: 'x', role: 'admin' });
  assert.equal(r.status, 400);
});

test('Payment endpoints require login', async () => {
  assert.equal((await post('/api/v1/mpesa/stk-push', { enrollment_id: 'x', phone: '0712345678' })).status, 401);
  assert.equal((await post('/api/v1/payments/create', { enrollment_id: 'x', amount: 1, method: 'cash' })).status, 401);
});

test('Child PIN login is rate limited (and validated)', async () => {
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await post('/api/v1/kids/login', { username: 'x', pin: 'bad' })).status;
  assert.equal(last, 429);
});

test('Parent login is rate limited per IP+email', async () => {
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await post('/api/v1/auth/login', { email: 'a@b.co', password: '' })).status;
  assert.equal(last, 429);
});

test('Password-reset requests are rate limited', async () => {
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await post('/api/v1/auth/forgot-password', { email: 'not-an-email' })).status;
  assert.equal(last, 429);
});
