import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { trialStillValid } from '../utils/trial';

// ──────────────────────────────────────────────────────────────────
// MODULES (unchanged – they work fine)
// ──────────────────────────────────────────────────────────────────

export const createCourse = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, price, duration, category, image_url, age_groups, path_order } = req.body;

    if (!title || !price) {
      return next(new AppError('Please provide title, price, and duration.', 400));
    }

    const result = await pool.query(
      `INSERT INTO courses (title, description, price, duration, category, image_url, age_groups, path_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description ?? null, price, duration ?? null, category ?? null, image_url ?? null, age_groups?.length ? age_groups : null, path_order ?? 0]
    );

    res.status(201).json({ status: 'success', data: { course: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /courses/:courseId (admin) — change a course's price, title, text or visibility.
 * Columns are chosen from a fixed list below; nothing from the request body is ever used as a column name.
 */
export const updateCourse = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['title', 'description', 'price', 'duration', 'category', 'image_url', 'is_active', 'age_groups', 'path_order'] as const;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const col of allowed) {
      if (req.body[col] !== undefined) {
        const v = req.body[col];
        values.push(v === '' || (Array.isArray(v) && v.length === 0) ? null : v); // an empty list of groups means "everyone"
        sets.push(`${col} = $${values.length}`);
      }
    }
    if (sets.length === 0) return next(new AppError('Nothing to update.', 400));
    values.push(req.params.courseId);
    const result = await pool.query(
      `UPDATE courses SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return next(new AppError('Course not found.', 404));
    res.status(200).json({ status: 'success', data: { course: result.rows[0] } });
  } catch (error) { next(error); }
};

export const getAllCourses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query('SELECT * FROM courses ORDER BY created_at DESC');

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { courses: result.rows },
    });
  } catch (error) {
    next(error);
  }
};

export const createModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { course_id, title, description, order_index } = req.body;
    if (!course_id || !title) return next(new AppError('Please provide course_id and title.', 400));

    const courseCheck = await pool.query('SELECT id FROM courses WHERE id = $1', [course_id]);
    if (courseCheck.rows.length === 0) return next(new AppError('Course not found.', 404));

    const result = await pool.query(
      `INSERT INTO modules (course_id, title, description, order_index)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [course_id, title, description ?? null, order_index ?? 0]
    );
    res.status(201).json({ status: 'success', data: { module: result.rows[0] } });
  } catch (error) { next(error); }
};

export const getModulesByCourse = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.params;
    const result = await pool.query(
      `SELECT m.*, COUNT(l.id)::int AS lesson_count
       FROM modules m
       LEFT JOIN lessons l ON l.module_id = m.id
       WHERE m.course_id = $1
       GROUP BY m.id
       ORDER BY m.order_index ASC`,
      [courseId]
    );
    res.status(200).json({ status: 'success', results: result.rows.length, data: { modules: result.rows } });
  } catch (error) { next(error); }
};

export const updateModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moduleId } = req.params;
    const { title, description, order_index } = req.body;
    const result = await pool.query(
      `UPDATE modules SET title = COALESCE($1, title), description = COALESCE($2, description),
       order_index = COALESCE($3, order_index) WHERE id = $4 RETURNING *`,
      [title ?? null, description ?? null, order_index ?? null, moduleId]
    );
    if (result.rows.length === 0) return next(new AppError('Module not found.', 404));
    res.status(200).json({ status: 'success', data: { module: result.rows[0] } });
  } catch (error) { next(error); }
};

export const deleteModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moduleId } = req.params;
    const result = await pool.query('DELETE FROM modules WHERE id = $1 RETURNING id', [moduleId]);
    if (result.rows.length === 0) return next(new AppError('Module not found.', 404));
    res.status(204).send();
  } catch (error) { next(error); }
};

// ──────────────────────────────────────────────────────────────────
// LESSONS – simplified (no coding environment fields)
// ──────────────────────────────────────────────────────────────────

export const createLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { module_id, title, notes, assignment, order_index, lesson_type, age_groups } = req.body;
    if (!module_id || !title) return next(new AppError('Please provide module_id and title.', 400));

    const moduleCheck = await pool.query('SELECT id FROM modules WHERE id = $1', [module_id]);
    if (moduleCheck.rows.length === 0) return next(new AppError('Module not found.', 404));

    const result = await pool.query(
      `INSERT INTO lessons (module_id, title, notes, assignment, order_index, lesson_type, age_groups)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [module_id, title, notes ?? null, assignment ?? null, order_index ?? 0, lesson_type ?? 'notes', age_groups?.length ? age_groups : null]
    );
    res.status(201).json({ status: 'success', data: { lesson: result.rows[0] } });
  } catch (error) { next(error); }
};

