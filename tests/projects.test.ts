/**
 * Children's coding projects: ownership, assignments, hand-in rules and teacher review,
 * against an in-process Postgres loaded with the real schema + migration 004.
 */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let db: any;
let P: typeof import('../src/controllers/projectController');

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
  await db.exec(fs.readFileSync(path.join(root, 'migrations/004_kid_projects.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'migrations/005_age_groups_and_blocks.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'migrations/007_free_trial.sql'), 'utf8'));
  const run = async (sql: string, params?: any[]) => {
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  fakeModule('../src/config/db', { __esModule: true, default: { query: run, connect: async () => ({ query: run, release() {} }), on() {} }, query: run });
  P = require('../src/controllers/projectController');
});

// ── tiny req/res helpers ─────────────────────────────────────────────────────
const call = async (handler: any, req: any) => {
  let body: any; let status = 200; let error: any = null;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { body = b; return res; } };
  await handler(req, res, (e: any) => { error = e; });
  return { status, body, error };
};
const asKid = (id: string, extra: any = {}) => ({ user: { id, role: 'kid' }, params: {}, body: {}, query: {}, ...extra });
const asAdmin = (id: string, extra: any = {}) => ({ user: { id, role: 'admin' }, params: {}, body: {}, query: {}, ...extra });

let n = 0;
const world = async () => {
  n++;
  const parent = (await db.query(`INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P',$1,$2,'x',true) RETURNING id`, [`p${n}@x.co`, `07${20000000 + n}`])).rows[0].id;
  const kid = (await db.query(`INSERT INTO kids (parent_id,name,age) VALUES ($1,'Kid',9) RETURNING id`, [parent])).rows[0].id;
  const other = (await db.query(`INSERT INTO kids (parent_id,name,age) VALUES ($1,'Other',9) RETURNING id`, [parent])).rows[0].id;
  const course = (await db.query(`INSERT INTO courses (title, price) VALUES ($1, 100) RETURNING id`, [`Course ${n}`])).rows[0].id;
  const mod = (await db.query(`INSERT INTO modules (course_id, title) VALUES ($1,'M') RETURNING id`, [course])).rows[0].id;
  const withA = (await db.query(`INSERT INTO lessons (module_id,title,notes,assignment) VALUES ($1,'Build a page','n','Make a page about you') RETURNING id`, [mod])).rows[0].id;
  const noA = (await db.query(`INSERT INTO lessons (module_id,title,notes) VALUES ($1,'Just notes','n') RETURNING id`, [mod])).rows[0].id;
  const enr = (await db.query(`INSERT INTO enrollments (kid_id,parent_id,course_name,fee_amount,billing_cycle,status,course_id) VALUES ($1,$2,'C',100,'monthly','active',$3) RETURNING id`, [kid, parent, course])).rows[0].id;
  const admin = (await db.query(`INSERT INTO users (name,email,phone,password,is_verified,role) VALUES ('A',$1,$2,'x',true,'admin') RETURNING id`, [`a${n}@x.co`, `07${30000000 + n}`])).rows[0].id;
  return { parent, kid, other, course, withA, noA, enr, admin };
};

test('assignments list shows only lessons that have an assignment, in the child\'s own active courses', async () => {
  const w = await world();
  const r = await call(P.listAssignments, asKid(w.kid));
  assert.equal(r.body.data.assignments.length, 1);
  assert.equal(r.body.data.assignments[0].lesson_id, w.withA);
  const none = await call(P.listAssignments, asKid(w.other)); // the sibling has no enrollment
  assert.equal(none.body.data.assignments.length, 0);
});

