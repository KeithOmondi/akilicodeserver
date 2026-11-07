import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { AppError } from '../utils/appError';

type Source = 'body' | 'query' | 'params';

/**
 * Validate and replace req[source] with the parsed (trimmed, typed) value.
 * Schemas use zod's default "strip" behaviour, so unknown keys such as `role`
 * never reach handlers.
 */
export const validate =
  (schema: ZodTypeAny, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError(firstMessage(result.error), 400));
    }
    // Express 5 makes req.query a getter, so define instead of assign.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };

const firstMessage = (err: ZodError) => {
  const issue = err.issues[0];
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
};
