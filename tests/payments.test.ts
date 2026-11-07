import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findCallbackMismatch } from '../src/services/paymentService';

const payment = { amount: '4000.00', phone: '254712345678' };
const items = (o: Record<string, string | number>) => Object.entries(o).map(([Name, Value]) => ({ Name, Value }));

test('callback that matches amount and phone passes', () => {
  assert.equal(findCallbackMismatch(payment, items({ Amount: 4000, PhoneNumber: 254712345678, MpesaReceiptNumber: 'QWE123' })), null);
});
test('wrong amount is rejected', () => {
  assert.match(findCallbackMismatch(payment, items({ Amount: 1, PhoneNumber: 254712345678 }))!, /amount mismatch/);
});
test('missing amount is rejected', () => {
  assert.match(findCallbackMismatch(payment, items({ PhoneNumber: 254712345678 }))!, /amount mismatch/);
});
test('different phone number is rejected', () => {
  assert.equal(findCallbackMismatch(payment, items({ Amount: 4000, PhoneNumber: 254799999999 })), 'phone mismatch');
});
test('masked phone is not compared (amount still is)', () => {
  assert.equal(findCallbackMismatch(payment, items({ Amount: 4000, PhoneNumber: 'a1b2c3hashed' })), null);
});
test('no metadata (status poll) is not a mismatch', () => {
  assert.equal(findCallbackMismatch(payment, undefined), null);
});
