import bcrypt from 'bcryptjs';
import pool from './config/db';

/**
 * Creates the FIRST admin account. Run once on a new database:
 *
 *   SEED_ADMIN_NAME="Your Name" SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PHONE=+2547XXXXXXXX \
 *   SEED_ADMIN_PASSWORD='a-long-private-password' npx ts-node src/seed.ts
 *
 * The details come from the command line, never from this file: a password written here ends up
 * in git history. Pick a password of 12+ characters and do not reuse one.
 */
const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See the comment at the top of src/seed.ts.`);
    process.exit(1);
  }
  return v;
};

const seedAdmin = async () => {
  const name = required('SEED_ADMIN_NAME');
  const email = required('SEED_ADMIN_EMAIL').toLowerCase().trim();
  const phone = required('SEED_ADMIN_PHONE').replace(/\s+/g, '');
  const password = required('SEED_ADMIN_PASSWORD');
  if (password.length < 12) {
    console.error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log('An account with that email already exists. Nothing changed.');
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users (name, email, phone, password, role, is_verified)
       VALUES ($1, $2, $3, $4, 'admin', true)`,
      [name, email, phone, hash]
    );
    console.log(`Admin account created for ${email}.`);
  } finally {
    client.release();
    await pool.end();
  }
};

seedAdmin().catch((e) => {
  console.error('Seeding failed:', e.message);
  process.exit(1);
});
