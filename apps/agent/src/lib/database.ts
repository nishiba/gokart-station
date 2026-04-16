import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { defaultDatabaseUrl, migrationsDir } from "../config";

const resolveSqliteFilePath = (databaseUrl: string) => {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Only sqlite file: URLs are supported, received: ${databaseUrl}`);
  }

  const filePath = databaseUrl.slice("file:".length);
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
};

export const ensureDatabaseInitialized = async (databaseUrl = defaultDatabaseUrl) => {
  const databaseFilePath = resolveSqliteFilePath(databaseUrl);
  await fs.mkdir(path.dirname(databaseFilePath), { recursive: true });

  const db = new DatabaseSync(databaseFilePath);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _station_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const migrationEntries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const migrationDirectories = migrationEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const appliedRows = db
      .prepare("SELECT migration_name FROM _station_migrations")
      .all() as Array<{ migration_name: string }>;
    const appliedNames = new Set(appliedRows.map((row) => row.migration_name));

    for (const directoryName of migrationDirectories) {
      if (appliedNames.has(directoryName)) {
        continue;
      }

      const migrationSqlPath = path.join(migrationsDir, directoryName, "migration.sql");
      const migrationSql = await fs.readFile(migrationSqlPath, "utf8");

      db.exec("BEGIN");
      try {
        db.exec(migrationSql);
        db.prepare(
          "INSERT INTO _station_migrations (migration_name, applied_at) VALUES (?, ?)",
        ).run(directoryName, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    db.close();
  }
};

export const createPrismaClient = (databaseUrl = defaultDatabaseUrl) => {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
};
