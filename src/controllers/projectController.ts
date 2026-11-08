import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import { lessonVisibleSql } from '../utils/ageGroups';
import { trialStillValid } from '../utils/trial';

const MAX_PROJECTS_PER_KID = 25;

/** What a brand-new project starts with. Friendly, and shows where each language goes. */
export const STARTER = {
  html: '<h1>Hello!</h1>\n<p>Change me, then press Run.</p>\n<button id="btn">Click me</button>',
  css: 'body {\n  font-family: sans-serif;\n  text-align: center;\n  background: #f5f0ff;\n}\nh1 { color: #7c3aed; }',
  js: 'document.getElementById("btn").addEventListener("click", () => {\n  alert("You clicked the button!");\n});',
};

const kidId = (req: Request) => req.user!.id;
const LIST_COLS = 'id, title, kind, lesson_id, submitted_at, marks, reviewed_at, updated_at';

const ownProject = async (id: string, kid: string) => {
  const { rows } = await pool.query('SELECT * FROM kid_projects WHERE id = $1 AND kid_id = $2', [id, kid]);
  if (rows.length === 0) throw new AppError('Project not found.', 404);
  return rows[0];
};

// ── Child ────────────────────────────────────────────────────────────────────

/** GET /kid/projects/assignments: every assignment in the child's active courses, with the state of their project. */
export const listAssignments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id AS lesson_id, l.title AS lesson_title, l.assignment, l.assignment_due_date, l.lesson_type,
              c.title AS course_title, e.id AS enrollment_id, m.title AS module_title,
              p.id AS project_id, p.submitted_at, p.reviewed_at, p.marks, p.feedback
         FROM enrollments e
         JOIN courses c  ON c.id = e.course_id
         JOIN modules m  ON m.course_id = e.course_id
         JOIN lessons l  ON l.module_id = m.id
         LEFT JOIN kid_projects p ON p.kid_id = e.kid_id AND p.lesson_id = l.id
        WHERE e.kid_id = $1 AND e.status = 'active' AND ${trialStillValid('e')} AND l.assignment IS NOT NULL AND l.assignment <> ''
          AND ${lessonVisibleSql('l', 1)}
        ORDER BY c.title, m.order_index, l.order_index`,
      [kidId(req)]
    );
    res.status(200).json({ status: 'success', data: { assignments: rows } });
  } catch (error) {
    next(error);
  }
};

/** GET /kid/projects */
export const listProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`SELECT ${LIST_COLS} FROM kid_projects WHERE kid_id = $1 ORDER BY updated_at DESC`, [kidId(req)]);
    res.status(200).json({ status: 'success', data: { projects: rows } });
  } catch (error) {
    next(error);
  }
};

/** GET /kid/projects/:id */
export const getProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Include the assignment text so the editor can show what the child is asked to do.
    const { rows } = await pool.query(
      `SELECT p.*, l.assignment, l.title AS lesson_title
         FROM kid_projects p LEFT JOIN lessons l ON l.id = p.lesson_id
        WHERE p.id = $1 AND p.kid_id = $2`,
      [req.params.id, kidId(req)]
    );
    if (rows.length === 0) throw new AppError('Project not found.', 404);
    res.status(200).json({ status: 'success', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** POST /kid/projects: a free project, not tied to any lesson. */
export const createProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kid = kidId(req);
    const count = await pool.query('SELECT count(*)::int AS n FROM kid_projects WHERE kid_id = $1', [kid]);
    if (count.rows[0].n >= MAX_PROJECTS_PER_KID) {
      return next(new AppError(`You can keep ${MAX_PROJECTS_PER_KID} projects. Delete one you do not need, then try again.`, 409));
    }
    const { title, html, css, js, kind, blocks } = req.body as { title?: string; html?: string; css?: string; js?: string; kind?: 'web' | 'blocks'; blocks?: object };
    const isBlocks = kind === 'blocks';
    const { rows } = await pool.query(
      `INSERT INTO kid_projects (kid_id, title, kind, html, css, js, blocks) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [kid, title ?? (isBlocks ? 'My blocks' : 'My project'), isBlocks ? 'blocks' : 'web', isBlocks ? '' : html ?? STARTER.html, isBlocks ? '' : css ?? STARTER.css, isBlocks ? '' : js ?? STARTER.js, isBlocks ? (blocks ? JSON.stringify(blocks) : null) : null]
    );
    res.status(201).json({ status: 'success', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** POST /kid/projects/for-lesson/:lessonId: open the child's project for an assignment, creating it the first time. */
export const openForLesson = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kid = kidId(req);
    const lessonId = req.params.lessonId as string;
    const lesson = await pool.query(
      `SELECT l.id, l.title, l.lesson_type, e.id AS enrollment_id
         FROM enrollments e
         JOIN modules m ON m.course_id = e.course_id
         JOIN lessons l ON l.module_id = m.id
        WHERE e.kid_id = $1 AND e.status = 'active' AND ${trialStillValid('e')} AND l.id = $2 AND ${lessonVisibleSql('l', 1)} LIMIT 1`,
      [kid, lessonId]
    );
    if (lesson.rows.length === 0) return next(new AppError('That assignment is not in one of your courses.', 404));

    const existing = await pool.query('SELECT * FROM kid_projects WHERE kid_id = $1 AND lesson_id = $2', [kid, lessonId]);
    if (existing.rows.length > 0) return res.status(200).json({ status: 'success', data: { project: existing.rows[0] } });

    const l = lesson.rows[0];
    const isBlocks = l.lesson_type === 'scratch'; // a block-coding lesson opens the block editor
    const { rows } = await pool.query(
      `INSERT INTO kid_projects (kid_id, lesson_id, enrollment_id, title, html, css, js, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (kid_id, lesson_id) WHERE lesson_id IS NOT NULL DO UPDATE SET updated_at = kid_projects.updated_at
       RETURNING *`,
      [kid, lessonId, l.enrollment_id, String(l.title).slice(0, 80), isBlocks ? '' : STARTER.html, isBlocks ? '' : STARTER.css, isBlocks ? '' : STARTER.js, isBlocks ? 'blocks' : 'web']
    );
    res.status(201).json({ status: 'success', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** PUT /kid/projects/:id: save. Locked while the work is handed in. */
export const saveProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await ownProject(req.params.id as string, kidId(req));
    if (p.submitted_at) return next(new AppError('This project is handed in. Take it back first if you want to change it.', 409));
    const { title, html, css, js, blocks } = req.body as { title?: string; html?: string; css?: string; js?: string; blocks?: object };
    const { rows } = await pool.query(
      `UPDATE kid_projects
          SET title = COALESCE($3, title), html = COALESCE($4, html), css = COALESCE($5, css), js = COALESCE($6, js),
              blocks = COALESCE($7::jsonb, blocks), updated_at = now()
        WHERE id = $1 AND kid_id = $2 RETURNING ${LIST_COLS}`,
      [p.id, p.kid_id, title ?? null, html ?? null, css ?? null, js ?? null, blocks ? JSON.stringify(blocks) : null]
    );
    res.status(200).json({ status: 'success', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** POST /kid/projects/:id/submit */
export const submitProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await ownProject(req.params.id as string, kidId(req));
    if (!p.lesson_id) return next(new AppError('Only assignment projects can be handed in.', 400));
    const { rows } = await pool.query(
      `UPDATE kid_projects SET submitted_at = COALESCE(submitted_at, now()), updated_at = now()
        WHERE id = $1 AND kid_id = $2 RETURNING ${LIST_COLS}`,
      [p.id, p.kid_id]
    );
    res.status(200).json({ status: 'success', message: 'Handed in! Your teacher will look at it.', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** POST /kid/projects/:id/unsubmit: take it back, allowed until the teacher has marked it. */
export const unsubmitProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await ownProject(req.params.id as string, kidId(req));
    if (p.reviewed_at) return next(new AppError('Your teacher has already marked this one.', 409));
    const { rows } = await pool.query(
      `UPDATE kid_projects SET submitted_at = NULL, updated_at = now() WHERE id = $1 AND kid_id = $2 RETURNING ${LIST_COLS}`,
      [p.id, p.kid_id]
    );
    res.status(200).json({ status: 'success', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};

/** DELETE /kid/projects/:id */
export const deleteProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await ownProject(req.params.id as string, kidId(req));
    if (p.submitted_at) return next(new AppError('Take it back before deleting a handed-in project.', 409));
    await pool.query('DELETE FROM kid_projects WHERE id = $1 AND kid_id = $2', [p.id, p.kid_id]);
    res.status(200).json({ status: 'success', message: 'Deleted.' });
  } catch (error) {
    next(error);
  }
};

// ── Admin ────────────────────────────────────────────────────────────────────

/** GET /admin/projects?status=submitted|reviewed|all */
export const adminListProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string | undefined) ?? 'submitted';
    const where =
      status === 'reviewed' ? 'p.reviewed_at IS NOT NULL'
      : status === 'all' ? 'p.submitted_at IS NOT NULL'
      : 'p.submitted_at IS NOT NULL AND p.reviewed_at IS NULL';
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.kind, p.blocks, p.html, p.css, p.js, p.submitted_at, p.marks, p.feedback, p.reviewed_at,
              k.name AS kid_name, k.age AS kid_age, l.title AS lesson_title, l.assignment, c.title AS course_title
         FROM kid_projects p
         JOIN kids k ON k.id = p.kid_id
         LEFT JOIN lessons l ON l.id = p.lesson_id
         LEFT JOIN modules m ON m.id = l.module_id
         LEFT JOIN courses c ON c.id = m.course_id
        WHERE ${where}
        ORDER BY p.submitted_at ASC LIMIT 200`
    );
    res.status(200).json({ status: 'success', results: rows.length, data: { projects: rows } });
  } catch (error) {
    next(error);
  }
};

/** PATCH /admin/projects/:id/review  { marks, feedback } */
export const adminReviewProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { marks, feedback } = req.body as { marks: number; feedback?: string };
    const { rows } = await pool.query(
      `UPDATE kid_projects SET marks = $2, feedback = $3, reviewed_at = now(), reviewed_by = $4, updated_at = now()
        WHERE id = $1 AND submitted_at IS NOT NULL RETURNING id, marks, feedback, reviewed_at`,
      [req.params.id, marks, feedback ?? null, req.user!.id]
    );
    if (rows.length === 0) return next(new AppError('That project has not been handed in.', 404));
    res.status(200).json({ status: 'success', message: 'Saved.', data: { project: rows[0] } });
  } catch (error) {
    next(error);
  }
};
