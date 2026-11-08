/** The starter-content seeder, run against an in-process Postgres loaded with the real schema. */
import './setup';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seedCourse, check } = require('../scripts/lib/seed-course');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const content = require('../content/programming');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const web = require('../content/programming-web');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tots = require('../content/scratch-tots');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const explorers = require('../content/scratch-explorers');

let db: any;
const client = () => ({ query: async (sql: string, p?: any[]) => { const r = await db.query(sql, p); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } });

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  db = new PGlite({ extensions: { uuid_ossp } });
  const schema = fs.readFileSync(path.join(__dirname, '../schema/schema.sql'), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, '');
  await db.exec(schema);
  for (const m of ['004_kid_projects', '005_age_groups_and_blocks', '007_free_trial']) await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/' + m + '.sql'), 'utf8'));
});

test('the Programming content is valid: 5 lessons, 10 questions, every answer points at a real option', () => {
  assert.deepEqual(check(content), []);
  assert.equal(content.lessons.length, 5);
  assert.equal(content.lessons.reduce((n: number, l: any) => n + l.questions.length, 0), 10);
  assert.ok(content.lessons.every((l: any) => l.questions.length === 2 && l.assignment));
  // answers are spread around, not always the same position
  assert.ok(new Set(content.lessons.flatMap((l: any) => l.questions.map((q: any) => q.answer))).size >= 3);
});

test('the web-page module is valid and its notes never contain raw HTML tags (they must be shown, not obeyed)', async () => {
  assert.deepEqual(check(web), []);
  assert.equal(web.lessons.length, 3);
  assert.ok(web.lessons.every((l: any) => l.questions.length === 2 && l.assignment));
  for (const l of [...web.lessons, ...content.lessons]) assert.ok(!/<\/?[a-z][a-z0-9]*[ >]/i.test(l.notes), 'raw tag in: ' + l.title);
});

test('notes avoid more than one bullet list (the lesson page renderer merges lists)', () => {
  for (const l of content.lessons) assert.ok((l.notes.match(/^- /gm) || []).length === 0, l.title);
});

test('without the course, nothing is created and the reason is clear', async () => {
  const r = await seedCourse(client(), content, { apply: true });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /Create it in Admin/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM modules')).rows[0].n, 0);
});

test('preview writes nothing; apply writes once; a second run changes nothing', async () => {
  await db.query(`INSERT INTO courses (title, description, price) VALUES ('Programming Basics','x',100)`);
  const preview = await seedCourse(client(), content);
  assert.equal(preview.ok, true);
  assert.equal(preview.applied, false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 0);

  const done = await seedCourse(client(), content, { apply: true });
  assert.equal(done.applied, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 5);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lesson_questions')).rows[0].n, 10);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM lessons WHERE assignment IS NOT NULL`)).rows[0].n, 5);

  const again = await seedCourse(client(), content, { apply: true });
  assert.equal(again.skipped, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 5);
});

test('seeded questions grade correctly with the real answer index', async () => {
  const q = (await db.query(`SELECT options, answer FROM lesson_questions LIMIT 1`)).rows[0];
  assert.ok(Array.isArray(q.options) && q.options.length === 4 && q.answer >= 0 && q.answer < 4);
});

test('the web module can be added next to the first one, and twice does nothing', async () => {
  const first = await seedCourse(client(), content, { apply: true });
  const second = await seedCourse(client(), web, { apply: true, createCourse: true, price: '4000' });
  assert.equal(first.skipped === true || first.applied === true, true);
  assert.ok(second.applied === true || second.skipped === true);
  const again = await seedCourse(client(), web, { apply: true, createCourse: true, price: '4000' });
  assert.equal(again.skipped, true);
  const mods = (await db.query(`SELECT title FROM modules ORDER BY order_index`)).rows.map((r: any) => r.title);
  assert.ok(mods.includes('Programming for Everyone') && mods.includes('Build Your First Web Page'));
});

test('the block-coding modules are valid, for the right groups, and use the block editor', () => {
  assert.deepEqual(check(tots), []);
  assert.deepEqual(check(explorers), []);
  assert.deepEqual(tots.module.ageGroups, ['4-6']);
  assert.deepEqual(explorers.module.ageGroups, ['7-9', '10-12']);
  assert.equal(tots.module.lessonType, 'scratch');
  assert.equal(tots.lessons.length, 3);
  assert.equal(explorers.lessons.length, 4);
  for (const l of [...tots.lessons, ...explorers.lessons]) {
    assert.equal(l.questions.length, 2, l.title);
    assert.ok(l.assignment, l.title);
    assert.ok(!/<\/?[a-z][a-z0-9]*[ >]/i.test(l.notes), 'raw tag in: ' + l.title);
  }
});

