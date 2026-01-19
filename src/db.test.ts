import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  complete_progress_items,
  create_context_entry,
  create_progress_items,
  create_relationship,
  create_task,
  ensure_session_link,
  get_active_work,
  get_children,
  get_context_entries_for_task,
  get_parents,
  get_progress_items_for_task,
  get_progress_summary,
  get_relationships_for_task,
  get_task,
  insert_active_work,
  list_tasks,
  list_tasks_by_statuses,
  migrate_db,
  relationship_exists,
  remove_active_work,
  remove_relationship,
  soft_delete_task,
  supersede_context_entry,
  task_has_children,
  update_task,
  validate_relationship_input
} from './db'

async function createTestDb(): Promise<Database> {
  const db = new Database(':memory:')
  await migrate_db(db)
  return db
}

describe('db', () => {
  test('create_task stores defaults', async () => {
    const db = await createTestDb()
    try {
      const id = await create_task(db, { title: 'First task' })
      expect(id.startsWith('tkt-')).toBe(true)

      const task = await get_task(db, id)
      if (!task) throw new Error('Expected task')
      expect(task.title).toBe('First task')
      expect(task.status).toBe('open')
      expect(task.intent).toBeNull()
      expect(task.created_at).toBe(task.updated_at)
    } finally {
      db.close()
    }
  })

  test('update_task applies updates', async () => {
    const db = await createTestDb()
    try {
      const id = await create_task(db, { title: 'Original', status: 'open' })
      const updated = await update_task(db, id, { title: 'Updated', status: 'completed' })
      expect(updated).toBe(true)

      const task = await get_task(db, id)
      if (!task) throw new Error('Expected task')
      expect(task.title).toBe('Updated')
      expect(task.status).toBe('completed')
    } finally {
      db.close()
    }
  })

  test('update_task rejects empty updates', async () => {
    const db = await createTestDb()
    try {
      const id = await create_task(db, { title: 'No changes' })
      await expect(update_task(db, id, {})).rejects.toMatchObject({ code: 'NO_CHANGES_MADE' })
    } finally {
      db.close()
    }
  })

  test('list_tasks filters by status and excludes deleted', async () => {
    const db = await createTestDb()
    try {
      const openId = await create_task(db, { title: 'Open' })
      const completedId = await create_task(db, { title: 'Done', status: 'completed' })
      const deletedId = await create_task(db, { title: 'Removed' })
      await soft_delete_task(db, deletedId)

      const all = await list_tasks(db)
      const allIds = all.map((task) => task.id)
      expect(allIds).toContain(openId)
      expect(allIds).toContain(completedId)
      expect(allIds).not.toContain(deletedId)

      const completed = await list_tasks(db, { status: 'completed' })
      expect(completed).toHaveLength(1)
      expect(completed[0]!.id).toBe(completedId)
    } finally {
      db.close()
    }
  })

  test('list_tasks filters by parent and detects children', async () => {
    const db = await createTestDb()
    try {
      const parentId = await create_task(db, { title: 'Parent' })
      const childId = await create_task(db, { title: 'Child' })
      const orphanId = await create_task(db, { title: 'Orphan' })
      db.run(
        `INSERT INTO task_relationships (id, from_task_id, to_task_id, type, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['rel-1', parentId, childId, 'parent_of', new Date().toISOString()]
      )

      const children = await list_tasks(db, { parent_id: parentId })
      expect(children).toHaveLength(1)
      expect(children[0]!.id).toBe(childId)

      const roots = await list_tasks(db, { parent_id: null })
      const rootIds = roots.map((task) => task.id)
      expect(rootIds).toContain(parentId)
      expect(rootIds).toContain(orphanId)
      expect(rootIds).not.toContain(childId)

      const activeRoots = await list_tasks_by_statuses(db, { statuses: ['open', 'in_progress'], parent_id: null })
      const activeRootIds = activeRoots.map((task) => task.id)
      expect(activeRootIds).toContain(parentId)
      expect(activeRootIds).toContain(orphanId)
      expect(activeRootIds).not.toContain(childId)

      expect(await task_has_children(db, parentId)).toBe(true)
      expect(await task_has_children(db, childId)).toBe(false)
    } finally {
      db.close()
    }
  })

  test('active work and session links are idempotent', async () => {
    const db = await createTestDb()
    try {
      const taskId = await create_task(db, { title: 'Active' })
      const sessionId = 'session-1'

      expect(await insert_active_work(db, { session_id: sessionId, task_id: taskId })).toBe(true)
      expect(await insert_active_work(db, { session_id: sessionId, task_id: taskId })).toBe(false)

      const active = await get_active_work(db, sessionId)
      if (!active) throw new Error('Expected active work')
      expect(active.task_id).toBe(taskId)

      expect(await ensure_session_link(db, { session_id: sessionId, task_id: taskId })).toBe(true)
      expect(await ensure_session_link(db, { session_id: sessionId, task_id: taskId })).toBe(false)

      expect(await remove_active_work(db, { session_id: sessionId, task_id: taskId })).toBe(true)
      expect(await get_active_work(db, sessionId)).toBeNull()
    } finally {
      db.close()
    }
  })

  test('context entries can be superseded and filtered', async () => {
    const db = await createTestDb()
    try {
      const taskId = await create_task(db, { title: 'Context' })
      const entry = await create_context_entry(db, {
        task_id: taskId,
        type: 'decision',
        content: 'Use local storage',
        metadata: { source: 'notes' }
      })

      const { old_entry, new_entry } = await supersede_context_entry(db, {
        entry_id: entry.id,
        new_content: 'Use sqlite',
        metadata: null
      })

      expect(old_entry.superseded_by).toBe(new_entry.id)
      expect(new_entry.metadata).toBeNull()

      const currentOnly = await get_context_entries_for_task(db, taskId)
      expect(currentOnly).toHaveLength(1)
      expect(currentOnly[0]?.id).toBe(new_entry.id)

      const allEntries = await get_context_entries_for_task(db, taskId, { include_superseded: true })
      expect(allEntries).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  test('progress summary splits completed and remaining', async () => {
    const db = await createTestDb()
    try {
      const taskId = await create_task(db, { title: 'Progress' })
      db.run(
        `INSERT INTO progress_items (id, task_id, content, completed, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['prg-1', taskId, 'Do work', 0, new Date().toISOString()]
      )
      db.run(
        `INSERT INTO progress_items (id, task_id, content, completed, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['prg-2', taskId, 'Done work', 1, new Date().toISOString(), new Date().toISOString()]
      )

      const summary = await get_progress_summary(db, taskId)
      expect(summary.remaining).toHaveLength(1)
      expect(summary.completed).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  test('create_progress_items rejects empty input', async () => {
    const db = await createTestDb()
    try {
      const taskId = await create_task(db, { title: 'Empty' })
      await expect(create_progress_items(db, { task_id: taskId, items: [] })).rejects.toMatchObject({
        code: 'NO_CHANGES_MADE'
      })
    } finally {
      db.close()
    }
  })

  test('complete_progress_items fails on missing ids without side effects', async () => {
    const db = await createTestDb()
    try {
      const taskId = await create_task(db, { title: 'Missing' })
      const [item] = await create_progress_items(db, { task_id: taskId, items: ['Item A'] })
      if (!item) throw new Error('Expected progress item')

      await expect(complete_progress_items(db, { item_ids: [item.id, 'prg-missing'] })).rejects.toMatchObject({
        code: 'ITEM_NOT_FOUND'
      })

      const rows = await get_progress_items_for_task(db, taskId)
      expect(rows[0]?.completed).toBe(false)
      expect(rows[0]?.completed_at).toBeNull()
    } finally {
      db.close()
    }
  })

  test('complete_progress_items is idempotent and preserves completed_at', async () => {
    const db = await createTestDb()
    try {
      const taskId = await create_task(db, { title: 'Idempotent' })
      const [item] = await create_progress_items(db, { task_id: taskId, items: ['Item A'] })
      if (!item) throw new Error('Expected progress item')

      const first = await complete_progress_items(db, { item_ids: [item.id] })
      expect(first[0]?.completed).toBe(true)
      expect(first[0]?.completed_at).not.toBeNull()

      const second = await complete_progress_items(db, { item_ids: [item.id] })
      expect(second[0]?.completed).toBe(true)
      expect(second[0]?.completed_at).toBe(first[0]?.completed_at)
    } finally {
      db.close()
    }
  })

  test('relationships are stored canonically and return inbound and outbound', async () => {
    const db = await createTestDb()
    try {
      const parentId = await create_task(db, { title: 'Parent' })
      const childId = await create_task(db, { title: 'Child' })
      const blockerId = await create_task(db, { title: 'Blocker' })

      const validation = await validate_relationship_input(db, {
        from_task_id: parentId,
        to_task_id: childId,
        type: 'parent_of'
      })

      const parentRelationship = await create_relationship(db, {
        ...validation.normalized,
        metadata: { reason: 'hierarchy' }
      })

      const blockingValidation = await validate_relationship_input(db, {
        from_task_id: childId,
        to_task_id: blockerId,
        type: 'blocked_by'
      })

      const blockingRelationship = await create_relationship(db, {
        ...blockingValidation.normalized
      })

      expect(parentRelationship.type).toBe('parent_of')
      expect(parentRelationship.from_task_id).toBe(parentId)
      expect(parentRelationship.metadata?.reason).toBe('hierarchy')

      expect(blockingRelationship.type).toBe('blocks')
      expect(blockingRelationship.from_task_id).toBe(blockerId)
      expect(blockingRelationship.to_task_id).toBe(childId)

      const allForChild = await get_relationships_for_task(db, childId)
      expect(allForChild).toHaveLength(2)

      expect(await relationship_exists(db, { from_task_id: parentId, to_task_id: childId, type: 'parent_of' })).toBe(true)
      expect(await relationship_exists(db, { from_task_id: childId, to_task_id: parentId, type: 'child_of' })).toBe(true)

      expect(await get_children(db, parentId)).toEqual([childId])
      expect(await get_parents(db, childId)).toEqual([parentId])

      expect(await remove_relationship(db, { from_task_id: childId, to_task_id: parentId, type: 'child_of' })).toBe(true)
      expect(await relationship_exists(db, { from_task_id: parentId, to_task_id: childId, type: 'parent_of' })).toBe(false)
    } finally {
      db.close()
    }
  })

  test('relationship validation prevents cycles and depth overflow', async () => {
    const db = await createTestDb()
    try {
      const root = await create_task(db, { title: 'Root' })
      const level1 = await create_task(db, { title: 'Level 1' })
      const level2 = await create_task(db, { title: 'Level 2' })
      const level3 = await create_task(db, { title: 'Level 3' })
      const level4 = await create_task(db, { title: 'Level 4' })
      const level5 = await create_task(db, { title: 'Level 5' })

      await create_relationship(db, {
        ...(await validate_relationship_input(db, { from_task_id: root, to_task_id: level1, type: 'parent_of' })).normalized
      })
      await create_relationship(db, {
        ...(await validate_relationship_input(db, { from_task_id: level1, to_task_id: level2, type: 'parent_of' })).normalized
      })
      await create_relationship(db, {
        ...(await validate_relationship_input(db, { from_task_id: level2, to_task_id: level3, type: 'parent_of' })).normalized
      })
      await create_relationship(db, {
        ...(await validate_relationship_input(db, { from_task_id: level3, to_task_id: level4, type: 'parent_of' })).normalized
      })

      await expect(
        validate_relationship_input(db, { from_task_id: level4, to_task_id: level5, type: 'parent_of' })
      ).rejects.toMatchObject({ code: 'MAX_DEPTH_EXCEEDED' })

      await create_relationship(db, {
        ...(await validate_relationship_input(db, { from_task_id: root, to_task_id: level4, type: 'blocks' })).normalized
      })

      await expect(
        validate_relationship_input(db, { from_task_id: level4, to_task_id: root, type: 'blocks' })
      ).rejects.toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
    } finally {
      db.close()
    }
  })
})
