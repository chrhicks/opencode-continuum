import { Database } from 'bun:sqlite'
import { getMigrationSQL } from './migration'
import { randomId } from './db.utils'
import { init_status } from './util'
import { ArbeitError } from './error'

export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

export interface CreateTaskInput {
  title: string
  status?: TaskStatus
  intent?: string | null
}

export interface UpdateTaskInput {
  title?: string
  status?: TaskStatus
}

export interface ListTaskFilters {
  status?: TaskStatus
  parent_id?: string | null
}

export interface Task {
  id: string
  title: string
  status: TaskStatus | 'deleted'
  intent: string | null
  created_at: string
  updated_at: string
}

export type RelationshipType = 'parent_of' | 'blocks' | 'relates_to' | 'duplicates' | 'splits_from'

export type ContextType =
  | 'decision'
  | 'rationale'
  | 'attempt'
  | 'outcome'
  | 'blocker'
  | 'note'
  | 'reference'
  | 'user_input'

export const CONTEXT_TYPES: ContextType[] = [
  'decision',
  'rationale',
  'attempt',
  'outcome',
  'blocker',
  'note',
  'reference',
  'user_input'
]

export interface ContextEntry {
  id: string
  task_id: string
  type: ContextType
  content: string
  metadata: Record<string, unknown> | null
  superseded_by: string | null
  created_at: string
}

interface ContextEntryRow {
  id: string
  task_id: string
  type: ContextType
  content: string
  metadata: string | null
  superseded_by: string | null
  created_at: string
}

export interface ProgressItem {
  id: string
  task_id: string
  content: string
  completed: boolean
  created_at: string
  completed_at: string | null
}

interface ProgressItemRow {
  id: string
  task_id: string
  content: string
  completed: number
  created_at: string
  completed_at: string | null
}

export interface SessionLink {
  id: string
  task_id: string
  session_id: string
  created_at: string
}

export interface FileAssociation {
  id: string
  task_id: string
  file_path: string
  operation: 'read' | 'write'
  session_id: string | null
  created_at: string
}
export type RelationshipInputType = RelationshipType | 'child_of' | 'blocked_by' | 'duplicated_by' | 'split_into'

export interface NormalizedRelationshipInput {
  from_task_id: string
  to_task_id: string
  type: RelationshipType
}

export interface Relationship {
  id: string
  from_task_id: string
  to_task_id: string
  type: RelationshipType
  metadata: Record<string, unknown> | null
  created_at: string
}

interface RelationshipRow {
  id: string
  from_task_id: string
  to_task_id: string
  type: RelationshipType
  metadata: string | null
  created_at: string
}

export interface ActiveWork {
  session_id: string
  task_id: string
  started_at: string
}

export interface TaskRelationshipQueryResult {
  tasks: Task[]
}

export interface DescendantQueryResult {
  task_ids: string[]
}

export interface ProgressSummary {
  completed: ProgressItem[]
  remaining: ProgressItem[]
}

export interface AncestorQueryResult {
  task_ids: string[]
}

export type RelationshipValidation = {
  normalized: NormalizedRelationshipInput
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

const INVERSE_RELATIONSHIP_TYPES: Record<RelationshipInputType, { canonical: RelationshipType; swap: boolean }> = {
  parent_of: { canonical: 'parent_of', swap: false },
  child_of: { canonical: 'parent_of', swap: true },
  blocks: { canonical: 'blocks', swap: false },
  blocked_by: { canonical: 'blocks', swap: true },
  relates_to: { canonical: 'relates_to', swap: false },
  duplicates: { canonical: 'duplicates', swap: false },
  duplicated_by: { canonical: 'duplicates', swap: true },
  splits_from: { canonical: 'splits_from', swap: false },
  split_into: { canonical: 'splits_from', swap: true }
}

export const CANONICAL_RELATIONSHIP_TYPES: RelationshipType[] = [
  'parent_of',
  'blocks',
  'relates_to',
  'duplicates',
  'splits_from'
]

export function normalize_relationship_input(input: {
  from_task_id: string
  to_task_id: string
  type: RelationshipInputType
}): NormalizedRelationshipInput {
  const mapping = INVERSE_RELATIONSHIP_TYPES[input.type]
  if (mapping.swap) {
    return {
      from_task_id: input.to_task_id,
      to_task_id: input.from_task_id,
      type: mapping.canonical
    }
  }
  return {
    from_task_id: input.from_task_id,
    to_task_id: input.to_task_id,
    type: mapping.canonical
  }
}

function serialize_metadata(metadata?: Record<string, unknown>): string | null {
  if (!metadata) return null
  return JSON.stringify(metadata)
}

function parse_metadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null
  try {
    return JSON.parse(metadata) as Record<string, unknown>
  } catch (error) {
    return null
  }
}

