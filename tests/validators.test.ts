import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKenyanPhone, password } from '../src/validators/common';
import { registerSchema } from '../src/validators/auth.validators';
import { stkPushSchema } from '../src/validators/mpesa.validators';
import { kidLoginSchema, setKidLoginSchema } from '../src/validators/kid.validators';

test('Kenyan phone numbers normalise to 254…', () => {
  for (const v of ['0712345678', '+254712345678', '254712345678', '0712 345 678', '0112345678'])
    assert.match(normalizeKenyanPhone(v)!, /^254[17]\d{8}$/);
  for (const v of ['12345', '0212345678', '+1555123456', 'abc']) assert.equal(normalizeKenyanPhone(v), null);
});

test('register schema drops a smuggled role', () => {
  const r = registerSchema.parse({ name: 'Jane Doe', email: 'J@X.com ', phone: '0712345678', password: 'abcdef12', role: 'admin' });
  assert.equal((r as any).role, undefined);
  assert.equal(r.email, 'j@x.com');
});

test('password rules', () => {
  assert.equal(password.safeParse('short1').success, false);
  assert.equal(password.safeParse('allletters').success, false);
  assert.equal(password.safeParse('abcdef12').success, true);
});

test('stk-push ignores any amount sent by the browser', () => {
  const r = stkPushSchema.parse({ enrollment_id: '6f1c2f4e-8a3b-4c1d-9e2f-1a2b3c4d5e6f', phone: '0712345678', amount: 1 });
  assert.equal((r as any).amount, undefined);
  assert.equal(r.phone, '254712345678');
});

test('kid PIN must be 4 digits; legacy usernames can still log in', () => {
  assert.equal(kidLoginSchema.safeParse({ username: 'dora_ explorer', pin: '1234' }).success, true);
  assert.equal(kidLoginSchema.safeParse({ username: 'sifuna', pin: '12' }).success, false);
  assert.equal(setKidLoginSchema.safeParse({ username: 'has space', pin: '1234' }).success, false);
});
