import { Database } from 'bun:sqlite'
import { randomId } from './db.utils'
import { init_status_v2 } from './util.v2.ts'
import { ArbeitError } from './error'
import { getMigrationSQLV2 } from './migration_v2'

export type TaskStatusV2 = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type TaskTypeV2 = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'

export interface TaskV2 {
  id: string
  title: string
  type: TaskTypeV2
  status: TaskStatusV2 | 'deleted'
  intent: string | null
  description: string | null
  plan: string | null
  parent_id: string | null
  blocked_by: string[]
  created_at: string
  updated_at: string
}

export interface CreateTaskInputV2 {
  title: string
  type: TaskTypeV2
  status?: TaskStatusV2
  intent?: string | null
  description?: string | null
  plan?: string | null
  parent_id?: string | null
  blocked_by?: string[] | null
}

export interface UpdateTaskInputV2 {
  title?: string
  type?: TaskTypeV2
  status?: TaskStatusV2
  intent?: string | null
  description?: string | null
  plan?: string | null
  parent_id?: string | null
  blocked_by?: string[] | null
}

export interface ListTaskFiltersV2 {
  status?: TaskStatusV2
  parent_id?: string | null
}

const TASK_TYPES_V2: TaskTypeV2[] = ['epic', 'feature', 'bug', 'investigation', 'chore']

const TEMPLATE_TYPE_MAP: Record<TemplateNameV2, TaskTypeV2> = {
  epic: 'epic',
  feature: 'feature',
  bug: 'bug',
  investigation: 'investigation',
  chore: 'chore'
}

export type TemplateNameV2 = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'

export interface TemplateRecommendationV2 {
  name: TemplateNameV2
  type: TaskTypeV2
  plan_template: string
}

export const TEMPLATE_RECOMMENDATIONS_V2: Record<TemplateNameV2, TemplateRecommendationV2> = {
  epic: {
    name: 'epic',
    type: 'epic',
    plan_template: `Plan:\n- Goals:\n  - <outcomes to deliver>\n- Milestones:\n  - <major phases/modules>\n- Dependencies:\n  - <blocking work>\n`
  },
  feature: {
    name: 'feature',
    type: 'feature',
    plan_template: `Plan:\n- Changes:\n  - <steps>\n- Files:\n  - <files or areas>\n- Tests:\n  - <tests to run/add>\n- Risks:\n  - <edge cases>\n`
  },
  bug: {
    name: 'bug',
    type: 'bug',
    plan_template: `Plan:\n- Repro:\n  - <steps>\n- Fix:\n  - <approach>\n- Tests:\n  - <coverage>\n- Verify:\n  - <validation steps>\n`
  },
  investigation: {
    name: 'investigation',
    type: 'investigation',
    plan_template: `Plan:\n- Questions:\n  - <what to answer>\n- Sources:\n  - <files/docs/experiments>\n- Output:\n  - <decision + recommendation>\n`
  },
  chore: {
    name: 'chore',
    type: 'chore',
    plan_template: `Plan:\n- Changes:\n  - <steps>\n- Files:\n  - <files or areas>\n- Tests:\n  - <tests to run>\n- Safety:\n  - <backups/rollback>\n`
  }
}

interface TaskRowV2 {
  id: string
  title: string
  type: TaskTypeV2
  status: TaskStatusV2 | 'deleted'
  intent: string | null
  description: string | null
  plan: string | null
  parent_id: string | null
  blocked_by: string
  created_at: string
  updated_at: string
}

const dbCache = new Map<string, Database>()

