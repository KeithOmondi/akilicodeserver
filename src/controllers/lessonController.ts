import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';

// ─── MODULES ──────────────────────────────────────────────────────────────────

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

// ─── LESSONS ──────────────────────────────────────────────────────────────────

export const createLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      module_id,
      title,
      lesson_type,      // 'notes' | 'coding' | 'scratch'
      notes,
      language,
      starter_code,
      solution_code,
      expected_output,  // used for auto-grading coding & scratch
      order_index,
    } = req.body;

    if (!module_id || !title) {
      return next(new AppError('Please provide module_id and title.', 400));
    }

    const validTypes = ['notes', 'coding', 'scratch'];
    const type = lesson_type && validTypes.includes(lesson_type) ? lesson_type : 'notes';

    const moduleCheck = await pool.query('SELECT id FROM modules WHERE id = $1', [module_id]);
    if (moduleCheck.rows.length === 0) {
      return next(new AppError('Module not found.', 404));
    }

    const result = await pool.query(
      `INSERT INTO lessons
        (module_id, title, lesson_type, notes, language, starter_code, solution_code, expected_output, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        module_id,
        title,
        type,
        notes          ?? null,
        language       ?? null,
        starter_code   ?? null,
        solution_code  ?? null,
        expected_output ?? null,
        order_index    ?? 0,
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

    // Fetch lesson with module info
    const lessonResult = await pool.query(
      `SELECT 
        l.*,
        m.title AS module_title,
        m.course_id
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       WHERE l.id = $1`,
      [lessonId]
    );

    if (lessonResult.rows.length === 0) {
      return next(new AppError('Lesson not found.', 404));
    }

    const lesson = lessonResult.rows[0];

    // Always fetch questions — frontend decides whether to show them
    const questionsResult = await pool.query(
      `SELECT id, question, options, answer, order_index
       FROM lesson_questions
       WHERE lesson_id = $1
       ORDER BY order_index ASC`,
      [lessonId]
    );

    res.status(200).json({
      status: 'success',
      data: {
        lesson: {
          ...lesson,
          questions: questionsResult.rows,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const {
      title,
      lesson_type,
      notes,
      language,
      starter_code,
      solution_code,
      expected_output,
      order_index,
    } = req.body;

    const validTypes = ['notes', 'coding', 'scratch'];
    const type = lesson_type && validTypes.includes(lesson_type) ? lesson_type : null;

    const result = await pool.query(
      `UPDATE lessons
       SET
         title           = COALESCE($1, title),
         lesson_type     = COALESCE($2, lesson_type),
         notes           = COALESCE($3, notes),
         language        = COALESCE($4, language),
         starter_code    = COALESCE($5, starter_code),
         solution_code   = COALESCE($6, solution_code),
         expected_output = COALESCE($7, expected_output),
         order_index     = COALESCE($8, order_index)
       WHERE id = $9
       RETURNING *`,
      [
        title          ?? null,
        type,
        notes          ?? null,
        language       ?? null,
        starter_code   ?? null,
        solution_code  ?? null,
        expected_output ?? null,
        order_index    ?? null,
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

// ─── QUIZ QUESTIONS ───────────────────────────────────────────────────────────
// Used for 'notes' lessons (quiz at end) and optionally 'scratch'/'coding' too.

/**
 * POST /lessons/:lessonId/questions
 * Body: { question, options: string[], answer: number, order_index? }
 */
export const addQuestion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const { question, options, answer, order_index } = req.body;

    if (!question || !options || !Array.isArray(options) || options.length < 2) {
      return next(new AppError('Please provide a question and at least 2 options.', 400));
    }
    if (typeof answer !== 'number' || answer < 0 || answer >= options.length) {
      return next(new AppError('Answer must be a valid index into the options array.', 400));
    }

    const lessonCheck = await pool.query('SELECT id FROM lessons WHERE id = $1', [lessonId]);
    if (lessonCheck.rows.length === 0) {
      return next(new AppError('Lesson not found.', 404));
    }

    const result = await pool.query(
      `INSERT INTO lesson_questions (lesson_id, question, options, answer, order_index)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [lessonId, question, JSON.stringify(options), answer, order_index ?? 0]
    );

    res.status(201).json({ status: 'success', data: { question: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /lessons/:lessonId/questions
 */
export const getQuestions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;

    const result = await pool.query(
      `SELECT id, question, options, answer, order_index
       FROM lesson_questions
       WHERE lesson_id = $1
       ORDER BY order_index ASC`,
      [lessonId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { questions: result.rows },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /lessons/questions/:questionId
 * Body: any subset of { question, options, answer, order_index }
 */
export const updateQuestion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { questionId } = req.params;
    const { question, options, answer, order_index } = req.body;

    const result = await pool.query(
      `UPDATE lesson_questions
       SET
         question    = COALESCE($1, question),
         options     = COALESCE($2, options),
         answer      = COALESCE($3, answer),
         order_index = COALESCE($4, order_index)
       WHERE id = $5
       RETURNING *`,
      [
        question    ?? null,
        options     ? JSON.stringify(options) : null,
        answer      ?? null,
        order_index ?? null,
        questionId,
      ]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Question not found.', 404));
    }

    res.status(200).json({ status: 'success', data: { question: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /lessons/questions/:questionId
 */
export const deleteQuestion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { questionId } = req.params;

    const result = await pool.query(
      'DELETE FROM lesson_questions WHERE id = $1 RETURNING id',
      [questionId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Question not found.', 404));
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// ─── FULL COURSE CURRICULUM (public) ─────────────────────────────────────────

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

    // Fetch lessons with their question count so the sidebar can show indicators
    const lessonsResult = await pool.query(
      `SELECT 
        l.*,
        COUNT(q.id)::int AS question_count
       FROM lessons l
       LEFT JOIN lesson_questions q ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       WHERE m.course_id = $1
       GROUP BY l.id
       ORDER BY l.order_index ASC`,
      [courseId]
    );

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