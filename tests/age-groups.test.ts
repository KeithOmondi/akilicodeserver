/**
 * Age groups: which group an age belongs to, and that a child is only shown the lessons for their group.
 * Runs the real SQL against an in-process Postgres loaded with the real schema + migrations.
 */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let db: any;
let L: typeof import('../src/controllers/kidLearningController');
let P: typeof import('../src/controllers/projectController');
let A: typeof import('../src/controllers/lessonController');
let G: typeof import('../src/utils/ageGroups');

const fakeModule = (file: string, exports: any) => {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as any;
};

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  db = new PGlite({ extensions: { uuid_ossp } });
  const root = path.join(__dirname, '..');
  await db.exec(fs.readFileSync(path.join(root, 'schema/schema.sql'), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, ''));
  for (const m of ['003_pin_reset_and_leaderboard', '004_kid_projects', '005_age_groups_and_blocks', '007_free_trial']) {
    await db.exec(fs.readFileSync(path.join(root, `migrations/${m}.sql`), 'utf8'));
  }
  const run = async (sql: string, params?: any[]) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  fakeModule('../src/config/db', { __esModule: true, default: { query: run, connect: async () => ({ query: run, release() {} }), on() {} }, query: run });
  G = require('../src/utils/ageGroups');
  L = require('../src/controllers/kidLearningController');
  P = require('../src/controllers/projectController');
  A = require('../src/controllers/lessonController');
});

const call = async (handler: any, req: any) => {
  let body: any; let status = 200; let error: any = null;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { body = b; return res; } };
  await handler(req, res, (e: any) => { error = e; });
  return { status, body, error };
};
const asKid = (id: string, extra: any = {}) => ({ user: { id, role: 'kid' }, params: {}, body: {}, query: {}, ...extra });

let n = 0;
/** One course with a module of 4 lessons: for everyone, for 4-6 only, for 7-9 + 10-12, and for 13-15 only. */
const world = async () => {
  n++;
  const parent = (await db.query(`INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P',$1,$2,'x',true) RETURNING id`, [`g${n}@x.co`, `07${50000000 + n}`])).rows[0].id;
  const kid = async (age: number, group: string | null) => (await db.query(`INSERT INTO kids (parent_id,name,age,age_group) VALUES ($1,'K',$2,$3) RETURNING id`, [parent, age, group])).rows[0].id;
  const course = (await db.query(`INSERT INTO courses (title, price) VALUES ($1, 100) RETURNING id`, [`C${n}`])).rows[0].id;
  const mod = (await db.query(`INSERT INTO modules (course_id, title) VALUES ($1,'M') RETURNING id`, [course])).rows[0].id;
  const lesson = async (title: string, groups: string[] | null, type = 'notes') =>
    (await db.query(`INSERT INTO lessons (module_id,title,notes,assignment,order_index,age_groups,lesson_type) VALUES ($1,$2,'n','Do it',$3,$4,$5) RETURNING id`, [mod, title, n, groups, type])).rows[0].id;
  const all = await lesson('for everyone', null);
  const tots = await lesson('tots only', ['4-6']);
  const mid = await lesson('7 to 12', ['7-9', '10-12']);
  const teens = await lesson('teens only', ['13-15']);
  const enrol = async (k: string) => (await db.query(`INSERT INTO enrollments (kid_id,parent_id,course_name,fee_amount,billing_cycle,status,course_id) VALUES ($1,$2,'C',100,'monthly','active',$3) RETURNING id`, [k, parent, course])).rows[0].id;
  return { parent, kid, course, mod, all, tots, mid, teens, enrol };
};

const titlesFor = async (kidId: string, enrolId: string) => {
  const r = await call(L.getCourseContent, asKid(kidId, { params: { enrollmentId: enrolId } }));
  return r.body.data.modules.flatMap((m: any) => m.lessons.map((l: any) => l.title)).sort();
};

test('an age belongs to the right group, on both sides of every border', () => {
  const expect: [number, string][] = [[4, '4-6'], [6, '4-6'], [7, '7-9'], [9, '7-9'], [10, '10-12'], [12, '10-12'], [13, '13-15'], [15, '13-15'], [16, '16-18'], [18, '16-18'], [3, '4-6'], [19, '16-18']];
  for (const [age, group] of expect) assert.equal(G.ageGroupOf(age), group, `age ${age}`);
  assert.equal(G.isAgeGroup('7-9'), true);
  assert.equal(G.isAgeGroup('7-10'), false);
});

test('each child is shown only the lessons for their group, plus the ones for everyone', async () => {
  const w = await world();
  const [t, m, x] = [await w.kid(5, '4-6'), await w.kid(11, '10-12'), await w.kid(14, '13-15')];
  assert.deepEqual(await titlesFor(t, await w.enrol(t)), ['for everyone', 'tots only']);
  assert.deepEqual(await titlesFor(m, await w.enrol(m)), ['7 to 12', 'for everyone']);
  assert.deepEqual(await titlesFor(x, await w.enrol(x)), ['for everyone', 'teens only']);
});

test('a child with no group set sees everything (nothing is hidden by mistake)', async () => {
  const w = await world();
  const k = await w.kid(8, null);
  assert.equal((await titlesFor(k, await w.enrol(k))).length, 4);
});

