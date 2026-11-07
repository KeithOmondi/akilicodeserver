import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { getScreenTimeStatus } from '../services/screenTime';

/** Blocks lessons once the parent's daily limit is used up. Put on child learning routes. */
export const enforceScreenTime = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const kidId = (req.user as { id?: string; role?: string } | undefined);
    if (!kidId?.id || kidId.role !== 'kid') return next();
    const s = await getScreenTimeStatus(kidId.id);
    if (s?.locked) {
      const err = new AppError('Great work today! Your screen time is finished. See you tomorrow!', 403);
      (err as AppError & { code?: string }).code = 'SCREEN_TIME_UP';
      return next(err);
    }
    next();
  } catch (error) {
    next(error);
  }
};
