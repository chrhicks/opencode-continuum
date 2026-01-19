import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { get_db, type Task } from './db'
import {
  arbeit_context_add,
  arbeit_init,
  arbeit_progress_add,
  arbeit_progress_complete,
  arbeit_task_brief,
  arbeit_task_create,
  arbeit_task_delete,
  arbeit_task_get,
  arbeit_relationship,
  arbeit_query,
  arbeit_task_start_work,
  arbeit_task_stop_work,
  arbeit_task_update
} from './tools'

type ArbeitResponse<T> = {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    suggestions?: string[]
  }
}

async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'arbeit-tools-'))
}

async function runTool<T>(toolInstance: any, args: any, context?: any): Promise<ArbeitResponse<T>> {
  const raw = context === undefined ? await toolInstance.execute(args) : await toolInstance.execute(args, context)
  return JSON.parse(raw) as ArbeitResponse<T>
}

async function closeDb(directory: string) {
  try {
    const db = await get_db(directory)
    db.close()
  } catch (error) {
    // ignore when directory was never initialized
  }
}

function expectSuccess<T>(response: ArbeitResponse<T>): T {
  expect(response.success).toBe(true)
  if (!response.success || !response.data) {
    throw new Error('Expected success response')
  }
  return response.data
}

describe('tools', () => {
  test('arbeit_init creates the .arbeit database', async () => {
    const directory = await createTempDir()
    try {
      const initTool = arbeit_init({ directory })
      const response = await runTool<{ initialized: boolean; path: string }>(initTool, {})
      const data = expectSuccess(response)
      expect(data.initialized).toBe(true)
      expect(data.path).toBe(directory)

      const dbExists = await Bun.file(`${directory}/.arbeit/arbeit.db`).exists()
      expect(dbExists).toBe(true)
    } finally {
      await closeDb(directory)
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('task tools', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await createTempDir()
    const initTool = arbeit_init({ directory })
    const response = await runTool<{ initialized: boolean; path: string }>(initTool, {})
    expectSuccess(response)
  })

  afterEach(async () => {
    await closeDb(directory)
    await rm(directory, { recursive: true, force: true })
  })

  test('create and get tasks', async () => {
    const createTool = arbeit_task_create({ directory })
    const createResponse = await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Build tools' })
    const created = expectSuccess(createResponse)
    expect(created.relationships).toHaveLength(0)

    const taskId = created.task.id
    expect(taskId.startsWith('tkt-')).toBe(true)
    expect(created.task.status).toBe('open')

    const getTool = arbeit_task_get({ directory })
    const getResponse = await runTool<{ task: Task; relationships: unknown[]; context: unknown[]; progress: unknown[] }>(
      getTool,
      { task_id: taskId, include: ['relationships', 'context', 'progress'] }
    )
    const fetched = expectSuccess(getResponse)
    expect(fetched.task.id).toBe(taskId)
    expect(fetched.relationships).toHaveLength(0)
    expect(fetched.context).toHaveLength(0)
    expect(fetched.progress).toHaveLength(0)
  })

  test('task_get supports briefing include defaults', async () => {
    const createTool = arbeit_task_create({ directory })
    const getTool = arbeit_task_get({ directory })

    const created = expectSuccess(await runTool<{ task: Task }>(createTool, { title: 'Briefing' }))

    const getResponse = await runTool<{ task: Task; progress_summary: unknown }>(getTool, {
      task_id: created.task.id,
      briefing: true
    })
    const fetched = expectSuccess(getResponse)
    expect(fetched.task.id).toBe(created.task.id)
    expect(fetched.progress_summary).toBeDefined()
  })

  test('task_brief returns child context and progress summary', async () => {
    const createTool = arbeit_task_create({ directory })
    const addTool = arbeit_progress_add({ directory })
    const contextTool = arbeit_context_add({ directory })
    const briefTool = arbeit_task_brief({ directory })

    const parent = expectSuccess(await runTool<{ task: Task }>(createTool, { title: 'Parent' }))
    const child = expectSuccess(
      await runTool<{ task: Task }>(createTool, { title: 'Child', parent_id: parent.task.id })
    )

    await runTool(addTool, { task_id: child.task.id, items: ['Step 1'] })
    await runTool(contextTool, { task_id: child.task.id, type: 'note', content: 'Child context' })

    const briefResponse = await runTool<{
      task: Task
      children: Array<{ task: Task; context: Array<{ id: string }>; progress_summary: { completed: unknown[]; remaining: unknown[] } }>
    }>(briefTool, { task_id: parent.task.id })

    const brief = expectSuccess(briefResponse)
    expect(brief.children).toHaveLength(1)
    expect(brief.children[0]?.context).toHaveLength(1)
    expect(brief.children[0]?.progress_summary).toBeDefined()
  })

  test('get task returns error for missing id', async () => {
    const getTool = arbeit_task_get({ directory })
    const response = await runTool<{ task: Task }>(getTool, { task_id: 'tkt-missing', include: ['relationships'] })
    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('TASK_NOT_FOUND')
  })

  test('update task applies changes and rejects empty updates', async () => {
    const createTool = arbeit_task_create({ directory })
    const createResponse = await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Original' })
    const created = expectSuccess(createResponse)

    const updateTool = arbeit_task_update({ directory })
    const updateResponse = await runTool<{ task: Task }>(
      updateTool,
      { task_id: created.task.id, title: 'Updated', status: 'completed' }
    )
    const updated = expectSuccess(updateResponse)
    expect(updated.task.title).toBe('Updated')
    expect(updated.task.status).toBe('completed')

    const emptyUpdate = await runTool<{ task: Task }>(updateTool, { task_id: created.task.id })
    expect(emptyUpdate.success).toBe(false)
    expect(emptyUpdate.error?.code).toBe('NO_CHANGES_MADE')
  })

  test('context tools add and supersede entries', async () => {
    const createTool = arbeit_task_create({ directory })
    const contextAddTool = arbeit_context_add({ directory })
    const getTool = arbeit_task_get({ directory })

    const created = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Context' }))

    const addedResponse = await runTool<{ entry: { id: string; content: string } }>(contextAddTool, {
      task_id: created.task.id,
      type: 'decision',
      content: 'Use local storage',
      metadata: { source: 'notes' }
    })
    const added = expectSuccess(addedResponse)

    const supersedeResponse = await runTool<{
      entry: { id: string; metadata: Record<string, unknown> | null }
      superseded: { id: string; superseded_by: string | null }
    }>(contextAddTool, {
      task_id: created.task.id,
      type: 'decision',
      content: 'Use sqlite',
      supersede_entry_id: added.entry.id
    })
    const superseded = expectSuccess(supersedeResponse)
    expect(superseded.superseded.id).toBe(added.entry.id)
    expect(superseded.superseded.superseded_by).toBe(superseded.entry.id)
    expect(superseded.entry.metadata).toEqual({ source: 'notes' })

    const getResponse = await runTool<{ context: { id: string }[] }>(getTool, {
      task_id: created.task.id,
      include: ['context']
    })
    const getData = expectSuccess(getResponse)
    expect(getData.context).toHaveLength(1)
    expect(getData.context[0]?.id).toBe(superseded.entry.id)

    const briefingResponse = await runTool<{ context: { id: string }[]; recent_events: unknown[] }>(
      getTool,
      { task_id: created.task.id, include: ['context_all', 'recent_events'] }
    )
    const briefing = expectSuccess(briefingResponse)
    expect(briefing.context).toHaveLength(2)
    expect(briefing.recent_events).toHaveLength(0)
  })

  test('progress tools add and complete items', async () => {
    const createTool = arbeit_task_create({ directory })
    const progressAddTool = arbeit_progress_add({ directory })
    const progressCompleteTool = arbeit_progress_complete({ directory })
    const getTool = arbeit_task_get({ directory })

    const created = expectSuccess(await runTool<{ task: Task }>(createTool, { title: 'Progress' }))

    const addResponse = await runTool<{ items: { id: string; completed: boolean }[] }>(progressAddTool, {
      task_id: created.task.id,
      items: ['First step', 'Second step']
    })
    const added = expectSuccess(addResponse)
    expect(added.items).toHaveLength(2)
    expect(added.items[0]?.completed).toBe(false)

    const completedResponse = await runTool<{ completed: { id: string; completed: boolean }[] }>(progressCompleteTool, {
      item_ids: [added.items[0]!.id, added.items[1]!.id]
    })
    const completed = expectSuccess(completedResponse)
    expect(completed.completed).toHaveLength(2)
    expect(completed.completed.every((item) => item.completed)).toBe(true)

    const getResponse = await runTool<{ progress: { id: string }[]; progress_summary: { completed: any[]; remaining: any[] } }>(
      getTool,
      { task_id: created.task.id, include: ['progress', 'progress_summary'] }
    )
    const getData = expectSuccess(getResponse)
    expect(getData.progress).toHaveLength(2)
    expect(getData.progress_summary.completed).toHaveLength(2)
    expect(getData.progress_summary.remaining).toHaveLength(0)
  })

  test('list tasks filters by status and excludes deleted', async () => {
    const createTool = arbeit_task_create({ directory })
    const deleteTool = arbeit_task_delete({ directory })
    const queryTool = arbeit_query({ directory })

    const openTask = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Open' }))
    const doneTask = expectSuccess(
      await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Done', status: 'completed' })
    )
    const deletedTask = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Delete' }))

    await runTool<{ deleted: boolean }>(deleteTool, { task_id: deletedTask.task.id })

    const allResponse = await runTool<{ tasks: Task[] }>(queryTool, { query: 'tasks' })
    const all = expectSuccess(allResponse)
    const allIds = all.tasks.map((task) => task.id)
    expect(allIds).toContain(openTask.task.id)
    expect(allIds).toContain(doneTask.task.id)
    expect(allIds).not.toContain(deletedTask.task.id)

    const completedResponse = await runTool<{ tasks: Task[] }>(queryTool, {
      query: 'tasks',
      params: { status: 'completed' }
    })
    const completed = expectSuccess(completedResponse)
    expect(completed.tasks).toHaveLength(1)
    expect(completed.tasks[0]!.id).toBe(doneTask.task.id)

    const activeResponse = await runTool<{ tasks: Task[] }>(queryTool, {
      query: 'active_tasks'
    })
    const active = expectSuccess(activeResponse)
    const activeIds = active.tasks.map((task) => task.id)
    expect(activeIds).toContain(openTask.task.id)
    expect(activeIds).not.toContain(doneTask.task.id)
  })

  test('delete task blocks tasks with children', async () => {
    const createTool = arbeit_task_create({ directory })
    const deleteTool = arbeit_task_delete({ directory })

    const parent = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Parent' }))
    const child = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Child' }))

    const db = await get_db(directory)
    db.run(
      `INSERT INTO task_relationships (id, from_task_id, to_task_id, type, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['rel-1', parent.task.id, child.task.id, 'parent_of', new Date().toISOString()]
    )

    const response = await runTool<{ deleted: boolean }>(deleteTool, { task_id: parent.task.id })
    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('HAS_CHILDREN')
  })

  test('start and stop work enforce session rules', async () => {
    const createTool = arbeit_task_create({ directory })
    const startTool = arbeit_task_start_work({ directory })
    const stopTool = arbeit_task_stop_work({ directory })

    const primary = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Primary' }))
    const secondary = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Secondary' }))

    const context = { sessionID: 'session-1' }
    const startResponse = await runTool<{ task: Task; session_linked: boolean }>(
      startTool,
      { task_id: primary.task.id },
      context
    )
    const started = expectSuccess(startResponse)
    expect(started.task.status).toBe('in_progress')

    const conflictResponse = await runTool<{ task: Task }>(
      startTool,
      { task_id: secondary.task.id },
      context
    )
    expect(conflictResponse.success).toBe(false)
    expect(conflictResponse.error?.code).toBe('ALREADY_WORKING')

    const stopResponse = await runTool<{ stopped: boolean }>(
      stopTool,
      { task_id: primary.task.id },
      context
    )
    const stopped = expectSuccess(stopResponse)
    expect(stopped.stopped).toBe(true)

    const stopAgain = await runTool<{ stopped: boolean }>(
      stopTool,
      { task_id: primary.task.id },
      context
    )
    expect(stopAgain.success).toBe(false)
    expect(stopAgain.error?.code).toBe('NOT_WORKING_ON_TASK')
  })

  test('relationship tools validate and normalize', async () => {
    const createTool = arbeit_task_create({ directory })
    const relationshipTool = arbeit_relationship({ directory })

    const parent = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Parent' }))
    const child = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Child' }))
    const blocker = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Blocker' }))

    const addResponse = await runTool<{ relationship: { type: string; from_task_id: string; to_task_id: string } }>(
      relationshipTool,
      {
        action: 'add',
        from_task_id: child.task.id,
        to_task_id: blocker.task.id,
        type: 'blocked_by',
        metadata: { reason: 'dependency' }
      }
    )

    const added = expectSuccess(addResponse)
    expect(added.relationship.type).toBe('blocks')
    expect(added.relationship.from_task_id).toBe(blocker.task.id)
    expect(added.relationship.to_task_id).toBe(child.task.id)

    const duplicate = await runTool<{ relationship: { type: string } }>(relationshipTool, {
      action: 'add',
      from_task_id: blocker.task.id,
      to_task_id: child.task.id,
      type: 'blocks'
    })
    expect(duplicate.success).toBe(false)
    expect(duplicate.error?.code).toBe('RELATIONSHIP_EXISTS')

    const removeResponse = await runTool<{ removed: boolean }>(relationshipTool, {
      action: 'remove',
      from_task_id: child.task.id,
      to_task_id: blocker.task.id,
      type: 'blocked_by'
    })

    const removed = expectSuccess(removeResponse)
    expect(removed.removed).toBe(true)
  })

  test('arbeit_query returns relationship results', async () => {
    const createTool = arbeit_task_create({ directory })
    const queryTool = arbeit_query({ directory })
    const relationshipTool = arbeit_relationship({ directory })

    const parent = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Parent' }))
    const child = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Child' }))
    const blocker = expectSuccess(await runTool<{ task: Task; relationships: unknown[] }>(createTool, { title: 'Blocker' }))

    await runTool(relationshipTool, {
      action: 'add',
      from_task_id: parent.task.id,
      to_task_id: child.task.id,
      type: 'parent_of'
    })

    await runTool(relationshipTool, {
      action: 'add',
      from_task_id: blocker.task.id,
      to_task_id: child.task.id,
      type: 'blocks'
    })

    const blockedResponse = await runTool<{ tasks: Task[] }>(queryTool, {
      query: 'blocked_tasks'
    })
    const blocked = expectSuccess(blockedResponse)
    expect(blocked.tasks.map((task) => task.id)).toContain(child.task.id)

    const blockingResponse = await runTool<{ tasks: Task[] }>(queryTool, {
      query: 'blocking_tasks'
    })
    const blocking = expectSuccess(blockingResponse)
    expect(blocking.tasks.map((task) => task.id)).toContain(blocker.task.id)

    const childrenResponse = await runTool<{ tasks: Task[] }>(queryTool, {
      query: 'children_of',
      params: { task_id: parent.task.id }
    })
    const children = expectSuccess(childrenResponse)
    expect(children.tasks.map((task) => task.id)).toContain(child.task.id)

    const descendantsResponse = await runTool<{ task_ids: string[] }>(queryTool, {
      query: 'descendants_of',
      params: { task_id: parent.task.id }
    })
    const descendants = expectSuccess(descendantsResponse)
    expect(descendants.task_ids).toContain(child.task.id)

    const ancestorsResponse = await runTool<{ task_ids: string[] }>(queryTool, {
      query: 'ancestors_of',
      params: { task_id: child.task.id }
    })
    const ancestors = expectSuccess(ancestorsResponse)
    expect(ancestors.task_ids).toContain(parent.task.id)
  })
})