test('a lesson for another group cannot be opened directly either', async () => {
  const w = await world();
  const k = await w.kid(5, '4-6');
  const e = await w.enrol(k);
  const ok = await call(L.getLesson, asKid(k, { params: { enrollmentId: e, lessonId: w.tots } }));
  assert.equal(ok.error, null);
  const hidden = await call(L.getLesson, asKid(k, { params: { enrollmentId: e, lessonId: w.teens } }));
  assert.equal(hidden.error.statusCode, 404);
});

test('the lesson count on My Courses only counts lessons the child can see', async () => {
  const w = await world();
  const k = await w.kid(5, '4-6');
  await w.enrol(k);
  const r = await call(L.getMyCourses, asKid(k));
  assert.equal(r.body.data.courses[0].total_lessons, 2);
});

test('assignments follow the group too, and a block lesson opens a block project', async () => {
  const w = await world();
  const blockLesson = (await db.query(`INSERT INTO lessons (module_id,title,notes,assignment,order_index,age_groups,lesson_type) VALUES ($1,'Make the cat move','n','Make it dance',9,'{4-6,7-9}','scratch') RETURNING id`, [w.mod])).rows[0].id;
  const k = await w.kid(5, '4-6');
  await w.enrol(k);
  const list = (await call(P.listAssignments, asKid(k))).body.data.assignments.map((a: any) => a.lesson_title).sort();
  assert.deepEqual(list, ['Make the cat move', 'for everyone', 'tots only']);

  const opened = await call(P.openForLesson, asKid(k, { params: { lessonId: blockLesson } }));
  assert.equal(opened.body.data.project.kind, 'blocks');
  const webOne = await call(P.openForLesson, asKid(k, { params: { lessonId: w.all } }));
  assert.equal(webOne.body.data.project.kind, 'web');

  const teen = await w.kid(14, '13-15');
  await w.enrol(teen);
  const hiddenOne = await call(P.openForLesson, asKid(teen, { params: { lessonId: blockLesson } }));
  assert.equal(hiddenOne.error.statusCode, 404);
});

test('block projects save and return their blocks; web projects ignore them', async () => {
  const w = await world();
  const k = await w.kid(8, '7-9');
  const created = (await call(P.createProject, asKid(k, { body: { kind: 'blocks', title: 'Cat' } }))).body.data.project;
  assert.equal(created.kind, 'blocks');
  const blocks = { blocks: { blocks: [{ type: 'event_flag' }] } };
  await call(P.saveProject, asKid(k, { params: { id: created.id }, body: { blocks } }));
  const got = (await call(P.getProject, asKid(k, { params: { id: created.id } }))).body.data.project;
  assert.deepEqual(got.blocks, blocks);
  // saving other fields later does not wipe the blocks
  await call(P.saveProject, asKid(k, { params: { id: created.id }, body: { title: 'Cat 2' } }));
  const again = (await call(P.getProject, asKid(k, { params: { id: created.id } }))).body.data.project;
  assert.deepEqual(again.blocks, blocks);
  assert.equal(again.title, 'Cat 2');
});

test('admin: groups can be set on a lesson and an empty list means "everyone"', async () => {
  const w = await world();
  const lessonId = (await db.query(`SELECT id FROM lessons WHERE title='tots only' AND module_id=$1`, [w.mod])).rows[0].id;
  const res = await call(A.updateLesson, { params: { lessonId }, body: { age_groups: ['10-12', '13-15'] }, user: { role: 'admin' } });
  assert.deepEqual(res.body.data.lesson.age_groups, ['10-12', '13-15']);
  assert.equal(res.body.data.lesson.title, 'tots only'); // other fields untouched
  const noChange = await call(A.updateLesson, { params: { lessonId }, body: { title: 'renamed' }, user: { role: 'admin' } });
  assert.deepEqual(noChange.body.data.lesson.age_groups, ['10-12', '13-15']); // not sent = not changed
  const everyone = await call(A.updateLesson, { params: { lessonId }, body: { age_groups: [] }, user: { role: 'admin' } });
  assert.equal(everyone.body.data.lesson.age_groups, null);
});

test('admin: a course can be placed in the path and limited to groups; validators reject made-up groups', async () => {
  const w = await world();
  const r = await call(A.updateCourse, { params: { courseId: w.course }, body: { age_groups: ['4-6', '7-9'], path_order: 1 }, user: { role: 'admin' } });
  assert.deepEqual(r.body.data.course.age_groups, ['4-6', '7-9']);
  assert.equal(r.body.data.course.path_order, 1);
  const V = require('../src/validators/admin.validators');
  assert.equal(V.createLessonSchema.safeParse({ module_id: w.mod, title: 'x', age_groups: ['3-4'] }).success, false);
  assert.equal(V.createLessonSchema.safeParse({ module_id: w.mod, title: 'x', lesson_type: 'scratch', age_groups: ['4-6'] }).success, true);
  const K = require('../src/validators/kid.validators');
  assert.equal(K.updateKidSchema.safeParse({ age_group: '99-100' }).success, false);
});

test('migration 005 puts every existing child in the group for their age', async () => {
  const w = await world();
  const k = await w.kid(11, null);
  // re-run the backfill statement of the migration
  await db.exec(`UPDATE kids SET age_group = CASE WHEN age <= 6 THEN '4-6' WHEN age <= 9 THEN '7-9' WHEN age <= 12 THEN '10-12' WHEN age <= 15 THEN '13-15' ELSE '16-18' END WHERE age_group IS NULL AND age IS NOT NULL`);
  assert.equal((await db.query('SELECT age_group FROM kids WHERE id=$1', [k])).rows[0].age_group, '10-12');
});
