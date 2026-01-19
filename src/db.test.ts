import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  create_relationship,
  create_task,
  ensure_session_link,
  get_active_work,
  get_children,
  get_parents,
  get_relationships_for_task,
  get_task,
  insert_active_work,
  list_tasks,
  migrate_db,
  relationship_exists,
  remove_active_work,
  remove_relationship,
  soft_delete_task,
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
