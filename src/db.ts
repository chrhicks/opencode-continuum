import { Database } from 'bun:sqlite'
import { getMigrationSQL } from './migration'

export async function init_db(directory: string): Promise<Database> {
  const db = new Database(`${directory}/.arbeit/arbeit.db`)
  await migrate_db(db)
  return db
}

export async function migrate_db(db: Database): Promise<void> {
  const migration = await getMigrationSQL()
  db.run(migration)
}