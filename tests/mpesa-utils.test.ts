/** Talking to Safaricom gently: the access token is reused, and a rejected token is replaced once. */
import './setup';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let tokenCalls = 0;
let postCalls = 0;
let postFailures: any[] = [];
let tokenLifetime: number | undefined = 3599;

const fakeModule = (file: string, exports: any) => {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as any;
};
fakeModule('axios', {
  __esModule: true,
  default: {
    get: async () => { tokenCalls++; await new Promise((r) => setTimeout(r, 5)); return { data: { access_token: `tok${tokenCalls}`, expires_in: tokenLifetime } }; },
    post: async (_url: string, _body: unknown, cfg: any) => {
      postCalls++;
      const fail = postFailures.shift();
      if (fail) throw fail;
      return { data: { used: cfg.headers.Authorization } };
    },
  },
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const M = require('../src/utils/mpesa') as typeof import('../src/utils/mpesa');

beforeEach(() => {
  tokenCalls = 0; postCalls = 0; postFailures = []; tokenLifetime = 3599;
  M.clearMpesaToken();
});

test('the access token is fetched once and reused, even for many checks at the same moment', async () => {
  const tokens = await Promise.all([M.getMpesaToken(), M.getMpesaToken(), M.getMpesaToken()]);
  assert.deepEqual(tokens, ['tok1', 'tok1', 'tok1']);
  assert.equal(tokenCalls, 1); // three callers, one request
  assert.equal(await M.getMpesaToken(), 'tok1');
  assert.equal(tokenCalls, 1); // and later calls reuse it too
});

test('every payment check reuses the saved token instead of asking Safaricom for a new one', async () => {
  for (let i = 0; i < 6; i++) await M.querySTKStatus('ws_CO_1');
  assert.equal(tokenCalls, 1);
  assert.equal(postCalls, 6);
});

test('a token is replaced a few minutes before it would expire', async () => {
  const realNow = Date.now;
  try {
    await M.getMpesaToken(); // lasts 3599 s, replaced 5 minutes early
    Date.now = () => realNow() + 3000 * 1000; // 50 minutes later: still good
    await M.getMpesaToken();
    assert.equal(tokenCalls, 1);
    Date.now = () => realNow() + 3400 * 1000; // inside the last 5 minutes: fetch a new one
    assert.equal(await M.getMpesaToken(), 'tok2');
    assert.equal(tokenCalls, 2);
  } finally {
    Date.now = realNow;
  }
});

test('if Safaricom rejects the token (401) a fresh one is fetched and the call is repeated once', async () => {
  await M.querySTKStatus('ws_CO_1'); // token 1
  postFailures = [Object.assign(new Error('unauthorized'), { response: { status: 401 } })];
  const r: any = await M.querySTKStatus('ws_CO_1');
  assert.equal(tokenCalls, 2);
  assert.equal(r.used, 'Bearer tok2');
});

test('other failures (for example "still processing") are passed on, not retried', async () => {
  postFailures = [Object.assign(new Error('processing'), { response: { status: 500 } })];
  await assert.rejects(() => M.querySTKStatus('ws_CO_1'), /processing/);
  assert.equal(postCalls, 1);
});
