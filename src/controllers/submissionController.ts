import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from '../utils/appError';
import sendMail from '../utils/sendMail';
import { IUser } from '../interfaces/user.interface';
import { IKid } from '../interfaces/kid.interface';

interface AuthRequest extends Omit<Request, 'user'> {
  user?: IUser | IKid;
}

// ─── Validate GitHub URL ──────────────────────────────────────────────────────
const isValidGithubUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'github.com' && parsed.pathname.split('/').filter(Boolean).length >= 2;
  } catch {
    return false;
  }
};

// ─── KID: SUBMIT ASSIGNMENT ───────────────────────────────────────────────────
export const submitAssignment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id;
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const { lesson_id, enrollment_id, github_url } = req.body;

    if (!lesson_id || !enrollment_id || !github_url) {
      return next(new AppError('Please provide lesson_id, enrollment_id, and github_url.', 400));
    }

    if (!isValidGithubUrl(github_url)) {
      return next(new AppError('Please provide a valid GitHub repository URL (github.com/username/repo).', 400));
    }

    // Verify enrollment belongs to this kid and is active
    const enrollmentResult = await pool.query(
      `SELECT e.id, e.parent_id, e.course_id, e.course_name, k.name AS kid_name
       FROM enrollments e
       JOIN kids k ON k.id = e.kid_id
       WHERE e.id = $1 AND e.kid_id = $2 AND e.status = 'active'`,
      [enrollment_id, kidId]
    );

    if (enrollmentResult.rows.length === 0) {
      return next(new AppError('Enrollment not found or access denied.', 403));
    }

    const enrollment = enrollmentResult.rows[0];

    // Verify lesson belongs to this course and has an assignment
    const lessonResult = await pool.query(
      `SELECT l.id, l.title, l.assignment
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       WHERE l.id = $1 AND m.course_id = $2`,
      [lesson_id, enrollment.course_id]
    );

    if (lessonResult.rows.length === 0) {
      return next(new AppError('Lesson not found or does not belong to your course.', 404));
    }

    if (!lessonResult.rows[0].assignment) {
      return next(new AppError('This lesson has no assignment.', 400));
    }

    // Upsert submission (allow resubmission if not yet reviewed)
    const existing = await pool.query(
      `SELECT id, status FROM submissions WHERE lesson_id = $1 AND kid_id = $2`,
      [lesson_id, kidId]
    );

    if (existing.rows.length > 0 && existing.rows[0].status === 'reviewed') {
      return next(new AppError('This assignment has already been reviewed and cannot be resubmitted.', 400));
    }

    const result = await pool.query(
      `INSERT INTO submissions (lesson_id, kid_id, parent_id, enrollment_id, github_url, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, 'submitted', NOW())
       ON CONFLICT (lesson_id, kid_id)
       DO UPDATE SET
         github_url = EXCLUDED.github_url,
         status = 'submitted',
         submitted_at = NOW(),
         marks = NULL,
         feedback = NULL,
         reviewed_at = NULL,
         reviewed_by = NULL
       RETURNING *`,
      [lesson_id, kidId, enrollment.parent_id, enrollment_id, github_url]
    );

    res.status(201).json({
      status: 'success',
      message: 'Assignment submitted successfully! Your tutor will review it soon. 🎉',
      data: { submission: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// ─── KID: GET MY SUBMISSIONS ──────────────────────────────────────────────────
export const getMySubmissions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id;
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const { enrollmentId } = req.params;

    const result = await pool.query(
      `SELECT 
        s.*,
        l.title AS lesson_title,
        l.assignment,
        u.name AS reviewed_by_name
       FROM submissions s
       JOIN lessons l ON l.id = s.lesson_id
       LEFT JOIN users u ON u.id = s.reviewed_by
       WHERE s.kid_id = $1 AND s.enrollment_id = $2
       ORDER BY s.submitted_at DESC`,
      [kidId, enrollmentId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { submissions: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// ─── KID: GET SINGLE SUBMISSION ───────────────────────────────────────────────
export const getSubmissionByLesson = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const kidId = req.user?.id;
    if (!kidId) return next(new AppError('Unauthorized access.', 401));

    const { lessonId } = req.params;

    const result = await pool.query(
      `SELECT 
        s.*,
        l.title AS lesson_title,
        u.name AS reviewed_by_name
       FROM submissions s
       JOIN lessons l ON l.id = s.lesson_id
       LEFT JOIN users u ON u.id = s.reviewed_by
       WHERE s.lesson_id = $1 AND s.kid_id = $2`,
      [lessonId, kidId]
    );

    res.status(200).json({
      status: 'success',
      data: { submission: result.rows[0] || null }
    });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: GET ALL SUBMISSIONS ───────────────────────────────────────────────
export const getAllSubmissions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, lesson_id, course_id } = req.query;

    let query = `
      SELECT 
        s.*,
        l.title AS lesson_title,
        l.assignment,
        k.name AS kid_name,
        k.avatar AS kid_avatar,
        e.course_name,
        u.name AS reviewed_by_name
       FROM submissions s
       JOIN lessons l ON l.id = s.lesson_id
       JOIN kids k ON k.id = s.kid_id
       JOIN enrollments e ON e.id = s.enrollment_id
       LEFT JOIN users u ON u.id = s.reviewed_by
       WHERE 1=1`;

    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND s.status = $${paramIndex++}`;
      params.push(status);
    }
    if (lesson_id) {
      query += ` AND s.lesson_id = $${paramIndex++}`;
      params.push(lesson_id);
    }
    if (course_id) {
      query += ` AND e.course_id = $${paramIndex++}`;
      params.push(course_id);
    }

    query += ` ORDER BY s.submitted_at DESC`;

    const result = await pool.query(query, params);

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { submissions: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: REVIEW SUBMISSION ─────────────────────────────────────────────────
export const reviewSubmission = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return next(new AppError('Unauthorized access.', 401));

    const { submissionId } = req.params;
    const { marks, feedback } = req.body;

    if (marks === undefined || marks === null) {
      return next(new AppError('Please provide marks.', 400));
    }

    if (marks < 0 || marks > 100) {
      return next(new AppError('Marks must be between 0 and 100.', 400));
    }

    const result = await pool.query(
      `UPDATE submissions
       SET
         marks = $1,
         feedback = $2,
         status = 'reviewed',
         reviewed_at = NOW(),
         reviewed_by = $3
       WHERE id = $4
       RETURNING *`,
      [marks, feedback || null, adminId, submissionId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Submission not found.', 404));
    }

    const submission = result.rows[0];

    // Fetch details to send email notification
    const details = await pool.query(
      `SELECT 
        k.name AS kid_name,
        l.title AS lesson_title,
        e.course_name,
        u.email AS parent_email,
        u.name AS parent_name
       FROM submissions s
       JOIN kids k ON k.id = s.kid_id
       JOIN lessons l ON l.id = s.lesson_id
       JOIN enrollments e ON e.id = s.enrollment_id
       JOIN users u ON u.id = s.parent_id
       WHERE s.id = $1`,
      [submissionId]
    );

    if (details.rows.length > 0) {
      const d = details.rows[0];
      const grade = marks >= 80 ? '🥇' : marks >= 60 ? '🥈' : '🥉';

      await sendMail({
  to: d.parent_email,
  subject: `${d.kid_name}'s Assignment Graded — ${d.lesson_title}`,
  html: buildGradeNotificationHtml({
    parent_name: d.parent_name,
    kid_name: d.kid_name,
    lesson_title: d.lesson_title,
    course_name: d.course_name,
    marks,
    feedback: feedback || null,
    grade_emoji: grade,
  }),
  text: `Hi ${d.parent_name}, ${d.kid_name}'s assignment for "${d.lesson_title}" in ${d.course_name} has been reviewed. Score: ${marks}/100.${feedback ? ` Feedback: ${feedback}` : ''}`,
});
    }

    res.status(200).json({
      status: 'success',
      message: 'Submission reviewed and parent notified.',
      data: { submission }
    });
  } catch (error) {
    next(error);
  }
};

