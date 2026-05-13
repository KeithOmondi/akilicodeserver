import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { CreateTestimonialDTO, UpdateTestimonialDTO } from '../interfaces/testimonial.interface';

// No need to redeclare AuthRequest - use Request directly from express
// The global declaration already adds user?: IUser to Request

// ─── Helper Functions ────────────────────────────────────────────────────────

// Check if parent has a completed (paid) enrollment for a kid
const hasCompletedEnrollment = async (parentId: string, kidId: string): Promise<{ hasCompleted: boolean; enrollmentId?: string; courseName?: string }> => {
  const result = await pool.query(
    `SELECT e.id, e.status, e.payment_status, e.course_name
     FROM enrollments e
     WHERE e.kid_id = $1 
       AND e.parent_id = $2
       AND e.status = 'active'
       AND e.payment_status IN ('paid', 'completed', 'once-off')
     LIMIT 1`,
    [kidId, parentId]
  );
  
  if (result.rows.length === 0) {
    return { hasCompleted: false };
  }
  
  return { 
    hasCompleted: true, 
    enrollmentId: result.rows[0].id,
    courseName: result.rows[0].course_name
  };
};

// Check if parent already left a testimonial for this enrollment
const hasExistingTestimonial = async (enrollmentId: string): Promise<boolean> => {
  const result = await pool.query(
    'SELECT id FROM testimonials WHERE enrollment_id = $1',
    [enrollmentId]
  );
  return result.rows.length > 0;
};

// ─── Public Endpoints ────────────────────────────────────────────────────────

