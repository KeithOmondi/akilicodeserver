import { Response } from 'express';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import env from '../config/env';

interface TokenPayload {
  id: string;
  role: string;
  name: string;
  phone?: string;
  email?: string;
}

const signToken = (payload: TokenPayload, secret: Secret, expiresIn: string | number) => {
  const options: SignOptions = { expiresIn: expiresIn as any };
  return jwt.sign(payload, secret, options);
};

export const sendToken = (entity: TokenPayload, statusCode: number, res: Response, dataKey: 'user' | 'kid' = 'user') => {
  const accessSecret = env.JWT_ACCESS_SECRET as Secret;
  const refreshSecret = env.JWT_REFRESH_SECRET as Secret;

  const accessToken = signToken(entity, accessSecret, env.JWT_ACCESS_EXPIRES_IN);
  const refreshToken = signToken(entity, refreshSecret, env.JWT_REFRESH_EXPIRES_IN);

  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };

  res.cookie('refreshToken', refreshToken, cookieOptions);

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
      },
    },
  });
};