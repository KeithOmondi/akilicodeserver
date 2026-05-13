import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { IUser } from '../interfaces/user.interface';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

// Start free trial for a kid
export const startFreeTrial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kid_id, course_id } = req.body;
    
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return next(new AppError('You must be logged in to start a free trial', 401));
    }
    
    const parent_id = req.user.id;

    if (!kid_id || !course_id) {
      return next(new AppError('Please provide kid_id and course_id', 400));
    }

    // Verify kid belongs to parent
    const kidCheck = await pool.query(
      'SELECT id FROM kids WHERE id = $1 AND parent_id = $2',
      [kid_id, parent_id]
    );
    if (kidCheck.rows.length === 0) {
      return next(new AppError('Kid not found or does not belong to you', 404));
    }

    // Get course trial duration
    const courseResult = await pool.query(
      'SELECT trial_duration_days, is_trial_available FROM courses WHERE id = $1',
      [course_id]
    );
    
    if (courseResult.rows.length === 0) {
      return next(new AppError('Course not found', 404));
    }

    const course = courseResult.rows[0];
    
    if (!course.is_trial_available) {
      return next(new AppError('Free trial is not available for this course', 400));
    }

    // Check if kid already had a trial for this course
    const existingTrial = await pool.query(
      `SELECT * FROM trial_access 
       WHERE kid_id = $1 AND course_id = $2 
       AND status IN ('active', 'expired')`,
      [kid_id, course_id]
    );

    if (existingTrial.rows.length > 0) {
      return next(new AppError('Trial already used for this course', 400));
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + course.trial_duration_days);

    // Create trial access
    const result = await pool.query(
      `INSERT INTO trial_access (kid_id, course_id, expires_at, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING *`,
      [kid_id, course_id, expiresAt]
    );

    res.status(201).json({
      status: 'success',
      data: {
        trial: {
          ...result.rows[0],
          expires_at: expiresAt,
          duration_days: course.trial_duration_days
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Check if kid has active trial for a course
export const checkTrialStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kid_id, course_id } = req.params;
    
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return next(new AppError('You must be logged in to check trial status', 401));
    }
    
    const parent_id = req.user.id;

    // Verify kid belongs to parent
    const kidCheck = await pool.query(
      'SELECT id FROM kids WHERE id = $1 AND parent_id = $2',
      [kid_id, parent_id]
    );
    if (kidCheck.rows.length === 0) {
      return next(new AppError('Kid not found or does not belong to you', 404));
    }

    const result = await pool.query(
      `SELECT 
        t.*,
        c.trial_duration_days,
        EXTRACT(DAY FROM (t.expires_at - NOW()))::int AS days_remaining
       FROM trial_access t
       JOIN courses c ON c.id = t.course_id
       WHERE t.kid_id = $1 
       AND t.course_id = $2
       AND t.status = 'active'
       AND t.expires_at > NOW()`,
      [kid_id, course_id]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        status: 'success',
        data: { hasActiveTrial: false }
      });
    }

    const trial = result.rows[0];
    
    res.status(200).json({
      status: 'success',
      data: {
        hasActiveTrial: true,
        trial: {
          id: trial.id,
          kid_id: trial.kid_id,
          course_id: trial.course_id,
          started_at: trial.started_at,
          expires_at: trial.expires_at,
          days_remaining: parseInt(trial.days_remaining) || 0,
          duration_days: trial.trial_duration_days,
          is_expiring_soon: parseInt(trial.days_remaining) <= 2 && parseInt(trial.days_remaining) > 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all active trials for a parent's kids
export const getActiveTrials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return next(new AppError('You must be logged in to view trials', 401));
    }
    
    const parent_id = req.user.id;

    const result = await pool.query(
      `SELECT 
        t.*,
        k.name as kid_name,
        c.title as course_title,
        c.trial_duration_days,
        EXTRACT(DAY FROM (t.expires_at - NOW()))::int AS days_remaining
       FROM trial_access t
       JOIN kids k ON k.id = t.kid_id
       JOIN courses c ON c.id = t.course_id
       WHERE k.parent_id = $1 
       AND t.status = 'active'
       AND t.expires_at > NOW()
       ORDER BY t.expires_at ASC`,
      [parent_id]
    );

    const trialsWithDetails = result.rows.map(trial => ({
      ...trial,
      days_remaining: parseInt(trial.days_remaining) || 0,
      is_expiring_soon: parseInt(trial.days_remaining) <= 2 && parseInt(trial.days_remaining) > 0
    }));

    res.status(200).json({
      status: 'success',
      results: trialsWithDetails.length,
      data: { trials: trialsWithDetails }
    });
  } catch (error) {
    next(error);
  }
};

// Convert trial to paid enrollment
export const convertTrialToEnrollment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { trial_id } = req.params;
    const { enrollment_id } = req.body;
    
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return next(new AppError('You must be logged in to convert trial', 401));
    }

    if (!trial_id || !enrollment_id) {
      return next(new AppError('Please provide trial_id and enrollment_id', 400));
    }

    // Verify trial belongs to parent's kid
    const trialCheck = await pool.query(
      `SELECT t.id 
       FROM trial_access t
       JOIN kids k ON k.id = t.kid_id
       WHERE t.id = $1 AND k.parent_id = $2`,
      [trial_id, req.user.id]
    );
    
    if (trialCheck.rows.length === 0) {
      return next(new AppError('Trial not found or does not belong to you', 404));
    }

    await pool.query(
      `UPDATE trial_access 
       SET status = 'converted', updated_at = NOW()
       WHERE id = $1`,
      [trial_id]
    );

    res.status(200).json({
      status: 'success',
      message: 'Trial converted to paid enrollment successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Auto-expire trials (run this as a cron job)
export const expireOldTrials = async (): Promise<number> => {
  try {
    const result = await pool.query(
      `UPDATE trial_access 
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active' 
       AND expires_at < NOW()
       RETURNING id`
    );
    
    console.log(`Expired ${result.rows.length} trials`);
    return result.rows.length;
  } catch (error) {
    console.error('Error expiring trials:', error);
    return 0;
  }
};

// Get trial summary for a kid (for dashboard)
export const getTrialSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return next(new AppError('You must be logged in to view trial summary', 401));
    }
    
    const parent_id = req.user.id;

    const result = await pool.query(
      `SELECT 
        COUNT(DISTINCT t.id) as active_trials,
        COUNT(DISTINCT t.kid_id) as kids_with_trials,
        MIN(EXTRACT(DAY FROM (t.expires_at - NOW())))::int as min_days_remaining
       FROM trial_access t
       JOIN kids k ON k.id = t.kid_id
       WHERE k.parent_id = $1 
       AND t.status = 'active'
       AND t.expires_at > NOW()`,
      [parent_id]
    );

    const summary = result.rows[0];
    
    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          active_trials: parseInt(summary.active_trials) || 0,
          kids_with_trials: parseInt(summary.kids_with_trials) || 0,
          min_days_remaining: summary.min_days_remaining ? parseInt(summary.min_days_remaining) : null
        }
      }
    });
  } catch (error) {
    next(error);
  }
};