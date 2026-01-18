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

export interface ListTaskFilters {
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
  parent_id?: string | null
}

export interface Task {
  id: string
  title: string
  status: 'open' | 'in_progress' | 'completed' | 'cancelled' | 'deleted'
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

export async function task_has_children(db: Database, id: string): Promise<boolean> {
  const result = db.query<{ child_count: number }, [string]>(
    `SELECT COUNT(1) AS child_count
     FROM task_relationships
     WHERE from_task_id = ? AND type = 'parent_of'`
  ).get(id)

  return (result?.child_count ?? 0) > 0
}

export async function soft_delete_task(db: Database, id: string): Promise<boolean> {
  const result = db.run(
    `UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`,
    ['deleted', new Date().toISOString(), id]
  )

  return result.changes > 0
}

export async function list_tasks(db: Database, filters: ListTaskFilters = {}): Promise<Task[]> {
  const where: string[] = ['tasks.status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.status) {
    where.push('tasks.status = ?')
    params.push(filters.status)
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM task_relationships
        WHERE task_relationships.type = 'parent_of'
          AND task_relationships.to_task_id = tasks.id
      )`)
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM task_relationships
        WHERE task_relationships.type = 'parent_of'
          AND task_relationships.from_task_id = ?
          AND task_relationships.to_task_id = tasks.id
      )`)
      params.push(filters.parent_id)
    }
  }

  const sql = `
    SELECT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
    FROM tasks
    WHERE ${where.join(' AND ')}
    ORDER BY tasks.created_at ASC
  `

  return db.query<Task, Array<string | null>>(sql).all(...params)
}
