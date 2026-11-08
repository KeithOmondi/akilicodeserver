import pool from '../config/db';

/**
 * The code below needs these database changes. If one is missing, lessons would fail in confusing ways for every child,
 * so the server refuses to start and says exactly what to run. On Render a start-up failure keeps the previous
 * (working) version live, so forgetting a migration is a failed deploy, not an outage.
 */
const REQUIRED: { table: string; column: string; migration: string }[] = [
  { table: 'enrollments', column: 'trial_ends_at', migration: '007_free_trial' },
];

export const assertDatabaseIsMigrated = async (): Promise<void> => {
  for (const r of REQUIRED) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [r.table, r.column]
    );
    if (rows.length === 0) {
      throw new Error(
        `The database is missing ${r.table}.${r.column} (migration ${r.migration}). ` +
          `Run "node scripts/migrate.js --main" from the server folder, then deploy again.`
      );
    }
  }
};