function row_to_relationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    from_task_id: row.from_task_id,
    to_task_id: row.to_task_id,
    type: row.type,
    metadata: parse_metadata(row.metadata),
    created_at: row.created_at
  }
}

function row_to_context_entry(row: ContextEntryRow): ContextEntry {
  return {
    id: row.id,
    task_id: row.task_id,
    type: row.type,
    content: row.content,
    metadata: parse_metadata(row.metadata),
    superseded_by: row.superseded_by,
    created_at: row.created_at
  }
}

function row_to_progress_item(row: ProgressItemRow): ProgressItem {
  return {
    id: row.id,
    task_id: row.task_id,
    content: row.content,
    completed: row.completed === 1,
    created_at: row.created_at,
    completed_at: row.completed_at
  }
}

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

export async function validate_relationship_input(
  db: Database,
  input: { from_task_id: string; to_task_id: string; type: RelationshipInputType }
): Promise<RelationshipValidation> {
  if (!INVERSE_RELATIONSHIP_TYPES[input.type]) {
    throw new ArbeitError('INVALID_TYPE', 'Relationship type not recognized')
  }

  if (input.from_task_id === input.to_task_id) {
    throw new ArbeitError('CIRCULAR_DEPENDENCY', 'Relationship cannot reference the same task')
  }

  const normalized = normalize_relationship_input(input)
  const fromExists = await task_exists(db, normalized.from_task_id)
  const toExists = await task_exists(db, normalized.to_task_id)

  if (!fromExists || !toExists) {
    throw new ArbeitError('TASK_NOT_FOUND', 'Task not found')
  }

  if (await relationship_exists_normalized(db, normalized)) {
    throw new ArbeitError('RELATIONSHIP_EXISTS', 'Relationship already exists')
  }

  if (normalized.type === 'parent_of') {
    await assert_no_cycle(db, normalized, 'parent_of')
    await assert_max_depth(db, normalized.from_task_id, normalized.to_task_id)
  }

  if (normalized.type === 'blocks') {
    await assert_no_cycle(db, normalized, 'blocks')
  }

  return { normalized }
}

export async function assert_no_cycle(
  db: Database,
  input: NormalizedRelationshipInput,
  type: 'parent_of' | 'blocks'
): Promise<void> {
  const hasCycle = await has_path(db, type, input.to_task_id, input.from_task_id)
  if (hasCycle) {
    throw new ArbeitError('CIRCULAR_DEPENDENCY', 'Relationship would create a cycle')
  }
}

export async function assert_max_depth(db: Database, parent_id: string, child_id: string): Promise<void> {
  const ancestorDepth = await get_ancestor_depth(db, parent_id)
  if (ancestorDepth + 1 > 4) {
    throw new ArbeitError('MAX_DEPTH_EXCEEDED', 'Hierarchy depth would exceed maximum of 4')
  }

  const childDepth = await get_descendant_depth(db, child_id)
  if (ancestorDepth + 1 + childDepth > 4) {
    throw new ArbeitError('MAX_DEPTH_EXCEEDED', 'Hierarchy depth would exceed maximum of 4')
  }
}