export const getLessonsByModule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moduleId } = req.params;
    const result = await pool.query(
      `SELECT * FROM lessons WHERE module_id = $1 ORDER BY order_index ASC`,
      [moduleId]
    );
    res.status(200).json({ status: 'success', results: result.rows.length, data: { lessons: result.rows } });
  } catch (error) { next(error); }
};

export const getLessonById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const lessonResult = await pool.query(
      `SELECT l.*, m.title AS module_title, m.course_id
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       WHERE l.id = $1`,
      [lessonId]
    );
    if (lessonResult.rows.length === 0) return next(new AppError('Lesson not found.', 404));
    const lesson = lessonResult.rows[0];

    // Fetch all quiz questions
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
          questions: req.user?.role === 'admin'
            ? questionsResult.rows
            : questionsResult.rows.map(({ answer: _a, ...rest }: any) => rest),
        },
      },
    });
  } catch (error) { next(error); }
};

export const updateLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const { title, notes, assignment, order_index, lesson_type, age_groups } = req.body;
    const setGroups = age_groups !== undefined; // [] = "everyone", so it must be distinguishable from "not sent"
    const result = await pool.query(
      `UPDATE lessons
       SET title = COALESCE($1, title),
           notes = COALESCE($2, notes),
           assignment = COALESCE($3, assignment),
           order_index = COALESCE($4, order_index),
           lesson_type = COALESCE($6, lesson_type),
           age_groups = CASE WHEN $7::boolean THEN $8::text[] ELSE age_groups END
       WHERE id = $5 RETURNING *`,
      [title ?? null, notes ?? null, assignment ?? null, order_index ?? null, lessonId, lesson_type ?? null, setGroups, setGroups && age_groups.length ? age_groups : null]
    );
    if (result.rows.length === 0) return next(new AppError('Lesson not found.', 404));
    res.status(200).json({ status: 'success', data: { lesson: result.rows[0] } });
  } catch (error) { next(error); }
};

export const deleteLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const result = await pool.query('DELETE FROM lessons WHERE id = $1 RETURNING id', [lessonId]);
    if (result.rows.length === 0) return next(new AppError('Lesson not found.', 404));
    res.status(204).send();
  } catch (error) { next(error); }
};

// ──────────────────────────────────────────────────────────────────
// QUIZ QUESTIONS (CRUD) – unchanged, already perfect for MCQs
// ──────────────────────────────────────────────────────────────────

