/**
 * Migration SQL loader.
 *
 * During development/testing: loads SQL from file system
 * When bundled: the build process replaces this with an inline version
 */

let cachedMigration: string | null = null

export async function getMigrationSQL(): Promise<string> {
  if (cachedMigration) return cachedMigration

  const migrationPath = new URL('./migrations/001_initial.sql', import.meta.url).pathname
  cachedMigration = await Bun.file(migrationPath).text()
  return cachedMigration
}