async function get_ancestor_depth(db: Database, task_id: string): Promise<number> {
  const visited = new Set<string>()
  let maxDepth = 0
  let currentLevel = [task_id]

  while (currentLevel.length > 0) {
    const nextLevel: string[] = []
    for (const current of currentLevel) {
      if (visited.has(current)) continue
      visited.add(current)
      const parents = await get_parents(db, current)
      for (const parent of parents) {
        if (!visited.has(parent)) {
          nextLevel.push(parent)
        }
      }
    }

    if (nextLevel.length > 0) {
      maxDepth += 1
    }
    currentLevel = nextLevel
  }

  return maxDepth
}

async function get_descendant_depth(db: Database, task_id: string): Promise<number> {
  const visited = new Set<string>()
  let maxDepth = 0
  let currentLevel = [task_id]

  while (currentLevel.length > 0) {
    const nextLevel: string[] = []
    for (const current of currentLevel) {
      if (visited.has(current)) continue
      visited.add(current)
      const children = await get_children(db, current)
      for (const child of children) {
        if (!visited.has(child)) {
          nextLevel.push(child)
        }
      }
    }

    if (nextLevel.length > 0) {
      maxDepth += 1
    }
    currentLevel = nextLevel
  }

  return maxDepth
}

async function has_path(
  db: Database,
  type: 'parent_of' | 'blocks',
  start: string,
  target: string
): Promise<boolean> {
  const visited = new Set<string>()
  const queue = [start]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    if (current === target) return true
    visited.add(current)

    const rows = db.query<{ next_id: string }, [string, RelationshipType]>(
      `SELECT to_task_id AS next_id
       FROM task_relationships
       WHERE from_task_id = ? AND type = ?`
    ).all(current, type)

    for (const row of rows) {
      if (!visited.has(row.next_id)) {
        queue.push(row.next_id)
      }
    }
  }

  return false
}

export async function get_task(db: Database, id: string): Promise<Task | null> {
  return db.query<Task, [string]>(`SELECT id, title, status, intent, created_at, updated_at FROM tasks WHERE id = ?`).get(id)
}

