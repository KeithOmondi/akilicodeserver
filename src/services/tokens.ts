import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env';

/**
 * Short-purpose tokens, each signed with its own derived key so a token made for
 * one purpose can never be replayed as another (or as a login token).
 */
const keyFor = (purpose: string) =>
  crypto.createHash('sha256').update(`${purpose}:${env.JWT_REFRESH_SECRET}`).digest();

export const GATE_TTL_SECONDS = 10 * 60;
export const DEVICE_TTL_DAYS = 30;

/** Proof that the parent re-entered their password / an SMS code a moment ago. */
export const signGateToken = (userId: string) =>
  jwt.sign({ typ: 'gate' }, keyFor('gate'), { subject: userId, expiresIn: GATE_TTL_SECONDS });

export const verifyGateToken = (token: string, userId: string): boolean => {
  try {
    const p = jwt.verify(token, keyFor('gate')) as jwt.JwtPayload;
    return p.typ === 'gate' && p.sub === userId;
  } catch {
    return false;
  }
};

/** Marks a browser as "family device": lets the child picker list this parent's children. */
export const signDeviceToken = (parentId: string) =>
  jwt.sign({ typ: 'device' }, keyFor('device'), { subject: parentId, expiresIn: `${DEVICE_TTL_DAYS}d` });

export const verifyDeviceToken = (token: string): string | null => {
  try {
    const p = jwt.verify(token, keyFor('device')) as jwt.JwtPayload;
    return p.typ === 'device' && typeof p.sub === 'string' ? p.sub : null;
  } catch {
    return null;
  }
};
