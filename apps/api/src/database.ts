import initSqlJs, { type Database } from 'sql.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const databasePaths = new WeakMap<Database, string>();

export async function openDatabase(
  databasePath = process.env.LEDGERLINE_DATA_PATH ?? 'data/ledgerline.sqlite',
) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const SQL = await initSqlJs();
  const database = existsSync(databasePath)
    ? new SQL.Database(new Uint8Array(readFileSync(databasePath)))
    : new SQL.Database();
  databasePaths.set(database, databasePath);
  migrate(database);
  persistDatabase(database);
  return database;
}

function migrate(database: Database, directory = migrationsDirectory) {
  database.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const migrationFiles = readdirSync(directory)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort((left, right) => Number(left.split('_')[0]) - Number(right.split('_')[0]));

  for (const file of migrationFiles) {
    const version = Number(file.split('_')[0]);
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    applied.bind([version]);
    const alreadyApplied = applied.step();
    applied.free();
    if (alreadyApplied) continue;

    const applyMigration = database.prepare(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
    );
    try {
      database.run('BEGIN IMMEDIATE');
      database.run(readFileSync(join(directory, file), 'utf8'));
      applyMigration.run([version, file]);
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    } finally {
      applyMigration.free();
    }
  }
}

export function persistDatabase(database: Database) {
  const path = databasePaths.get(database);
  if (!path) throw new Error('Database was not opened by openDatabase');
  writeFileSync(path, Buffer.from(database.export()));
}

export function closeDatabase(database: Database) {
  persistDatabase(database);
  database.close();
  databasePaths.delete(database);
}
