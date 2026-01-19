import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { init_project } from './util'
import { get_db, type Task } from './db'
import {
  arbeit_init,
  arbeit_query,
  arbeit_task_create,
  arbeit_task_get,
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
  } catch {
    // ignore
  }
}

describe('tools', () => {
  let directory: string

  beforeEach(async () => {
    directory = await createTempDir()
    await init_project({ directory })
  })

  afterEach(async () => {
    await closeDb(directory)
    await rm(directory, { recursive: true, force: true })
  })

  test('init creates db file', async () => {
    const initTool = arbeit_init({ directory })
    const response = await runTool<{ initialized: boolean; path: string }>(initTool, {})
    expect(response.success).toBe(true)
    expect(response.data?.initialized).toBe(true)
  })

  test('task_create with template returns recommendations', async () => {
    const createTool = arbeit_task_create({ directory })
    const response = await runTool<{ task: Task; recommendations?: { plan_template?: string } }>(createTool, {
      title: 'Login bug',
      template: 'bug',
      description: 'Login fails on Safari'
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.type).toBe('bug')
    expect(response.data?.recommendations?.plan_template).toBeDefined()
  })

  test('task_update returns recommendations for missing fields', async () => {
    const createTool = arbeit_task_create({ directory })
    const updateTool = arbeit_task_update({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature task',
      type: 'feature',
      intent: 'Ship feature'
    })

    const response = await runTool<{ task: Task; recommendations?: { missing_fields?: string[] } }>(updateTool, {
      task_id: created.data!.task.id,
      status: 'in_progress'
    })

    expect(response.success).toBe(true)
    expect(response.data?.recommendations?.missing_fields).toContain('plan')
  })

  test('task_update blocks completion when blockers are open', async () => {
    const createTool = arbeit_task_create({ directory })
    const updateTool = arbeit_task_update({ directory })
    const getTool = arbeit_task_get({ directory })

    const blocker = await runTool<{ task: Task }>(createTool, {
      title: 'Blocker',
      type: 'chore',
      description: 'Prep',
      plan: 'Plan: ...'
    })

    const blocked = await runTool<{ task: Task }>(createTool, {
      title: 'Blocked',
      type: 'feature',
      intent: 'Implement',
      description: 'Do work',
      plan: 'Plan: ...',
      blocked_by: [blocker.data!.task.id]
    })

    const response = await runTool<{ task: Task }>(updateTool, {
      task_id: blocked.data!.task.id,
      status: 'completed'
    })

    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('HAS_BLOCKERS')

    const verify = await runTool<{ task: Task }>(getTool, { task_id: blocked.data!.task.id })
    expect(verify.success).toBe(true)
    expect(verify.data?.task.status).toBe('open')
  })

  test('task_update does not persist in_progress without plan', async () => {
    const createTool = arbeit_task_create({ directory })
    const updateTool = arbeit_task_update({ directory })
    const getTool = arbeit_task_get({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Missing plan',
      type: 'feature',
      intent: 'Ship',
      description: 'Do work'
    })

    const response = await runTool<{ task: Task; recommendations?: { missing_fields?: string[] } }>(updateTool, {
      task_id: created.data!.task.id,
      status: 'in_progress'
    })

    expect(response.success).toBe(true)
    expect(response.data?.recommendations?.missing_fields).toContain('plan')

    const verify = await runTool<{ task: Task }>(getTool, { task_id: created.data!.task.id })
    expect(verify.success).toBe(true)
    expect(verify.data?.task.status).toBe('open')
  })

  test('task_update does not persist completed without plan', async () => {
    const createTool = arbeit_task_create({ directory })
    const updateTool = arbeit_task_update({ directory })
    const getTool = arbeit_task_get({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Missing plan completed',
      type: 'feature',
      intent: 'Ship',
      description: 'Do work'
    })

    const response = await runTool<{ task: Task; recommendations?: { missing_fields?: string[] } }>(updateTool, {
      task_id: created.data!.task.id,
      status: 'completed'
    })

    expect(response.success).toBe(true)
    expect(response.data?.recommendations?.missing_fields).toContain('plan')

    const verify = await runTool<{ task: Task }>(getTool, { task_id: created.data!.task.id })
    expect(verify.success).toBe(true)
    expect(verify.data?.task.status).toBe('open')
  })

  test('task_update rejects self blockers', async () => {
    const createTool = arbeit_task_create({ directory })
    const updateTool = arbeit_task_update({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Self blocked',
      type: 'chore',
      description: 'Do work',
      plan: 'Plan: ...'
    })

    const response = await runTool(updateTool, {
      task_id: created.data!.task.id,
      blocked_by: [created.data!.task.id]
    })

    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('INVALID_BLOCKER')
  })

  test('task_update rejects duplicate blockers', async () => {
    const createTool = arbeit_task_create({ directory })
    const updateTool = arbeit_task_update({ directory })

    const blocker = await runTool<{ task: Task }>(createTool, {
      title: 'Blocker dup',
      type: 'chore',
      description: 'Prep',
      plan: 'Plan: ...'
    })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Duplicate blockers',
      type: 'feature',
      intent: 'Ship',
      description: 'Do work',
      plan: 'Plan: ...'
    })

    const response = await runTool(updateTool, {
      task_id: created.data!.task.id,
      blocked_by: [blocker.data!.task.id, blocker.data!.task.id]
    })

    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('DUPLICATE_BLOCKERS')
  })

  test('task_get returns children and blockers', async () => {
    const createTool = arbeit_task_create({ directory })
    const getTool = arbeit_task_get({ directory })

    const parent = await runTool<{ task: Task }>(createTool, {
      title: 'Epic',
      type: 'epic',
      intent: 'Deliver'
    })

    const child = await runTool<{ task: Task }>(createTool, {
      title: 'Child',
      type: 'feature',
      intent: 'Implement',
      description: 'Do work',
      plan: 'Plan: ...',
      parent_id: parent.data!.task.id
    })

    const blocker = await runTool<{ task: Task }>(createTool, {
      title: 'Blocker',
      type: 'chore',
      description: 'Prep',
      plan: 'Plan: ...'
    })

    await runTool<{ task: Task }>(createTool, {
      title: 'Blocked task',
      type: 'feature',
      intent: 'Implement',
      description: 'Do work',
      plan: 'Plan: ...',
      blocked_by: [blocker.data!.task.id]
    })

    const response = await runTool<{ task: Task; children: Task[]; blocking: Task[] }>(getTool, {
      task_id: parent.data!.task.id
    })

    expect(response.success).toBe(true)
    expect(response.data?.children).toHaveLength(1)
    expect(response.data?.blocking).toHaveLength(0)

    const blockedTask = await runTool<{ task: Task; blocking: Task[] }>(getTool, {
      task_id: blocker.data!.task.id
    })
    expect(blockedTask.success).toBe(true)
    expect(blockedTask.data?.blocking).toHaveLength(0)
  })

  test('query templates returns template list', async () => {
    const queryTool = arbeit_query({ directory })
    const response = await runTool<{ templates: Array<{ name: string; plan_template: string }> }>(queryTool, {
      query: 'templates'
    })
    expect(response.success).toBe(true)
    expect(response.data?.templates.length).toBeGreaterThan(0)
  })
})