function parse_blocked_by(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function row_to_task(row: TaskRowV2): TaskV2 {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    intent: row.intent,
    description: row.description,
    plan: row.plan,
    parent_id: row.parent_id,
    blocked_by: parse_blocked_by(row.blocked_by),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export async function get_db_v2(directory: string): Promise<Database> {
  const status = await init_status_v2({ directory })

  if (!status.pluginDirExists) {
    throw new ArbeitError('NOT_INITIALIZED', 'Arbeit is not initialized in this directory', [
      'Run `arbeit_v2_init()` to initialize arbeit v2 in this directory'
    ])
  }
  if (!status.dbFileExists) {
    throw new ArbeitError('NOT_INITIALIZED', 'Arbeit v2 database file does not exist', [
      'Run `arbeit_v2_init()` to initialize arbeit v2 in this directory'
    ])
  }

  if (dbCache.has(directory)) {
    return dbCache.get(directory)!
  }

  const db = new Database(`${directory}/.arbeit/arbeit_v2.db`)
  dbCache.set(directory, db)
  return db
}

export async function init_db_v2(directory: string): Promise<void> {
  const db = new Database(`${directory}/.arbeit/arbeit_v2.db`)
  const migrationSQL = await getMigrationSQLV2()
  db.exec(migrationSQL)
  db.close()
}

export function is_valid_task_type(type: string): type is TaskTypeV2 {
  return TASK_TYPES_V2.includes(type as TaskTypeV2)
}

export function resolve_template_type(template?: string): TaskTypeV2 | null {
  if (!template) return null
  return TEMPLATE_TYPE_MAP[template as TemplateNameV2] ?? null
}

export function get_template_recommendation(template: TemplateNameV2): TemplateRecommendationV2 {
  return TEMPLATE_RECOMMENDATIONS_V2[template]
}

export function list_template_recommendations(): TemplateRecommendationV2[] {
  return Object.values(TEMPLATE_RECOMMENDATIONS_V2)
}

export function validate_task_input(input: CreateTaskInputV2): string[] {
  const missing: string[] = []
  if (!input.title?.trim()) missing.push('title')

  switch (input.type) {
    case 'epic':
      if (!input.intent?.trim()) missing.push('intent')
      if (!input.description?.trim()) missing.push('description')
      break
    case 'feature':
    case 'bug':
      if (!input.intent?.trim()) missing.push('intent')
      if (!input.description?.trim()) missing.push('description')
      if (!input.plan?.trim()) missing.push('plan')
      break
    case 'investigation':
    case 'chore':
      if (!input.description?.trim()) missing.push('description')
      if (!input.plan?.trim()) missing.push('plan')
      break
  }

  return missing
}

export function validate_status_transition(task: TaskV2, nextStatus: TaskStatusV2): string[] {
  const missing: string[] = []
  if (nextStatus === 'in_progress') {
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      if (!task.plan?.trim()) missing.push('plan')
    }
  }

  if (nextStatus === 'completed') {
    if (!task.description?.trim()) missing.push('description')
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      if (!task.plan?.trim()) missing.push('plan')
    }
  }

  return missing
}

export async function has_open_blockers(db: Database, task: TaskV2): Promise<string[]> {
  if (task.blocked_by.length === 0) return []
  const placeholders = task.blocked_by.map(() => '?').join(', ')
  const rows = db
    .query<{ id: string; status: string }, string[]>(
      `SELECT id, status FROM tasks_v2 WHERE id IN (${placeholders}) AND status != 'deleted'`
    )
    .all(...task.blocked_by)

  const open = new Set(['open', 'in_progress'])
  return rows.filter((row) => open.has(row.status)).map((row) => row.id)
}

async function task_exists_v2(db: Database, task_id: string): Promise<boolean> {
  const row = db.query<{ count: number }, [string]>(
    `SELECT COUNT(1) AS count FROM tasks_v2 WHERE id = ? AND status != 'deleted'`
  ).get(task_id)
  return (row?.count ?? 0) > 0
}

function validate_blocker_list(task_id: string, blockers: string[]) {
  if (blockers.length === 0) return
  const seen = new Set<string>()
  for (const blocker of blockers) {
    if (blocker === task_id) {
      throw new ArbeitError('INVALID_BLOCKER', 'Task cannot block itself', [
        'Remove the task id from blocked_by.'
      ])
    }
    if (seen.has(blocker)) {
      throw new ArbeitError('DUPLICATE_BLOCKERS', 'blocked_by contains duplicate task ids', [
        'Remove duplicate ids from blocked_by.'
      ])
    }
    seen.add(blocker)
  }
}

async function validate_blockers(db: Database, blockers: string[]): Promise<string[]> {
  if (blockers.length === 0) return []
  const unique = Array.from(new Set(blockers))
  const placeholders = unique.map(() => '?').join(', ')
  const rows = db
    .query<{ id: string }, string[]>(
      `SELECT id FROM tasks_v2 WHERE id IN (${placeholders}) AND status != 'deleted'`
    )
    .all(...unique)

  const found = new Set(rows.map((row) => row.id))
  return unique.filter((id) => !found.has(id))
}