test('opening an assignment creates ONE starter project and returns the same one next time', async () => {
  const w = await world();
  const a = await call(P.openForLesson, asKid(w.kid, { params: { lessonId: w.withA } }));
  assert.equal(a.status, 201);
  assert.match(a.body.data.project.html, /Hello/);
  const b = await call(P.openForLesson, asKid(w.kid, { params: { lessonId: w.withA } }));
  assert.equal(b.body.data.project.id, a.body.data.project.id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM kid_projects WHERE kid_id=$1', [w.kid])).rows[0].n, 1);
});

test('a child cannot open an assignment from a course they are not enrolled in', async () => {
  const w = await world();
  const r = await call(P.openForLesson, asKid(w.other, { params: { lessonId: w.withA } }));
  assert.equal(r.error.statusCode, 404);
});

test('a child cannot read, change, hand in or delete another child\'s project', async () => {
  const w = await world();
  const mine = (await call(P.openForLesson, asKid(w.kid, { params: { lessonId: w.withA } }))).body.data.project;
  for (const [fn, extra] of [[P.getProject, {}], [P.saveProject, { body: { html: 'x' } }], [P.submitProject, {}], [P.deleteProject, {}]] as const) {
    const r = await call(fn, asKid(w.other, { params: { id: mine.id }, ...extra }));
    assert.equal(r.error?.statusCode, 404);
  }
  assert.equal((await db.query('SELECT html FROM kid_projects WHERE id=$1', [mine.id])).rows[0].html, mine.html);
});

test('save, hand in (locks editing), take back, and the teacher marks it', async () => {
  const w = await world();
  const p = (await call(P.openForLesson, asKid(w.kid, { params: { lessonId: w.withA } }))).body.data.project;

  const saved = await call(P.saveProject, asKid(w.kid, { params: { id: p.id }, body: { html: '<h1>Me</h1>', js: 'console.log(1)' } }));
  assert.equal(saved.status, 200);
  assert.equal((await db.query('SELECT html, css FROM kid_projects WHERE id=$1', [p.id])).rows[0].html, '<h1>Me</h1>');
  assert.match((await db.query('SELECT css FROM kid_projects WHERE id=$1', [p.id])).rows[0].css, /body/); // untouched fields stay

  await call(P.submitProject, asKid(w.kid, { params: { id: p.id } }));
  const locked = await call(P.saveProject, asKid(w.kid, { params: { id: p.id }, body: { html: 'sneaky' } }));
  assert.equal(locked.error.statusCode, 409);
  const del = await call(P.deleteProject, asKid(w.kid, { params: { id: p.id } }));
  assert.equal(del.error.statusCode, 409);

  await call(P.unsubmitProject, asKid(w.kid, { params: { id: p.id } }));
  assert.equal((await call(P.saveProject, asKid(w.kid, { params: { id: p.id }, body: { html: 'ok' } }))).status, 200);

  await call(P.submitProject, asKid(w.kid, { params: { id: p.id } }));
  const queue = await call(P.adminListProjects, asAdmin(w.admin));
  assert.ok(queue.body.data.projects.some((x: any) => x.id === p.id && x.kid_name === 'Kid' && x.assignment));

  const marked = await call(P.adminReviewProject, asAdmin(w.admin, { params: { id: p.id }, body: { marks: 85, feedback: 'Nice work' } }));
  assert.equal(marked.status, 200);
  const after = (await db.query('SELECT marks, feedback, reviewed_at FROM kid_projects WHERE id=$1', [p.id])).rows[0];
  assert.equal(after.marks, 85);
  assert.ok(after.reviewed_at);

  const back = await call(P.unsubmitProject, asKid(w.kid, { params: { id: p.id } }));
  assert.equal(back.error.statusCode, 409); // marked work cannot be taken back
  const list = await call(P.listAssignments, asKid(w.kid));
  assert.equal(list.body.data.assignments[0].marks, 85);
  assert.equal(list.body.data.assignments[0].feedback, 'Nice work');
});

test('a free project cannot be handed in, and each child keeps at most 25', async () => {
  const w = await world();
  const free = (await call(P.createProject, asKid(w.kid, { body: { title: 'Fun' } }))).body.data.project;
  const r = await call(P.submitProject, asKid(w.kid, { params: { id: free.id } }));
  assert.equal(r.error.statusCode, 400);
  for (let i = 0; i < 24; i++) await call(P.createProject, asKid(w.kid, { body: {} }));
  const over = await call(P.createProject, asKid(w.kid, { body: {} }));
  assert.equal(over.error.statusCode, 409);
});

test('the teacher cannot mark work that was never handed in', async () => {
  const w = await world();
  const free = (await call(P.createProject, asKid(w.kid, { body: {} }))).body.data.project;
  const r = await call(P.adminReviewProject, asAdmin(w.admin, { params: { id: free.id }, body: { marks: 50 } }));
  assert.equal(r.error.statusCode, 404);
});

test('request validation: oversized code, bad marks and unknown fields are rejected or stripped', async () => {
  const V = require('../src/validators/project.validators');
  assert.equal(V.saveProjectSchema.safeParse({ html: 'x'.repeat(60_001) }).success, false);
  assert.equal(V.saveProjectSchema.safeParse({ html: 'x'.repeat(60_000) }).success, true);
  assert.equal(V.reviewProjectSchema.safeParse({ marks: 101 }).success, false);
  assert.equal(V.reviewProjectSchema.safeParse({ marks: -1 }).success, false);
  const stripped = V.saveProjectSchema.parse({ html: 'a', kid_id: 'someone-else', submitted_at: 'now' });
  assert.deepEqual(Object.keys(stripped), ['html']);
});

test('block projects may carry small painted pictures, but only real image data and not too much of it', () => {
  const V = require('../src/validators/project.validators');
  const sprite = (src: string) => ({ v: 3, sprites: [{ id: 's1', name: 'Cat', costumes: [{ id: 'c1', name: 'x', src }], blocks: null }] });
  const ok = (src: string) => V.saveProjectSchema.safeParse({ blocks: sprite(src) }).success;
  assert.equal(ok('lib:1f431'), true);
  assert.equal(ok('emoji:🐱'), true);
  assert.equal(ok('data:image/webp;base64,UklGRg=='), true);
  assert.equal(ok('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(ok('data:text/html;base64,PHNjcmlwdD4='), false); // not an image
  assert.equal(ok('data:image/svg+xml;base64,PHN2Zz4='), false); // svg can carry scripts: not allowed
  assert.equal(V.saveProjectSchema.safeParse({ blocks: sprite('data:image/png;base64,' + 'A'.repeat(1_600_000)) }).success, false);
});

test('the Make page offers only what the enrolled course teaches (blocks, web, or both when unclear)', async () => {
  const w = await world(); // its lessons are plain notes: no signal, so both
  assert.deepEqual((await call(P.listProjectKinds, asKid(w.kid))).body.data.kinds, ['blocks', 'web']);
  await db.query(`UPDATE lessons SET lesson_type='scratch' WHERE id=$1`, [w.withA]);
  assert.deepEqual((await call(P.listProjectKinds, asKid(w.kid))).body.data.kinds, ['blocks']);
  await db.query(`UPDATE lessons SET lesson_type='coding' WHERE id=$1`, [w.noA]);
  assert.deepEqual((await call(P.listProjectKinds, asKid(w.kid))).body.data.kinds, ['blocks', 'web']);
  await db.query(`UPDATE lessons SET lesson_type='notes' WHERE id=$1`, [w.withA]);
  assert.deepEqual((await call(P.listProjectKinds, asKid(w.kid))).body.data.kinds, ['web']);
  assert.deepEqual((await call(P.listProjectKinds, asKid(w.other))).body.data.kinds, ['blocks', 'web']); // not enrolled
});
