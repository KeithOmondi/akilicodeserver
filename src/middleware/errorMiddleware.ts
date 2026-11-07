import { Request, Response, NextFunction } from 'express';
import env from '../config/env';

export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // body-parser errors are the client's fault, not a server crash
  if (err.type === 'entity.too.large') {
    err.statusCode = 413; err.isOperational = true; err.status = 'fail';
    err.message = 'That is too large to send. Please shorten it and try again.';
  } else if (err.type === 'entity.parse.failed') {
    err.statusCode = 400; err.isOperational = true; err.status = 'fail';
    err.message = 'The request was not valid JSON.';
  }
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (!env.IS_PRODUCTION && env.NODE_ENV === 'development') {
    // In Dev: Give us all the details
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      stack: err.stack,
    });
  } else {
    // In Prod: Keep it vague and professional
    if (err.isOperational) {
      res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
    } else {
      // Programming or unknown error: don't leak details
      console.error('ERROR 💥', err);
      res.status(500).json({
        status: 'error',
        message: 'Something went very wrong!',
      });
    }
  }
};