export async function create_task_v2(db: Database, input: CreateTaskInputV2): Promise<TaskV2> {
  const id = randomId('tkt')
  const created_at = new Date().toISOString()
  const updated_at = created_at
  const blocked_by = input.blocked_by ?? []

  validate_blocker_list(id, blocked_by)

  if (input.parent_id) {
    const parentExists = await task_exists_v2(db, input.parent_id)
    if (!parentExists) {
      throw new ArbeitError('PARENT_NOT_FOUND', 'Parent task not found', [
        'Verify parent_id and try again.'
      ])
    }
  }

  const missingBlockers = await validate_blockers(db, blocked_by)
  if (missingBlockers.length > 0) {
    throw new ArbeitError('BLOCKER_NOT_FOUND', `Blocking tasks not found: ${missingBlockers.join(', ')}`, [
      `Missing blocked_by IDs: ${missingBlockers.join(', ')}`
    ])
  }

  const result = db.run(
    `INSERT INTO tasks_v2 (id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [
      id,
      input.title,
      input.type,
      input.status ?? 'open',
      input.intent ?? null,
      input.description ?? null,
      input.plan ?? null,
      input.parent_id ?? null,
      JSON.stringify(blocked_by),
      created_at,
      updated_at
    ]
  )

  if (result.changes === 0) {
    throw new ArbeitError('TASK_CREATE_FAILED', 'Failed to create task')
  }

  const row = db.query<TaskRowV2, [string]>(
    `SELECT id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at
     FROM tasks_v2 WHERE id = ?`
  ).get(id)

  if (!row) {
    throw new ArbeitError('TASK_NOT_FOUND', 'Task not found after create')
  }

  return row_to_task(row)
}

export async function update_task_v2(db: Database, task_id: string, input: UpdateTaskInputV2): Promise<TaskV2> {
  const updates: string[] = []
  const params: Array<string | null> = []

  if (input.parent_id !== undefined) {
    if (input.parent_id) {
      const parentExists = await task_exists_v2(db, input.parent_id)
      if (!parentExists) {
        throw new ArbeitError('PARENT_NOT_FOUND', 'Parent task not found', [
          'Verify parent_id and try again.'
        ])
      }
    }
  }

  if (input.blocked_by !== undefined) {
    validate_blocker_list(task_id, input.blocked_by ?? [])
    const missingBlockers = await validate_blockers(db, input.blocked_by ?? [])
    if (missingBlockers.length > 0) {
      throw new ArbeitError('BLOCKER_NOT_FOUND', `Blocking tasks not found: ${missingBlockers.join(', ')}`, [
        `Missing blocked_by IDs: ${missingBlockers.join(', ')}`
      ])
    }
  }

  if (input.title !== undefined) {
    updates.push('title = ?')
    params.push(input.title)
  }
  if (input.type !== undefined) {
    updates.push('type = ?')
    params.push(input.type)
  }
  if (input.status !== undefined) {
    updates.push('status = ?')
    params.push(input.status)
  }
  if (input.intent !== undefined) {
    updates.push('intent = ?')
    params.push(input.intent)
  }
  if (input.description !== undefined) {
    updates.push('description = ?')
    params.push(input.description)
  }
  if (input.plan !== undefined) {
    updates.push('plan = ?')
    params.push(input.plan)
  }
  if (input.parent_id !== undefined) {
    updates.push('parent_id = ?')
    params.push(input.parent_id)
  }
  if (input.blocked_by !== undefined) {
    updates.push('blocked_by = ?')
    params.push(JSON.stringify(input.blocked_by ?? []))
  }

  if (updates.length === 0) {
    throw new ArbeitError('NO_CHANGES_MADE', 'No fields to update')
  }

  updates.push('updated_at = ?')
  params.push(new Date().toISOString())
  params.push(task_id)

  const result = db.run(
    `UPDATE tasks_v2 SET ${updates.join(', ')} WHERE id = ?`,
    params
  )

  if (result.changes === 0) {
    throw new ArbeitError('TASK_UPDATE_FAILED', 'Failed to update task')
  }

  const row = db.query<TaskRowV2, [string]>(
    `SELECT id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at
     FROM tasks_v2 WHERE id = ?`
  ).get(task_id)

  if (!row) {
    throw new ArbeitError('TASK_NOT_FOUND', 'Task not found after update')
  }

  return row_to_task(row)
}

export async function get_task_v2(db: Database, task_id: string): Promise<TaskV2 | null> {
  const row = db.query<TaskRowV2, [string]>(
    `SELECT id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at
     FROM tasks_v2 WHERE id = ?`
  ).get(task_id)

  return row ? row_to_task(row) : null
}

export async function list_tasks_v2(db: Database, filters: ListTaskFiltersV2 = {}): Promise<TaskV2[]> {
  const where: string[] = ['status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.status) {
    where.push('status = ?')
    params.push(filters.status)
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push('parent_id IS NULL')
    } else {
      where.push('parent_id = ?')
      params.push(filters.parent_id)
    }
  }

  const sql = `
    SELECT id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at
    FROM tasks_v2
    WHERE ${where.join(' AND ')}
    ORDER BY created_at ASC
  `

  const rows = db.query<TaskRowV2, Array<string | null>>(sql).all(...params)
  return rows.map(row_to_task)
}

export async function list_tasks_by_statuses_v2(
  db: Database,
  filters: { statuses: TaskStatusV2[]; parent_id?: string | null }
): Promise<TaskV2[]> {
  const where: string[] = ['status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.statuses.length > 0) {
    const placeholders = filters.statuses.map(() => '?').join(', ')
    where.push(`status IN (${placeholders})`)
    params.push(...filters.statuses)
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push('parent_id IS NULL')
    } else {
      where.push('parent_id = ?')
      params.push(filters.parent_id)
    }
  }

  const sql = `
    SELECT id, title, type, status, intent, description, plan, parent_id, blocked_by, created_at, updated_at
    FROM tasks_v2
    WHERE ${where.join(' AND ')}
    ORDER BY created_at ASC
  `

  const rows = db.query<TaskRowV2, Array<string | null>>(sql).all(...params)
  return rows.map(row_to_task)
}
