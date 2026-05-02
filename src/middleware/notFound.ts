import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  // We pass the error to next() so the Global Error Handler catches it
  const error = new AppError(`Route not found: ${req.originalUrl}`, 404);
  next(error);
};