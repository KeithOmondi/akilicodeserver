import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { IJWTPayload, UserRole, IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

// Use Omit to clear the existing 'user' property and redefine it as a Union
interface AuthRequest extends Omit<Request, 'user'> {
  user?: IUser | IKid;
}

export const isAuthenticated = (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | undefined;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Unauthorized: No token provided.', 401));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as IJWTPayload;

    // Branch logic based on the role in the JWT
    if (decoded.role === 'kid') {
      req.user = {
        id: decoded.id,
        parent_id: decoded.parent_id || '',
        name: decoded.name,
        role: 'kid', 
        username: decoded.username,
        age: 0, // Placeholder or fetch from DB
        created_at: new Date()
      } as IKid;
    } else {
      req.user = {
        id: decoded.id,
        name: decoded.name,
        role: decoded.role, // 'admin' | 'parent'
        phone: decoded.phone,
        email: '', 
        is_verified: true,
        created_at: new Date()
      } as IUser;
    }

    next();
  } catch (error) {
    return next(new AppError('Unauthorized: Invalid token.', 401));
  }
};

export const isAuthorized = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('User context missing.', 500));
    }

    // Now that both IUser and IKid have a 'role' property, 
    // TypeScript allows this check.
    if (!roles.includes(req.user.role as UserRole)) {
      return next(new AppError(`Forbidden: ${req.user.role} role does not have access.`, 403));
    }

    next();
  };
};