import { Response } from 'express';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import env from '../config/env';
import { IUser } from '../interfaces/user.interface'; // Import your interface

/**
 * Update signToken to accept the full payload info
 */
const signToken = (user: IUser, secret: Secret, expiresIn: string | number) => {
  const options: SignOptions = {
    expiresIn: expiresIn as any
  };

  // We pack all the necessary info into the payload
  return jwt.sign(
    { 
      id: user.id, 
      role: user.role, 
      name: user.name, 
      phone: user.phone 
    }, 
    secret, 
    options
  );
};

export const sendToken = (user: IUser, statusCode: number, res: Response) => {
  const accessSecret = env.JWT_ACCESS_SECRET as Secret;
  const refreshSecret = env.JWT_REFRESH_SECRET as Secret;

  // 1. Create Tokens using the full user object
  const accessToken = signToken(user, accessSecret, env.JWT_ACCESS_EXPIRES_IN);
  const refreshToken = signToken(user, refreshSecret, env.JWT_REFRESH_EXPIRES_IN);

  // 2. Setup Cookie Options
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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
    },
  });
};