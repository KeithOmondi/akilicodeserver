/**
 * Decides which database a script may touch, so the MAIN database cannot be hit by accident.
 *
 *   --branch   use DATABASE_URL_BRANCH (a Neon branch / copy). Refuses if it is missing or
 *              identical to DATABASE_URL.
 *   --main     use DATABASE_URL (the real database). Must be typed on purpose.
 *   --new      use DATABASE_URL_NEW (the database you moved to).
 *   neither    refuse.
 */
const hostOf = (u) => (u || '').replace(/^.*@/, '').replace(/[/?].*$/, '');

module.exports = function dbTarget(argv = process.argv) {
  const main = process.env.DATABASE_URL;
  const branch = process.env.DATABASE_URL_BRANCH;
  const wantsBranch = argv.includes('--branch');
  const wantsMain = argv.includes('--main');
  const wantsNew = argv.includes('--new');
  if (wantsNew) {
    const url = process.env.DATABASE_URL_NEW;
    if (!url) { console.error('DATABASE_URL_NEW is not set in server/.env'); process.exit(1); }
    if (hostOf(url) === hostOf(main)) { console.error('DATABASE_URL_NEW is the same server as DATABASE_URL. Refusing.'); process.exit(1); }
    console.log('Database: NEW (' + hostOf(url) + ')');
    return url;
  }

  if (wantsBranch === wantsMain) {
    console.error('Choose the database on purpose: add --branch (safe copy) or --main (the real one).');
    process.exit(1);
  }
  if (wantsBranch) {
    if (!branch) { console.error('DATABASE_URL_BRANCH is not set in server/.env'); process.exit(1); }
    if (branch === main || hostOf(branch) === hostOf(main)) {
      console.error('DATABASE_URL_BRANCH points at the same server as DATABASE_URL. That is not a separate branch. Refusing.');
      process.exit(1);
    }
    console.log(`Database: BRANCH (${hostOf(branch)})`);
    return branch;
  }
  console.log(`Database: MAIN (${hostOf(main)})`);
  return main;
};
