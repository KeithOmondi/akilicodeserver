import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env';
import { AppError } from '../utils/appError';
import { IJWTPayload, UserRole, IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

// Type guard — narrows req.user to IKid
export const isKidUser = (user: IUser | IKid): user is IKid => user.role === 'kid';

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  let token: string | undefined;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Unauthorized: No token provided.', 401));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as IJWTPayload;

    if (decoded.role === 'kid') {
      if (!decoded.parent_id) {
        return next(new AppError('Unauthorized: Malformed kid token.', 401));
      }

      const kidUser: IKid = {
        id: decoded.id,
        parent_id: decoded.parent_id,
        name: decoded.name,
        username: decoded.username,
        role: 'kid',
        age: 0,
        created_at: new Date(),
      };
      req.user = kidUser as any;
    } else {
      const regularUser: IUser = {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email ?? '',
        phone: decoded.phone ?? '',
        role: decoded.role,
        is_verified: true,
        created_at: new Date(),
      };
      req.user = regularUser as any;
    }

    next();
  } catch (error) {
    return next(new AppError('Unauthorized: Invalid token.', 401));
  }
};

export const isAuthorized = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('User context missing.', 500));
    }

    const user = req.user as any as IUser | IKid;

    if (!roles.includes(user.role as UserRole)) {
      return next(new AppError(`Forbidden: ${user.role} role does not have access.`, 403));
    }

    next();
  };
};

export const isAdmin = isAuthorized('admin');
export const isParent = isAuthorized('parent');
export const isKid = isAuthorized('kid');
export const isParentOrAdmin = isAuthorized('parent', 'admin');