// Get approved testimonials (public)
export const getApprovedTestimonials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = 10, featured, rating } = req.query;
    
    let query = `
      SELECT 
        t.id,
        t.rating,
        t.title,
        t.content,
        t.child_name,
        t.child_age,
        t.achievement,
        t.is_verified,
        t.is_featured,
        t.created_at,
        u.name as parent_name,
        e.course_name
      FROM testimonials t
      JOIN users u ON u.id = t.parent_id
      JOIN enrollments e ON e.id = t.enrollment_id
      WHERE t.status = 'approved'
    `;
    
    const queryParams: any[] = [];
    let paramIndex = 1;
    
    if (featured === 'true') {
      query += ` AND t.is_featured = true`;
    }
    
    if (rating) {
      query += ` AND t.rating = $${paramIndex}`;
      queryParams.push(rating);
      paramIndex++;
    }
    
    query += ` ORDER BY t.is_featured DESC, t.created_at DESC LIMIT $${paramIndex}`;
    queryParams.push(limit);
    
    const result = await pool.query(query, queryParams);
    
    res.status(200).json({
      status: 'success',
      data: { testimonials: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// Get testimonial stats (public)
export const getTestimonialStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_testimonials,
        COALESCE(AVG(rating), 0)::DECIMAL(3,2) as average_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star_count,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star_count,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star_count,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star_count,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star_count
      FROM testimonials
      WHERE status = 'approved'
    `);
    
    const stats = result.rows[0] || {
      total_testimonials: 0,
      average_rating: 0,
      five_star_count: 0,
      four_star_count: 0,
      three_star_count: 0,
      two_star_count: 0,
      one_star_count: 0
    };
    
    res.status(200).json({
      status: 'success',
      data: { stats }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Parent Endpoints (Authenticated) ────────────────────────────────────────

// Check if parent can leave a testimonial for a kid
export const canLeaveTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kidId } = req.params;
    const parentId = req.user?.id;
    
    if (!parentId) {
      return next(new AppError('Not authenticated', 401));
    }
    
    // Ensure kidId is a string
    const kidIdString = Array.isArray(kidId) ? kidId[0] : kidId;
    
    if (!kidIdString) {
      return next(new AppError('Kid ID is required', 400));
    }
    
    const { hasCompleted, enrollmentId, courseName } = await hasCompletedEnrollment(parentId, kidIdString);
    
    if (!hasCompleted) {
      return res.status(200).json({
        status: 'success',
        data: { 
          canLeave: false, 
          reason: 'You need to have a completed paid enrollment to leave a testimonial. Please complete your payment first.' 
        }
      });
    }
    
    const hasExisting = await hasExistingTestimonial(enrollmentId!);
    
    if (hasExisting) {
      return res.status(200).json({
        status: 'success',
        data: { canLeave: false, reason: 'You have already left a testimonial for this enrollment' }
      });
    }
    
    res.status(200).json({
      status: 'success',
      data: { 
        canLeave: true, 
        enrollmentId,
        courseName 
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create testimonial
export const createTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kid_id, rating, title, content, child_name, child_age, achievement } = req.body as CreateTestimonialDTO;
    const parentId = req.user?.id;
    
    if (!parentId) {
      return next(new AppError('Not authenticated', 401));
    }
    
    // Ensure kid_id is a string
    const kidIdString = Array.isArray(kid_id) ? kid_id[0] : kid_id;
    
    if (!kidIdString) {
      return next(new AppError('Kid ID is required', 400));
    }
    
    if (!rating || rating < 1 || rating > 5) {
      return next(new AppError('Valid rating (1-5) is required', 400));
    }
    
    if (!content || content.trim().length < 10) {
      return next(new AppError('Testimonial content must be at least 10 characters', 400));
    }
    
    // Verify completed enrollment
    const { hasCompleted, enrollmentId } = await hasCompletedEnrollment(parentId, kidIdString);
    
    if (!hasCompleted || !enrollmentId) {
      return next(new AppError('You must have a completed paid enrollment to leave a testimonial. Please complete your payment first.', 403));
    }
    
    // Check if already left testimonial
    const hasExisting = await hasExistingTestimonial(enrollmentId);
    
    if (hasExisting) {
      return next(new AppError('You have already left a testimonial for this enrollment', 400));
    }
    
    // Get kid's name if not provided
    let finalChildName = child_name;
    if (!finalChildName) {
      const kidResult = await pool.query('SELECT name FROM kids WHERE id = $1', [kidIdString]);
      if (kidResult.rows.length > 0) {
        finalChildName = kidResult.rows[0].name;
      }
    }
    
    const result = await pool.query(
      `INSERT INTO testimonials 
        (parent_id, kid_id, enrollment_id, rating, title, content, child_name, child_age, achievement, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING *`,
      [parentId, kidIdString, enrollmentId, rating, title || null, content, finalChildName || null, child_age || null, achievement || null]
    );
    
    res.status(201).json({
      status: 'success',
      message: 'Thank you for your feedback! Your testimonial has been submitted and is pending review by our team.',
      data: { testimonial: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Get parent's own testimonials
export const getMyTestimonials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parentId = req.user?.id;
    
    if (!parentId) {
      return next(new AppError('Not authenticated', 401));
    }
    
    const result = await pool.query(
      `SELECT 
        t.*,
        k.name as kid_name,
        e.course_name
       FROM testimonials t
       JOIN kids k ON k.id = t.kid_id
       JOIN enrollments e ON e.id = t.enrollment_id
       WHERE t.parent_id = $1
       ORDER BY t.created_at DESC`,
      [parentId]
    );
    
    res.status(200).json({
      status: 'success',
      data: { testimonials: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// Update testimonial (only if pending)
export const updateTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testimonialId } = req.params;
    const parentId = req.user?.id;
    const updates = req.body as UpdateTestimonialDTO;
    
    if (!parentId) {
      return next(new AppError('Not authenticated', 401));
    }
    
    // Check ownership and status
    const checkResult = await pool.query(
      'SELECT status FROM testimonials WHERE id = $1 AND parent_id = $2',
      [testimonialId, parentId]
    );
    
    if (checkResult.rows.length === 0) {
      return next(new AppError('Testimonial not found', 404));
    }
    
    if (checkResult.rows[0].status !== 'pending') {
      return next(new AppError('Cannot update testimonial after approval/rejection', 400));
    }
    
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    if (updates.rating !== undefined) {
      setClauses.push(`rating = $${paramIndex++}`);
      values.push(updates.rating);
    }
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.achievement !== undefined) {
      setClauses.push(`achievement = $${paramIndex++}`);
      values.push(updates.achievement);
    }
    
    setClauses.push(`updated_at = NOW()`);
    values.push(testimonialId);
    
    const result = await pool.query(
      `UPDATE testimonials SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Testimonial updated successfully',
      data: { testimonial: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Delete testimonial (parent can delete only if pending)
export const deleteMyTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testimonialId } = req.params;
    const parentId = req.user?.id;
    
    if (!parentId) {
      return next(new AppError('Not authenticated', 401));
    }
    
    // Check ownership and status
    const checkResult = await pool.query(
      'SELECT status FROM testimonials WHERE id = $1 AND parent_id = $2',
      [testimonialId, parentId]
    );
    
    if (checkResult.rows.length === 0) {
      return next(new AppError('Testimonial not found', 404));
    }
    
    if (checkResult.rows[0].status !== 'pending') {
      return next(new AppError('Cannot delete testimonial after approval/rejection', 400));
    }
    
    await pool.query('DELETE FROM testimonials WHERE id = $1', [testimonialId]);
    
    res.status(200).json({
      status: 'success',
      message: 'Testimonial deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// ─── Admin Endpoints ─────────────────────────────────────────────────────────

// Get all testimonials (admin)
export const getAllTestimonials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, rating, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        t.*,
        u.name as parent_name,
        u.email as parent_email,
        k.name as kid_name,
        e.course_name
      FROM testimonials t
      JOIN users u ON u.id = t.parent_id
      JOIN kids k ON k.id = t.kid_id
      JOIN enrollments e ON e.id = t.enrollment_id
      WHERE 1=1
    `;
    
    const queryParams: any[] = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND t.status = $${paramIndex++}`;
      queryParams.push(status);
    }
    
    if (rating) {
      query += ` AND t.rating = $${paramIndex++}`;
      queryParams.push(rating);
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    queryParams.push(limit, offset);
    
    const result = await pool.query(query, queryParams);
    
    const countResult = await pool.query('SELECT COUNT(*) FROM testimonials');
    
    res.status(200).json({
      status: 'success',
      data: {
        testimonials: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          limit: Number(limit),
          offset: Number(offset)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Approve testimonial
export const approveTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testimonialId } = req.params;
    const { admin_note } = req.body;
    
    const result = await pool.query(
      `UPDATE testimonials 
       SET status = 'approved', 
           updated_at = NOW(), 
           is_verified = true,
           admin_note = COALESCE($1, admin_note)
       WHERE id = $2
       RETURNING *`,
      [admin_note || null, testimonialId]
    );
    
    if (result.rows.length === 0) {
      return next(new AppError('Testimonial not found', 404));
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Testimonial approved successfully',
      data: { testimonial: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Reject testimonial
export const rejectTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testimonialId } = req.params;
    const { admin_note } = req.body;
    
    if (!admin_note) {
      return next(new AppError('Please provide a reason for rejection', 400));
    }
    
    const result = await pool.query(
      `UPDATE testimonials 
       SET status = 'rejected', 
           updated_at = NOW(), 
           is_verified = false, 
           admin_note = $1
       WHERE id = $2
       RETURNING *`,
      [admin_note, testimonialId]
    );
    
    if (result.rows.length === 0) {
      return next(new AppError('Testimonial not found', 404));
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Testimonial rejected',
      data: { testimonial: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Toggle featured status
export const toggleFeatured = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testimonialId } = req.params;
    
    const result = await pool.query(
      `UPDATE testimonials 
       SET is_featured = NOT is_featured, 
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [testimonialId]
    );
    
    if (result.rows.length === 0) {
      return next(new AppError('Testimonial not found', 404));
    }
    
    res.status(200).json({
      status: 'success',
      message: result.rows[0].is_featured ? 'Testimonial featured on homepage' : 'Testimonial removed from featured',
      data: { testimonial: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// Delete testimonial (admin)
export const deleteTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testimonialId } = req.params;
    
    const result = await pool.query('DELETE FROM testimonials WHERE id = $1 RETURNING id', [testimonialId]);
    
    if (result.rows.length === 0) {
      return next(new AppError('Testimonial not found', 404));
    }
    
    res.status(200).json({
      status: 'success',
      message: 'Testimonial deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};