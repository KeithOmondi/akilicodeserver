/**
 * Adds starter lessons, quiz questions and assignments to an existing course.
 *
 *   node scripts/seed-course.js --branch                 preview on the safe Neon branch (writes nothing)
 *   node scripts/seed-course.js --branch --apply         write to the branch
 *   node scripts/seed-course.js --main --apply           write to the real database (on purpose)
 *   add  --content programming                          which file in server/content/ (default: programming)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path = require('path');
const { Client } = require('pg');
const dbTarget = require('./lib/db-target');
const { seedCourse } = require('./lib/seed-course');

(async () => {
  const url = dbTarget();
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--content');
  const name = i > -1 ? process.argv[i + 1] : 'programming';
  const content = require(path.join(__dirname, '../content', name + '.js'));

  const client = new Client({ connectionString: url, ssl: /neon\.tech|sslmode=/.test(url) ? { rejectUnauthorized: true } : false });
  await client.connect();
  try {
    const r = await seedCourse(client, content, { apply });
    if (!r.ok) { console.error('Not done:\n - ' + r.problems.join('\n - ')); process.exitCode = 1; return; }
    if (r.skipped) { console.log(r.message); return; }
    console.log(`${apply ? 'Added' : 'Would add'} to "${r.course}": module "${r.module}", ${r.lessons} lessons, ${r.questions} questions, ${r.lessons} assignments.`);
    if (!apply) console.log('Preview only. Add --apply to write it.');
  } finally {
    await client.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
