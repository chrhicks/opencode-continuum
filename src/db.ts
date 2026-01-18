import { Database } from 'bun:sqlite'
import { getMigrationSQL } from './migration'
import { randomId } from './db.utils'
import { init_status } from './util'
import { ArbeitError } from './error'

export interface CreateTaskInput {
  title: string
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
  intent?: string | null
}

export interface UpdateTaskInput {
  title?: string
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
}

export interface Task {
  id: string
  title: string
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  intent: string | null
  created_at: string
  updated_at: string
}

export async function init_db(directory: string): Promise<Database> {
  const db = new Database(`${directory}/.arbeit/arbeit.db`)
  await migrate_db(db)
  return db
}

export async function migrate_db(db: Database): Promise<void> {
  const migration = await getMigrationSQL()
  db.run(migration)
}

const dbCache = new Map<string, Database>()

export async function get_db(directory: string): Promise<Database> {
  const status = await init_status({ directory })
  
  if (!status.pluginDirExists) {
    throw new ArbeitError('NOT_INITIALIZED', 'Arbeit is not initialized in this directory', ['Run `arbeit_init()` to initialize arbeit in this directory'])
  }
  if (!status.dbFileExists) {
    throw new ArbeitError('NOT_INITIALIZED', 'Arbeit database file does not exist', ['Run `arbeit_init()` to initialize arbeit in this directory'])
  }

  if (dbCache.has(directory)) {
    return dbCache.get(directory)!
  }
  
  const db = new Database(`${directory}/.arbeit/arbeit.db`)
  dbCache.set(directory, db)
  return db
}

export async function create_task(db: Database, taskInput: CreateTaskInput): Promise<string> {
  const id = randomId('tkt')
  const created_at = new Date().toISOString()
  const updated_at = created_at

  const result = db.run(`INSERT INTO tasks (id, title, status, intent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, taskInput.title, taskInput.status ?? 'open', taskInput.intent ?? null, created_at, updated_at]
  )

  if (result.changes === 0) {
    throw new ArbeitError('TASK_CREATE_FAILED', 'Failed to create task')
  }

  return id
}

export async function get_task(db: Database, id: string): Promise<Task | null> {
  return db.query<Task, [string]>(`SELECT id, title, status, intent, created_at, updated_at FROM tasks WHERE id = ?`).get(id)
}

export async function update_task(db: Database, id: string, taskInput: UpdateTaskInput): Promise<boolean> {
  const updates: string[] = []
  const params: Array<string | null> = []

  if (taskInput.title) {
    updates.push('title = ?')
    params.push(taskInput.title)
  }
  if (taskInput.status) {
    updates.push('status = ?')
    params.push(taskInput.status)
  }

  if (updates.length === 0) {
    throw new ArbeitError('NO_CHANGES_MADE', 'No fields to update')
  }

  updates.push('updated_at = ?')
  params.push(new Date().toISOString())

  params.push(id)

  const result = db.run(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
    params
  )

  return result.changes > 0
}