export const addQuestion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const { question, options, answer, order_index } = req.body;
    if (!question || !options || !Array.isArray(options) || options.length < 2)
      return next(new AppError('Please provide a question and at least 2 options.', 400));
    if (typeof answer !== 'number' || answer < 0 || answer >= options.length)
      return next(new AppError('Answer must be a valid index into the options array.', 400));

    const lessonCheck = await pool.query('SELECT id FROM lessons WHERE id = $1', [lessonId]);
    if (lessonCheck.rows.length === 0) return next(new AppError('Lesson not found.', 404));

    const result = await pool.query(
      `INSERT INTO lesson_questions (lesson_id, question, options, answer, order_index)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [lessonId, question, JSON.stringify(options), answer, order_index ?? 0]
    );
    res.status(201).json({ status: 'success', data: { question: result.rows[0] } });
  } catch (error) { next(error); }
};

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
    // Never send the answer key to a child (or a parent looking over their shoulder).
    const questions = req.user?.role === 'admin' ? result.rows : result.rows.map(({ answer: _a, ...rest }: any) => rest);
    res.status(200).json({ status: 'success', results: questions.length, data: { questions } });
  } catch (error) { next(error); }
};

export const updateQuestion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { questionId } = req.params;
    const { question, options, answer, order_index } = req.body;
    const result = await pool.query(
      `UPDATE lesson_questions
       SET question = COALESCE($1, question),
           options = COALESCE($2, options),
           answer = COALESCE($3, answer),
           order_index = COALESCE($4, order_index)
       WHERE id = $5 RETURNING *`,
      [question ?? null, options ? JSON.stringify(options) : null, answer ?? null, order_index ?? null, questionId]
    );
    if (result.rows.length === 0) return next(new AppError('Question not found.', 404));
    res.status(200).json({ status: 'success', data: { question: result.rows[0] } });
  } catch (error) { next(error); }
};

export const deleteQuestion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { questionId } = req.params;
    const result = await pool.query('DELETE FROM lesson_questions WHERE id = $1 RETURNING id', [questionId]);
    if (result.rows.length === 0) return next(new AppError('Question not found.', 404));
    res.status(204).send();
  } catch (error) { next(error); }
};

// ──────────────────────────────────────────────────────────────────
// QUIZ SUBMISSION – NEW! Stores student answers and calculates score
// ──────────────────────────────────────────────────────────────────

export const submitQuiz = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const { answers } = req.body; // validated: [{ questionId: uuid, selectedIndex: number }]
    if (!answers || !Array.isArray(answers))
      return next(new AppError('Please provide an answers array.', 400));

    // Fetch all questions for this lesson
    const questionsResult = await pool.query(
      `SELECT id, answer FROM lesson_questions WHERE lesson_id = $1 ORDER BY order_index`,
      [lessonId]
    );
    if (questionsResult.rows.length === 0)
      return next(new AppError('No questions found for this lesson.', 404));

    // Calculate score
    let score = 0;
    for (const ans of answers) {
      const question = questionsResult.rows.find(q => q.id === ans.questionId);
      if (question && question.answer === ans.selectedIndex) score++;
    }
    const total = questionsResult.rows.length;
    const percentage = (score / total) * 100;

    // Store the submission (optional – create a submissions table)
    // For now, return the result without persisting (or you can add a table)
    // If you want to store, uncomment the following lines:
    /*
    await pool.query(
      `INSERT INTO quiz_submissions (lesson_id, student_id, score, total, answers_json, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [lessonId, studentId, score, total, JSON.stringify(answers)]
    );
    */

    const passed = percentage >= 70; // adjustable threshold

    // A passed quiz completes the lesson for the child (once), exactly like finishing it by hand: 10 points.
    let lessonCompleted = false;
    let pointsEarned = 0;
    const enrollmentId = req.body.enrollmentId as string | undefined;
    if (passed && enrollmentId && req.user?.role === 'kid') {
      const kidId = req.user.id;
      const own = await pool.query(
        `SELECT 1 FROM enrollments e
           JOIN modules m ON m.course_id = e.course_id
           JOIN lessons l ON l.module_id = m.id
          WHERE e.id = $1 AND e.kid_id = $2 AND e.status = 'active' AND ${trialStillValid('e')} AND l.id = $3`,
        [enrollmentId, kidId, lessonId]
      );
      if (own.rows.length > 0) {
        const ins = await pool.query(
          `INSERT INTO kid_progress (kid_id, lesson_id, enrollment_id, completed, points_earned, completed_at)
           VALUES ($1, $2, $3, true, 10, NOW())
           ON CONFLICT (kid_id, lesson_id, enrollment_id)
           DO UPDATE SET completed = true, points_earned = 10, completed_at = NOW(), updated_at = NOW()
             WHERE kid_progress.completed = false
           RETURNING id`,
          [kidId, lessonId, enrollmentId]
        );
        if (ins.rows.length > 0) {
          pointsEarned = 10;
          await pool.query('UPDATE kids SET total_points = COALESCE(total_points, 0) + 10 WHERE id = $1', [kidId]);
        }
        lessonCompleted = true;
      }
    }

    res.status(200).json({
      status: 'success',
      data: { score, total, percentage, passed, lessonCompleted, pointsEarned },
    });
  } catch (error) { next(error); }
};

// ──────────────────────────────────────────────────────────────────
// FULL COURSE CURRICULUM (with lessons & question counts)
// ──────────────────────────────────────────────────────────────────

export const getCourseCurriculum = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courseId } = req.params;
    const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (courseResult.rows.length === 0) return next(new AppError('Course not found.', 404));

    const modulesResult = await pool.query(
      `SELECT * FROM modules WHERE course_id = $1 ORDER BY order_index ASC`,
      [courseId]
    );

    const lessonsResult = await pool.query(
      `SELECT l.*, COUNT(q.id)::int AS question_count
       FROM lessons l
       LEFT JOIN lesson_questions q ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       WHERE m.course_id = $1
       GROUP BY l.id
       ORDER BY l.order_index ASC`,
      [courseId]
    );

    const modules = modulesResult.rows.map(mod => ({
      ...mod,
      lessons: lessonsResult.rows.filter(l => l.module_id === mod.id),
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
  } catch (error) { next(error); }
};

// ──────────────────────────────────────────────────────────────────
// ASSIGNMENT ENDPOINTS (optional, keep if you still want assignment text)
// ──────────────────────────────────────────────────────────────────

export const updateLessonAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const { assignment } = req.body;
    if (!assignment) return next(new AppError('Please provide assignment text.', 400));
    const result = await pool.query(
      `UPDATE lessons SET assignment = $1 WHERE id = $2 RETURNING id, assignment`,
      [assignment, lessonId]
    );
    if (result.rows.length === 0) return next(new AppError('Lesson not found.', 404));
    res.status(200).json({ status: 'success', data: { assignment: result.rows[0].assignment } });
  } catch (error) { next(error); }
};

export const getLessonAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;
    const result = await pool.query(`SELECT assignment FROM lessons WHERE id = $1`, [lessonId]);
    if (result.rows.length === 0) return next(new AppError('Lesson not found.', 404));
    res.status(200).json({ status: 'success', data: { assignment: result.rows[0].assignment || null } });
  } catch (error) { next(error); }
};