export async function task_exists(db: Database, id: string): Promise<boolean> {
  const row = db.query<{ count: number }, [string]>(
    `SELECT COUNT(1) AS count FROM tasks WHERE id = ? AND status != 'deleted'`
  ).get(id)

  return (row?.count ?? 0) > 0
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

export async function list_tasks_by_statuses(
  db: Database,
  filters: { statuses: TaskStatus[]; parent_id?: string | null }
): Promise<Task[]> {
  const where: string[] = ['tasks.status != ?']
  const params: Array<string | null> = ['deleted']

  if (filters.statuses.length > 0) {
    where.push(`tasks.status IN (${sql_placeholders(filters.statuses.length)})`)
    params.push(...filters.statuses)
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

export async function create_context_entry(
  db: Database,
  input: { task_id: string; type: ContextType; content: string; metadata?: Record<string, unknown> | null }
): Promise<ContextEntry> {
  const id = randomId('ctx')
  const created_at = new Date().toISOString()
  const metadata = input.metadata ?? null
  const serializedMetadata = metadata ? serialize_metadata(metadata) : null

  const result = db.run(
    `INSERT INTO context_entries (id, task_id, type, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.task_id, input.type, input.content, serializedMetadata, created_at]
  )

  if (result.changes === 0) {
    throw new ArbeitError('CONTEXT_CREATE_FAILED', 'Failed to create context entry')
  }

  return {
    id,
    task_id: input.task_id,
    type: input.type,
    content: input.content,
    metadata,
    superseded_by: null,
    created_at
  }
}

export async function get_context_entry(db: Database, entry_id: string): Promise<ContextEntry | null> {
  const row = db
    .query<ContextEntryRow, [string]>(
      `SELECT id, task_id, type, content, metadata, superseded_by, created_at
       FROM context_entries
       WHERE id = ?`
    )
    .get(entry_id)

  return row ? row_to_context_entry(row) : null
}

export async function get_context_entries_for_task(
  db: Database,
  task_id: string,
  options: { include_superseded?: boolean } = {}
): Promise<ContextEntry[]> {
  const where = ['task_id = ?']
  if (!options.include_superseded) {
    where.push('superseded_by IS NULL')
  }

  const rows = db
    .query<ContextEntryRow, [string]>(
      `SELECT id, task_id, type, content, metadata, superseded_by, created_at
       FROM context_entries
       WHERE ${where.join(' AND ')}
       ORDER BY created_at ASC`
    )
    .all(task_id)

  return rows.map(row_to_context_entry)
}

export async function supersede_context_entry(
  db: Database,
  input: { entry_id: string; new_content: string; type?: ContextType; metadata?: Record<string, unknown> | null }
): Promise<{ old_entry: ContextEntry; new_entry: ContextEntry }> {
  const existing = await get_context_entry(db, input.entry_id)
  if (!existing) {
    throw new ArbeitError('ENTRY_NOT_FOUND', 'Context entry not found')
  }

  if (existing.superseded_by) {
    throw new ArbeitError('ALREADY_SUPERSEDED', 'Context entry already superseded')
  }

  const metadata = input.metadata !== undefined ? input.metadata : existing.metadata
  const new_entry = await create_context_entry(db, {
    task_id: existing.task_id,
    type: input.type ?? existing.type,
    content: input.new_content,
    metadata
  })

  const result = db.run(`UPDATE context_entries SET superseded_by = ? WHERE id = ?`, [new_entry.id, existing.id])

  if (result.changes === 0) {
    throw new ArbeitError('CONTEXT_SUPERSEDE_FAILED', 'Failed to supersede context entry')
  }

  return {
    old_entry: { ...existing, superseded_by: new_entry.id },
    new_entry
  }
}

function sql_placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

export async function create_progress_items(
  db: Database,
  input: { task_id: string; items: string[]; completed?: boolean }
): Promise<ProgressItem[]> {
  if (input.items.length === 0) {
    throw new ArbeitError('NO_CHANGES_MADE', 'No progress items provided', [
      'Provide at least one progress item in items.'
    ])
  }

  const taskExists = await task_exists(db, input.task_id)
  if (!taskExists) {
    throw new ArbeitError('TASK_NOT_FOUND', 'Task not found', [
      'Verify the task_id and try again.',
      'Use arbeit_task_get to confirm the task exists before adding progress.'
    ])
  }

  const insertIds: string[] = []
  const completed = input.completed === true

  db.run('BEGIN')
  try {
    for (const content of input.items) {
      const id = randomId('prg')
      const created_at = new Date().toISOString()
      const completed_at = completed ? created_at : null
      const result = db.run(
        `INSERT INTO progress_items (id, task_id, content, completed, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.task_id, content, completed ? 1 : 0, created_at, completed_at]
      )

      if (result.changes === 0) {
        throw new ArbeitError('NO_CHANGES_MADE', 'No progress items were added', [
          'Check that items contains valid text values and try again.'
        ])
      }

      insertIds.push(id)
    }

    const rows = db
      .query<ProgressItemRow, string[]>(
        `SELECT id, task_id, content, completed, created_at, completed_at
         FROM progress_items
         WHERE id IN (${sql_placeholders(insertIds.length)})`
      )
      .all(...insertIds)

    if (rows.length !== insertIds.length) {
      throw new ArbeitError('NO_CHANGES_MADE', 'Some progress items were not created', [
        'Retry the operation with valid items.'
      ])
    }

    db.run('COMMIT')

    const itemsById = new Map(rows.map((row) => [row.id, row_to_progress_item(row)]))
    return insertIds.map((id) => itemsById.get(id)!).filter(Boolean)
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export async function complete_progress_items(
  db: Database,
  input: { item_ids: string[] }
): Promise<ProgressItem[]> {
  if (input.item_ids.length === 0) {
    throw new ArbeitError('NO_CHANGES_MADE', 'No progress item IDs provided', [
      'Provide at least one progress item ID in item_ids.'
    ])
  }

  const uniqueIds: string[] = []
  const seen = new Set<string>()
  for (const id of input.item_ids) {
    if (!seen.has(id)) {
      seen.add(id)
      uniqueIds.push(id)
    }
  }

  db.run('BEGIN')
  try {
    const rows = db
      .query<{ id: string }, string[]>(
        `SELECT id
         FROM progress_items
         WHERE id IN (${sql_placeholders(uniqueIds.length)})`
      )
      .all(...uniqueIds)

    const found = new Set(rows.map((row) => row.id))
    const missing = uniqueIds.filter((id) => !found.has(id))

    if (missing.length > 0) {
      const missingList = missing.join(', ')
      throw new ArbeitError('ITEM_NOT_FOUND', `Progress items not found: ${missingList}`, [
        `Missing item_ids: ${missingList}`,
        'Use arbeit_task_get({ task_id, include: ["progress"] }) to list valid item IDs.',
        'Create missing items first with arbeit_progress_add.'
      ])
    }

    const completionTime = new Date().toISOString()
    db.run(
      `UPDATE progress_items
       SET completed = 1, completed_at = ?
       WHERE id IN (${sql_placeholders(uniqueIds.length)})
         AND completed = 0`,
      [completionTime, ...uniqueIds]
    )

    const updatedRows = db
      .query<ProgressItemRow, string[]>(
        `SELECT id, task_id, content, completed, created_at, completed_at
         FROM progress_items
         WHERE id IN (${sql_placeholders(uniqueIds.length)})`
      )
      .all(...uniqueIds)

    db.run('COMMIT')

    const itemsById = new Map(updatedRows.map((row) => [row.id, row_to_progress_item(row)]))
    return uniqueIds.map((id) => itemsById.get(id)!).filter(Boolean)
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export async function get_progress_items_for_task(db: Database, task_id: string): Promise<ProgressItem[]> {
  const rows = db
    .query<ProgressItemRow, [string]>(
      `SELECT id, task_id, content, completed, created_at, completed_at
       FROM progress_items
       WHERE task_id = ?
       ORDER BY created_at ASC`
    )
    .all(task_id)

  return rows.map(row_to_progress_item)
}

export async function get_progress_summary(db: Database, task_id: string): Promise<ProgressSummary> {
  const items = await get_progress_items_for_task(db, task_id)
  return {
    completed: items.filter((item) => item.completed),
    remaining: items.filter((item) => !item.completed)
  }
}

export async function get_session_links_for_task(db: Database, task_id: string): Promise<SessionLink[]> {
  return db
    .query<SessionLink, [string]>(
      `SELECT id, task_id, session_id, created_at
       FROM session_links
       WHERE task_id = ?
       ORDER BY created_at ASC`
    )
    .all(task_id)
}

export async function get_file_associations_for_task(db: Database, task_id: string): Promise<FileAssociation[]> {
  return db
    .query<FileAssociation, [string]>(
      `SELECT id, task_id, file_path, operation, session_id, created_at
       FROM file_associations
       WHERE task_id = ?
       ORDER BY created_at ASC`
    )
    .all(task_id)
}

export async function get_parent_task(db: Database, task_id: string): Promise<Task | null> {
  return db
    .query<Task, [string]>(
      `SELECT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
       FROM tasks
       INNER JOIN task_relationships
         ON task_relationships.from_task_id = tasks.id
       WHERE task_relationships.to_task_id = ?
         AND task_relationships.type = 'parent_of'
         AND tasks.status != 'deleted'
       ORDER BY task_relationships.created_at ASC
       LIMIT 1`
    )
    .get(task_id)
}

export async function get_blocked_by_tasks(db: Database, task_id: string): Promise<Task[]> {
  return db
    .query<Task, [string]>(
      `SELECT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
       FROM tasks
       INNER JOIN task_relationships
         ON task_relationships.from_task_id = tasks.id
       WHERE task_relationships.to_task_id = ?
         AND task_relationships.type = 'blocks'
         AND tasks.status != 'deleted'
       ORDER BY task_relationships.created_at ASC`
    )
    .all(task_id)
}

export async function get_blocking_tasks_for_task(db: Database, task_id: string): Promise<Task[]> {
  return db
    .query<Task, [string]>(
      `SELECT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
       FROM tasks
       INNER JOIN task_relationships
         ON task_relationships.to_task_id = tasks.id
       WHERE task_relationships.from_task_id = ?
         AND task_relationships.type = 'blocks'
         AND tasks.status != 'deleted'
       ORDER BY task_relationships.created_at ASC`
    )
    .all(task_id)
}

export async function get_active_work(db: Database, session_id: string): Promise<ActiveWork | null> {
  return db
    .query<ActiveWork, [string]>(`SELECT session_id, task_id, started_at FROM active_work WHERE session_id = ?`)
    .get(session_id)
}

export async function insert_active_work(db: Database, input: { session_id: string; task_id: string }): Promise<boolean> {
  const result = db.run(
    `INSERT OR IGNORE INTO active_work (session_id, task_id, started_at) VALUES (?, ?, ?)`,
    [input.session_id, input.task_id, new Date().toISOString()]
  )

  return result.changes > 0
}

export async function remove_active_work(db: Database, input: { session_id: string; task_id: string }): Promise<boolean> {
  const result = db.run(
    `DELETE FROM active_work WHERE session_id = ? AND task_id = ?`,
    [input.session_id, input.task_id]
  )

  return result.changes > 0
}

export async function ensure_session_link(db: Database, input: { session_id: string; task_id: string }): Promise<boolean> {
  const result = db.run(
    `INSERT OR IGNORE INTO session_links (id, task_id, session_id, created_at) VALUES (?, ?, ?, ?)`,
    [randomId('ses'), input.task_id, input.session_id, new Date().toISOString()]
  )

  return result.changes > 0
}

export async function create_relationship(
  db: Database,
  input: {
    from_task_id: string
    to_task_id: string
    type: RelationshipInputType
    metadata?: Record<string, unknown>
  }
): Promise<Relationship> {
  const normalized = normalize_relationship_input(input)
  const id = randomId('rel')
  const created_at = new Date().toISOString()
  const result = db.run(
    `INSERT INTO task_relationships (id, from_task_id, to_task_id, type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, normalized.from_task_id, normalized.to_task_id, normalized.type, serialize_metadata(input.metadata), created_at]
  )

  if (result.changes === 0) {
    throw new ArbeitError('RELATIONSHIP_CREATE_FAILED', 'Failed to create task relationship')
  }

  return {
    id,
    from_task_id: normalized.from_task_id,
    to_task_id: normalized.to_task_id,
    type: normalized.type,
    metadata: input.metadata ?? null,
    created_at
  }
}

export async function remove_relationship(
  db: Database,
  input: { from_task_id: string; to_task_id: string; type: RelationshipInputType }
): Promise<boolean> {
  const normalized = normalize_relationship_input(input)
  const result = db.run(
    `DELETE FROM task_relationships WHERE from_task_id = ? AND to_task_id = ? AND type = ?`,
    [normalized.from_task_id, normalized.to_task_id, normalized.type]
  )

  return result.changes > 0
}

export async function get_relationships_for_task(db: Database, task_id: string): Promise<Relationship[]> {
  const rows = db.query<RelationshipRow, [string, string]>(
    `SELECT id, from_task_id, to_task_id, type, metadata, created_at
     FROM task_relationships
     WHERE from_task_id = ? OR to_task_id = ?
     ORDER BY created_at ASC`
  ).all(task_id, task_id)

  return rows.map(row_to_relationship)
}

export async function get_children(db: Database, task_id: string): Promise<string[]> {
  const rows = db.query<{ child_id: string }, [string]>(
    `SELECT to_task_id AS child_id
     FROM task_relationships
     WHERE from_task_id = ? AND type = 'parent_of'
     ORDER BY created_at ASC`
  ).all(task_id)

  return rows.map((row) => row.child_id)
}

export async function get_parents(db: Database, task_id: string): Promise<string[]> {
  const rows = db.query<{ parent_id: string }, [string]>(
    `SELECT from_task_id AS parent_id
     FROM task_relationships
     WHERE to_task_id = ? AND type = 'parent_of'
     ORDER BY created_at ASC`
  ).all(task_id)

  return rows.map((row) => row.parent_id)
}

export async function relationship_exists(
  db: Database,
  input: { from_task_id: string; to_task_id: string; type: RelationshipInputType }
): Promise<boolean> {
  const normalized = normalize_relationship_input(input)
  const row = db.query<{ count: number }, [string, string, RelationshipType]>(
    `SELECT COUNT(1) AS count
     FROM task_relationships
     WHERE from_task_id = ? AND to_task_id = ? AND type = ?`
  ).get(normalized.from_task_id, normalized.to_task_id, normalized.type)

  return (row?.count ?? 0) > 0
}

export async function relationship_exists_normalized(
  db: Database,
  input: NormalizedRelationshipInput
): Promise<boolean> {
  const row = db.query<{ count: number }, [string, string, RelationshipType]>(
    `SELECT COUNT(1) AS count
     FROM task_relationships
     WHERE from_task_id = ? AND to_task_id = ? AND type = ?`
  ).get(input.from_task_id, input.to_task_id, input.type)

  return (row?.count ?? 0) > 0
}

export async function query_children_of(db: Database, task_id: string): Promise<Task[]> {
  return db.query<Task, [string]>(
    `SELECT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
     FROM tasks
     INNER JOIN task_relationships
       ON task_relationships.to_task_id = tasks.id
     WHERE task_relationships.from_task_id = ?
       AND task_relationships.type = 'parent_of'
       AND tasks.status != 'deleted'
     ORDER BY tasks.created_at ASC`
  ).all(task_id)
}

export async function query_descendants_of(db: Database, task_id: string): Promise<string[]> {
  const visited = new Set<string>()
  const queue = [task_id]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)

    const rows = db.query<{ child_id: string }, [string]>(
      `SELECT to_task_id AS child_id
       FROM task_relationships
       WHERE from_task_id = ? AND type = 'parent_of'`
    ).all(current)

    for (const row of rows) {
      if (!visited.has(row.child_id)) {
        queue.push(row.child_id)
      }
    }
  }

  visited.delete(task_id)
  return Array.from(visited)
}

export async function query_ancestors_of(db: Database, task_id: string): Promise<string[]> {
  const visited = new Set<string>()
  const queue = [task_id]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)

    const rows = db.query<{ parent_id: string }, [string]>(
      `SELECT from_task_id AS parent_id
       FROM task_relationships
       WHERE to_task_id = ? AND type = 'parent_of'`
    ).all(current)

    for (const row of rows) {
      if (!visited.has(row.parent_id)) {
        queue.push(row.parent_id)
      }
    }
  }

  visited.delete(task_id)
  return Array.from(visited)
}

export async function query_blocked_tasks(db: Database, status?: TaskStatus): Promise<Task[]> {
  const params: Array<string | null> = []
  const where: string[] = ["tasks.status != 'deleted'"]

  if (status) {
    where.push('tasks.status = ?')
    params.push(status)
  }

  const sql = `
    SELECT DISTINCT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
    FROM tasks
    INNER JOIN task_relationships
      ON task_relationships.to_task_id = tasks.id
    WHERE task_relationships.type = 'blocks'
      AND ${where.join(' AND ')}
    ORDER BY tasks.created_at ASC
  `

  return db.query<Task, Array<string | null>>(sql).all(...params)
}

export async function query_blocking_tasks(db: Database, status?: TaskStatus): Promise<Task[]> {
  const params: Array<string | null> = []
  const where: string[] = ["tasks.status != 'deleted'"]

  if (status) {
    where.push('tasks.status = ?')
    params.push(status)
  }

  const sql = `
    SELECT DISTINCT tasks.id, tasks.title, tasks.status, tasks.intent, tasks.created_at, tasks.updated_at
    FROM tasks
    INNER JOIN task_relationships
      ON task_relationships.from_task_id = tasks.id
    WHERE task_relationships.type = 'blocks'
      AND ${where.join(' AND ')}
    ORDER BY tasks.created_at ASC
  `

  return db.query<Task, Array<string | null>>(sql).all(...params)
}
