import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';

// ─── MODULES ─────────────────────────────────────────────────────────────────

export const createModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { course_id, title, description, order_index } = req.body;

    if (!course_id || !title) {
      return next(new AppError('Please provide course_id and title.', 400));
    }

    const courseCheck = await pool.query('SELECT id FROM courses WHERE id = $1', [course_id]);
    if (courseCheck.rows.length === 0) {
      return next(new AppError('Course not found.', 404));
    }

    const result = await pool.query(
      `INSERT INTO modules (course_id, title, description, order_index)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [course_id, title, description ?? null, order_index ?? 0]
    );

    res.status(201).json({ status: 'success', data: { module: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const getModulesByCourse = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.params;

    const result = await pool.query(
      `SELECT 
        m.*,
        COUNT(l.id)::int AS lesson_count
       FROM modules m
       LEFT JOIN lessons l ON l.module_id = m.id
       WHERE m.course_id = $1
       GROUP BY m.id
       ORDER BY m.order_index ASC`,
      [courseId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { modules: result.rows },
    });
  } catch (error) {
    next(error);
  }
};

export const updateModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moduleId } = req.params;
    const { title, description, order_index } = req.body;

    const result = await pool.query(
      `UPDATE modules
       SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         order_index = COALESCE($3, order_index)
       WHERE id = $4
       RETURNING *`,
      [title ?? null, description ?? null, order_index ?? null, moduleId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Module not found.', 404));
    }

    res.status(200).json({ status: 'success', data: { module: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const deleteModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moduleId } = req.params;

    const result = await pool.query('DELETE FROM modules WHERE id = $1 RETURNING id', [moduleId]);

    if (result.rows.length === 0) {
      return next(new AppError('Module not found.', 404));
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// ─── LESSONS ─────────────────────────────────────────────────────────────────

export const createLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { module_id, title, notes, language, starter_code, solution_code, order_index } =
      req.body;

    if (!module_id || !title) {
      return next(new AppError('Please provide module_id and title.', 400));
    }

    const moduleCheck = await pool.query('SELECT id FROM modules WHERE id = $1', [module_id]);
    if (moduleCheck.rows.length === 0) {
      return next(new AppError('Module not found.', 404));
    }

    const result = await pool.query(
      `INSERT INTO lessons
        (module_id, title, notes, language, starter_code, solution_code, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        module_id,
        title,
        notes ?? null,
        language ?? null,
        starter_code ?? null,
        solution_code ?? null,
        order_index ?? 0,
      ]
    );

    res.status(201).json({ status: 'success', data: { lesson: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const getLessonsByModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moduleId } = req.params;

    const result = await pool.query(
      `SELECT * FROM lessons WHERE module_id = $1 ORDER BY order_index ASC`,
      [moduleId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { lessons: result.rows },
    });
  } catch (error) {
    next(error);
  }
};

export const getLessonById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;

    const result = await pool.query(
      `SELECT 
        l.*,
        m.title AS module_title,
        m.course_id
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       WHERE l.id = $1`,
      [lessonId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Lesson not found.', 404));
    }

    res.status(200).json({ status: 'success', data: { lesson: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const updateLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const { title, notes, language, starter_code, solution_code, order_index } = req.body;

    const result = await pool.query(
      `UPDATE lessons
       SET
         title         = COALESCE($1, title),
         notes         = COALESCE($2, notes),
         language      = COALESCE($3, language),
         starter_code  = COALESCE($4, starter_code),
         solution_code = COALESCE($5, solution_code),
         order_index   = COALESCE($6, order_index)
       WHERE id = $7
       RETURNING *`,
      [
        title ?? null,
        notes ?? null,
        language ?? null,
        starter_code ?? null,
        solution_code ?? null,
        order_index ?? null,
        lessonId,
      ]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Lesson not found.', 404));
    }

    res.status(200).json({ status: 'success', data: { lesson: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

export const deleteLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;

    const result = await pool.query('DELETE FROM lessons WHERE id = $1 RETURNING id', [lessonId]);

    if (result.rows.length === 0) {
      return next(new AppError('Lesson not found.', 404));
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// ─── FULL COURSE CURRICULUM (public) ─────────────────────────────────────────
// Returns a course with all its modules and lessons nested — used by the frontend
// to render the full curriculum view.

export const getCourseCurriculum = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.params;

    const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (courseResult.rows.length === 0) {
      return next(new AppError('Course not found.', 404));
    }

    const modulesResult = await pool.query(
      `SELECT * FROM modules WHERE course_id = $1 ORDER BY order_index ASC`,
      [courseId]
    );

    const lessonsResult = await pool.query(
      `SELECT l.* FROM lessons l
       JOIN modules m ON l.module_id = m.id
       WHERE m.course_id = $1
       ORDER BY l.order_index ASC`,
      [courseId]
    );

    // Nest lessons under their module
    const modules = modulesResult.rows.map((mod) => ({
      ...mod,
      lessons: lessonsResult.rows.filter((l) => l.module_id === mod.id),
    }));

    res.status(200).json({
      status: 'success',
      data: {
        course: {
          ...courseResult.rows[0],
          modules,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};