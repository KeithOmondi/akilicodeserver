import { Response } from 'express';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import env from '../config/env';

/** Anything with these fields can be turned into a login. Extra fields are IGNORED. */
interface TokenSubject {
  id: string;
  role: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  parent_id?: string | null;
  username?: string | null;
  [key: string]: unknown; // database rows carry many more columns; they are never signed
}

const signToken = (payload: object, secret: Secret, expiresIn: string | number) => {
  const options: SignOptions = { expiresIn: expiresIn as any };
  return jwt.sign(payload, secret, options);
};

/**
 * The token payload is an explicit allow-list. A database row must NEVER be
 * passed to jwt.sign directly: the payload is only base64-encoded, so anything
 * in it (e.g. password or PIN hashes) is readable by whoever holds the token.
 */
export const buildTokenPayload = (e: TokenSubject) => ({
  id: e.id,
  role: e.role,
  name: e.name,
  ...(e.email ? { email: e.email } : {}),
  ...(e.phone ? { phone: e.phone } : {}),
  ...(e.role === 'kid' && e.parent_id ? { parent_id: e.parent_id } : {}),
  ...(e.role === 'kid' && e.username ? { username: e.username } : {}),
});

export const sendToken = (entity: TokenSubject, statusCode: number, res: Response, dataKey: 'user' | 'kid' = 'user') => {
  const payload = buildTokenPayload(entity);
  const accessToken = signToken(payload, env.JWT_ACCESS_SECRET as Secret, env.JWT_ACCESS_EXPIRES_IN);
  const refreshToken = signToken(payload, env.JWT_REFRESH_SECRET as Secret, env.JWT_REFRESH_EXPIRES_IN);

  res.cookie('refreshToken', refreshToken, {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: env.IS_PRODUCTION,
    sameSite: 'lax' as const,
  });

  res.status(statusCode).json({
    status: 'success',
    accessToken,
    data: {
      [dataKey]: {
        id: entity.id,
        name: entity.name,
        role: entity.role,
        ...(entity.email && { email: entity.email }),
        ...(entity.phone && { phone: entity.phone }),
        ...(dataKey === 'kid' && entity.avatar ? { avatar: entity.avatar } : {}),
        ...(dataKey === 'kid' && entity.username ? { username: entity.username } : {}),
      },
    },
  });
};
