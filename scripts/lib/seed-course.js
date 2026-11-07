/**
 * Adds a module with lessons, quiz questions and assignments to an EXISTING course.
 * Safe to run twice: if the module already exists in that course, nothing is changed.
 * Never creates a course (the price is your decision), and never touches anything else.
 */
const GROUPS = ['4-6', '7-9', '10-12', '13-15', '16-18'];
const TYPES = ['notes', 'coding', 'scratch'];

const check = (content) => {
  const problems = [];
  const badGroups = (g) => g !== undefined && g !== null && (!Array.isArray(g) || g.some((x) => !GROUPS.includes(x)));
  if (badGroups(content.module?.ageGroups)) problems.push('module.ageGroups must be a list from: ' + GROUPS.join(', '));
  if (content.module?.lessonType && !TYPES.includes(content.module.lessonType)) problems.push('module.lessonType must be one of: ' + TYPES.join(', '));
  if (!content.courseTitle || !content.module?.title) problems.push('courseTitle and module.title are required');
  (content.lessons || []).forEach((l, i) => {
    const at = `lesson ${i + 1} (${l.title})`;
    if (!l.title || !l.notes) problems.push(`${at}: title and notes are required`);
    if (badGroups(l.ageGroups)) problems.push(`${at}: ageGroups must be a list from: ${GROUPS.join(', ')}`);
    if (l.lessonType && !TYPES.includes(l.lessonType)) problems.push(`${at}: lessonType must be one of: ${TYPES.join(', ')}`);
    if (!Array.isArray(l.questions) || l.questions.length === 0) problems.push(`${at}: every lesson needs questions (a child finishes a lesson by passing its quiz)`);
    (l.questions || []).forEach((q, j) => {
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2) problems.push(`${at} question ${j + 1}: needs text and 2+ options`);
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) problems.push(`${at} question ${j + 1}: answer must be the position (0-based) of a real option`);
      else if (new Set(q.options).size !== q.options.length) problems.push(`${at} question ${j + 1}: two options are identical`);
    });
  });
  return problems;
};

/** client: a pg Client or Pool client. Returns a summary. */
const seedCourse = async (client, content, { apply = false } = {}) => {
  const problems = check(content);
  if (problems.length) return { ok: false, problems };

  const course = await client.query('SELECT id, title FROM courses WHERE lower(title) = lower($1)', [content.courseTitle]);
  if (course.rows.length === 0) {
    return { ok: false, problems: [`No course called "${content.courseTitle}". Create it in Admin > Courses first (you choose its price), then run this again.`] };
  }
  if (course.rows.length > 1) {
    return { ok: false, problems: [`More than one course is called "${content.courseTitle}". Rename one so this is unambiguous.`] };
  }
  const courseId = course.rows[0].id;

  const existing = await client.query('SELECT id FROM modules WHERE course_id = $1 AND lower(title) = lower($2)', [courseId, content.module.title]);
  if (existing.rows.length > 0) return { ok: true, skipped: true, message: `The module "${content.module.title}" already exists in "${course.rows[0].title}". Nothing changed.` };

  const summary = {
    ok: true,
    course: course.rows[0].title,
    module: content.module.title,
    lessons: content.lessons.length,
    questions: content.lessons.reduce((n, l) => n + l.questions.length, 0),
    applied: false,
  };
  if (!apply) return summary;

  await client.query('BEGIN');
  try {
    const { rows: [{ max }] } = await client.query('SELECT COALESCE(MAX(order_index), -1) AS max FROM modules WHERE course_id = $1', [courseId]);
    const mod = await client.query(
      'INSERT INTO modules (course_id, title, description, order_index) VALUES ($1,$2,$3,$4) RETURNING id',
      [courseId, content.module.title, content.module.description ?? null, Number(max) + 1]
    );
    for (const [i, l] of content.lessons.entries()) {
      const les = await client.query(
        `INSERT INTO lessons (module_id, title, notes, lesson_type, order_index, assignment, age_groups)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [mod.rows[0].id, l.title, l.notes, l.lessonType ?? content.module.lessonType ?? 'notes', i, l.assignment ?? null, (l.ageGroups ?? content.module.ageGroups) || null]
      );
      for (const [j, q] of l.questions.entries()) {
        await client.query(
          'INSERT INTO lesson_questions (lesson_id, question, options, answer, order_index) VALUES ($1,$2,$3::jsonb,$4,$5)',
          [les.rows[0].id, q.question, JSON.stringify(q.options), q.answer, j]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  summary.applied = true;
  return summary;
};

module.exports = { seedCourse, check };
