/**
 * Migration SQL loader for v2.
 *
 * During development/testing: loads SQL from file system
 * When bundled: the build process replaces this with an inline version
 */

let cachedMigration: string | null = null

export async function getMigrationSQLV2(): Promise<string> {
  if (cachedMigration) return cachedMigration

  const migrationPath = new URL('./migrations/002_v2_initial.sql', import.meta.url).pathname
  cachedMigration = await Bun.file(migrationPath).text()
  return cachedMigration
}