test('a course that does not exist is only created when asked, with a price you give, and never twice', async () => {
  await db.query('DELETE FROM courses');
  // not asked: nothing created
  const no = await seedCourse(client(), tots, { apply: true });
  assert.equal(no.ok, false);
  assert.match(no.problems[0], /--create-course/);
  // asked but no price: refused (the price is the owner's decision)
  const noPrice = await seedCourse(client(), tots, { apply: true, createCourse: true });
  assert.equal(noPrice.ok, false);
  assert.match(noPrice.problems[0], /--price/);
  const badPrice = await seedCourse(client(), tots, { apply: true, createCourse: true, price: 'free' });
  assert.equal(badPrice.ok, false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM courses')).rows[0].n, 0);
  // preview creates nothing either
  const preview = await seedCourse(client(), tots, { createCourse: true, price: '1500' });
  assert.equal(preview.ok, true);
  assert.equal(preview.createdCourse, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM courses')).rows[0].n, 0);
  // apply: the course is created with its groups, place in the path and the price given
  const made = await seedCourse(client(), tots, { apply: true, createCourse: true, price: '1500' });
  assert.equal(made.applied, true);
  const row = (await db.query("SELECT price, age_groups, path_order, is_active FROM courses WHERE title='Scratch Adventures'")).rows[0];
  assert.equal(Number(row.price), 1500);
  assert.deepEqual(row.age_groups, ['4-6', '7-9', '10-12']);
  assert.equal(row.path_order, 1);
  assert.equal(row.is_active, true);
  // the second module goes into the SAME course, no duplicate course
  const second = await seedCourse(client(), explorers, { apply: true, createCourse: true, price: '1500' });
  assert.equal(second.applied, true);
  assert.equal(second.createdCourse, false);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM courses WHERE title='Scratch Adventures'")).rows[0].n, 1);
});

test('each age group sees only its own modules in each course, in the right order', async () => {
  await db.query('DELETE FROM courses');
  // the whole starter catalogue, exactly as the real run does it
  for (const c of [tots, explorers, content, web]) assert.equal((await seedCourse(client(), c, { apply: true, createCourse: true, price: '4000' })).applied, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM courses')).rows[0].n, 3);
  const paths = (await db.query('SELECT title, path_order, age_groups FROM courses ORDER BY path_order')).rows;
  assert.deepEqual(paths.map((p: any) => p.title), ['Scratch Adventures', 'Programming Basics', 'Web Foundations']);
  assert.deepEqual(paths.map((p: any) => p.path_order), [1, 2, 3]);
  assert.deepEqual(paths[1].age_groups, ['7-9', '10-12', '13-15', '16-18']);

  const parent = (await db.query("INSERT INTO users (name,email,phone,password,is_verified) VALUES ('P','order@x.co','0799000111','x',true) RETURNING id")).rows[0].id;
  const seen = async (group: string, course: string) => {
    const k = (await db.query("INSERT INTO kids (parent_id,name,age,age_group) VALUES ($1,'K',9,$2) RETURNING id", [parent, group])).rows[0].id;
    const { rows } = await db.query(
      `SELECT m.title AS module, l.lesson_type FROM modules m JOIN lessons l ON l.module_id = m.id JOIN courses c ON c.id = m.course_id
        WHERE c.title = $1 AND (l.age_groups IS NULL OR (SELECT age_group FROM kids WHERE id = $2) = ANY(l.age_groups))
        GROUP BY m.id, m.title, m.order_index, l.lesson_type ORDER BY m.order_index`, [course, k]);
    return rows.map((r: any) => r.module + ' [' + r.lesson_type + ']');
  };
  const tot = 'Little Coders: Move the Cat [scratch]';
  const block = 'Block Coding Adventures [scratch]';
  const intro = 'Programming for Everyone [notes]';
  const webm = 'Build Your First Web Page [coding]';
  assert.deepEqual(await seen('4-6', 'Scratch Adventures'), [tot]);
  assert.deepEqual(await seen('7-9', 'Scratch Adventures'), [block]);
  assert.deepEqual(await seen('10-12', 'Scratch Adventures'), [block]);
  assert.deepEqual(await seen('13-15', 'Scratch Adventures'), []);
  assert.deepEqual(await seen('16-18', 'Scratch Adventures'), []);
  assert.deepEqual(await seen('4-6', 'Programming Basics'), []);
  assert.deepEqual(await seen('7-9', 'Programming Basics'), [intro]);
  assert.deepEqual(await seen('10-12', 'Programming Basics'), [intro]);
  assert.deepEqual(await seen('13-15', 'Programming Basics'), [intro]);
  assert.deepEqual(await seen('4-6', 'Web Foundations'), []);
  assert.deepEqual(await seen('7-9', 'Web Foundations'), []);
  assert.deepEqual(await seen('10-12', 'Web Foundations'), [webm]);
  assert.deepEqual(await seen('13-15', 'Web Foundations'), [webm]);
  assert.deepEqual(await seen('16-18', 'Web Foundations'), [webm]);
});
