import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { IJWTPayload, UserRole, IUser } from '../interfaces/user.interface';

// 1. Create a local interface for the Authenticated Request
interface AuthRequest extends Request {
  user?: IUser;
}

export const isAuthenticated = (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | undefined;

  // 1. Extract token from Header
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Unauthorized: No token provided.', 401));
  }

  try {
    // 2. Verify Token
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as IJWTPayload;

    // 3. Attach User to Request
    // We cast to IUser to ensure we satisfy your interface requirements
    req.user = {
      id: decoded.id,
      name: decoded.name,
      role: decoded.role,
      phone: decoded.phone, 
      email: '',            // Placeholder
      createdAt: new Date() 
    } as IUser;

    next();
  } catch (error) {
    const message = error instanceof jwt.TokenExpiredError 
      ? 'Token expired. Please refresh.' 
      : 'Invalid token.';
    return next(new AppError(`Unauthorized: ${message}`, 401));
  }
};

export const isAuthorized = (...roles: UserRole[]) => {
  // Use AuthRequest here so the compiler knows req.user exists
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Internal Server Error: User context missing.', 500));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError(`Forbidden: ${req.user.role} role does not have access.`, 403));
    }

    next();
  };
};