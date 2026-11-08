/** Parent's view of a child's progress: right numbers, only for their own child. Real app, in-process Postgres. */
import './setup';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { bootDb } from './helpers/pg';

let server: http.Server;
let base = '';
let q: (sql: string, p?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
before(async () => {
  q = (await bootDb()).query;
  server = http.createServer(require('../src/app').default).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); setTimeout(() => process.exit(0), 100).unref(); });

let n = 0;
const get = async (path: string, token: string) => {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.9.0.${++n}` } });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};
const hash = bcrypt.hashSync('Passw0rd1', 4);
const parent = async (email: string, phone: string) => {
  const id = (await q(`INSERT INTO users (name,email,phone,password,role,is_verified) VALUES ('P','${email}','${phone}',$1,'parent',true) RETURNING id`, [hash])).rows[0].id;
  const res = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.1.${++n}` }, body: JSON.stringify({ email, password: 'Passw0rd1' }) });
  return { id: id as string, token: ((await res.json()) as any).accessToken as string };
};

test('a parent sees level, courses, recent lessons, projects, badges and screen time for their own child only', async () => {
  const a = await parent('kp-a@x.co', '0711000001');
  const b = await parent('kp-b@x.co', '0711000002');
  const kid = (await q(`INSERT INTO kids (parent_id,name,age,age_group,avatar,total_points,streak_days) VALUES ($1,'Amara',8,'7-9','fox',250,4) RETURNING id`, [a.id])).rows[0].id;
  const course = (await q(`INSERT INTO courses (title, price) VALUES ('Scratch Adventures', 100) RETURNING id`)).rows[0].id;
  const mod = (await q(`INSERT INTO modules (course_id, title, order_index) VALUES ($1,'M1',0) RETURNING id`, [course])).rows[0].id;
  const l = [];
  for (const [i, t] of ['One', 'Two', 'Three'].entries()) l.push((await q(`INSERT INTO lessons (module_id,title,notes,order_index) VALUES ($1,$2,'n',$3) RETURNING id`, [mod, t, i])).rows[0].id);
  const enr = (await q(`INSERT INTO enrollments (kid_id,parent_id,course_name,fee_amount,billing_cycle,status,course_id) VALUES ($1,$2,'Scratch Adventures',100,'monthly','active',$3) RETURNING id`, [kid, a.id, course])).rows[0].id;
  for (const id of [l[0], l[1]]) await q(`INSERT INTO kid_progress (kid_id,lesson_id,enrollment_id,completed,points_earned,completed_at) VALUES ($1,$2,$3,true,10,now())`, [kid, id, enr]);
  await q(`INSERT INTO kid_projects (kid_id,lesson_id,title,kind,submitted_at,marks,feedback,reviewed_at) VALUES ($1,$2,'Dance','blocks',now(),80,'Nice work!',now())`, [kid, l[0]]);
  await q(`INSERT INTO kid_projects (kid_id,title,kind) VALUES ($1,'Free play','blocks')`, [kid]);

  const r = await get(`/api/v1/kids/${kid}/progress`, a.token);
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.kid.name, 'Amara');
  assert.deepEqual([d.level.level, d.level.points, d.level.points_in_level, d.level.points_to_next, d.level.streak_days], [3, 250, 50, 50, 4]);
  assert.equal(d.totals.lessons_completed, 2);
  assert.equal(d.totals.projects_made, 2);
  assert.equal(d.totals.projects_handed_in, 1);
  assert.equal(d.totals.average_mark, 80);
  assert.equal(d.courses.length, 1);
  assert.deepEqual([d.courses[0].total_lessons, d.courses[0].completed_lessons, d.courses[0].progress, d.courses[0].next_lesson, d.courses[0].learning_now], [3, 2, 67, 'Three', true]);
  assert.equal(d.recent.length, 2);
  // lesson by lesson, billing, time spent, week comparison, account
  const mods = d.courses[0].modules;
  assert.equal(mods.length, 1);
  assert.deepEqual(mods[0].lessons.map((x: any) => [x.title, x.done]), [['One', true], ['Two', true], ['Three', false]]);
  assert.equal(Number(d.courses[0].fee_amount), 100);
  assert.equal(d.courses[0].billing_cycle, 'monthly');
  assert.equal(d.totals.lessons_this_week, 2);
  assert.equal(d.totals.lessons_last_week, 0);
  assert.deepEqual(d.time_spent, { total_seconds: 0, last_30_days_seconds: 0, learning_days: 0 });
  assert.equal(d.kid.consent_ok, false); // this test child has no consent record
  assert.equal(d.kid.has_pin, false);
  assert.ok(d.projects.find((p: any) => p.title === 'Dance').feedback === 'Nice work!');
  assert.equal(d.projects.find((p: any) => 'html' in p || 'js' in p), undefined, 'the child\'s code is not sent');
  assert.deepEqual(d.badges.filter((x: any) => x.earned).map((x: any) => x.name), ['First Step']);
  assert.deepEqual(d.quizzes, []); // no quiz table in this test database: shown as none, not an error
  assert.ok(Array.isArray(d.screen_time.last_7_days));

  // another family's parent, and nobody at all, get nothing
  assert.equal((await get(`/api/v1/kids/${kid}/progress`, b.token)).status, 404);
  const anon = await fetch(base + `/api/v1/kids/${kid}/progress`);
  assert.equal(anon.status, 401);
});