// ─── ADMIN: GET SUBMISSIONS FOR A LESSON ─────────────────────────────────────
export const getSubmissionsByLesson = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lessonId } = req.params;

    const result = await pool.query(
      `SELECT 
        s.*,
        k.name AS kid_name,
        k.avatar AS kid_avatar,
        u.name AS reviewed_by_name
       FROM submissions s
       JOIN kids k ON k.id = s.kid_id
       LEFT JOIN users u ON u.id = s.reviewed_by
       WHERE s.lesson_id = $1
       ORDER BY s.submitted_at DESC`,
      [lessonId]
    );

    res.status(200).json({
      status: 'success',
      results: result.rows.length,
      data: { submissions: result.rows }
    });
  } catch (error) {
    next(error);
  }
};

// ─── EMAIL TEMPLATE ───────────────────────────────────────────────────────────
interface GradeNotificationData {
  parent_name: string;
  kid_name: string;
  lesson_title: string;
  course_name: string;
  marks: number;
  feedback: string | null;
  grade_emoji: string;
}

const buildGradeNotificationHtml = (data: GradeNotificationData): string => {
  const gradeColor = data.marks >= 80 ? '#16a34a' : data.marks >= 60 ? '#d97706' : '#dc2626';
  const gradeLabel = data.marks >= 80 ? 'Excellent!' : data.marks >= 60 ? 'Good Job!' : 'Keep Trying!';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:40px 16px;background:#f4f1fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <tr>
          <td style="background:#3B1FA3;border-radius:16px 16px 0 0;padding:28px 40px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:#fff;">Akili<span style="color:#F5A623;">&lt;&gt;</span>Code</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;">Assignment Graded</div>
          </td>
        </tr>

        <tr>
          <td style="background:#fff;padding:32px 40px;text-align:center;border-bottom:2px dashed #e0d9f5;">
            <div style="font-size:56px;margin-bottom:8px;">${data.grade_emoji}</div>
            <div style="font-size:28px;font-weight:700;color:${gradeColor};">${data.marks}/100</div>
            <div style="font-size:14px;font-weight:600;color:${gradeColor};margin-top:4px;">${gradeLabel}</div>
          </td>
        </tr>

        <tr>
          <td style="background:#fff;padding:24px 40px 32px;">
            <p style="font-size:15px;color:#1a1a2e;margin-bottom:20px;">
              Hi <strong>${data.parent_name}</strong>,
            </p>
            <p style="font-size:14px;color:#6b6b8a;line-height:1.6;margin-bottom:24px;">
              <strong>${data.kid_name}</strong>'s assignment for
              <strong>${data.lesson_title}</strong> in
              <strong>${data.course_name}</strong> has been reviewed.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;border-radius:12px;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:13px;color:#6b6b8a;padding:8px 0;border-bottom:1px dashed #e0d9f5;">Lesson</td>
                    <td style="font-size:13px;font-weight:700;color:#1a1a2e;text-align:right;padding:8px 0;border-bottom:1px dashed #e0d9f5;">${data.lesson_title}</td>
                  </tr>
                  <tr>
                    <td style="font-size:13px;color:#6b6b8a;padding:8px 0;border-bottom:1px dashed #e0d9f5;">Course</td>
                    <td style="font-size:13px;font-weight:700;color:#1a1a2e;text-align:right;padding:8px 0;border-bottom:1px dashed #e0d9f5;">${data.course_name}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;font-weight:700;color:#1a1a2e;padding-top:12px;">Score</td>
                    <td style="font-size:18px;font-weight:700;color:${gradeColor};text-align:right;padding-top:12px;">${data.marks}/100</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            ${data.feedback ? `
            <div style="background:#fff8e1;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
              <p style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Tutor Feedback</p>
              <p style="font-size:14px;color:#1a1a2e;line-height:1.6;margin:0;">${data.feedback}</p>
            </div>` : ''}

            <p style="font-size:13px;color:#6b6b8a;">
              Log in to AkiliCode to see the full review and continue ${data.kid_name}'s learning journey.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#3B1FA3;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
            <div style="font-size:13px;color:rgba(255,255,255,0.75);">
              Keep it up, <strong style="color:#F5A623;">${data.kid_name}</strong>! Every lesson makes you a better coder. 🚀
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
};