import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { init_project } from './util'
import { get_db, type Task } from './db'
import {
  continuum_init,
  continuum_query,
  continuum_task_create,
  continuum_task_get,
  continuum_task_update,
  continuum_step_add,
  continuum_step_complete,
  continuum_step_update,
  continuum_task_discover,
  continuum_task_decide,
  continuum_task_complete
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
  return await mkdtemp(join(tmpdir(), 'continuum-tools-'))
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
    const initTool = continuum_init({ directory })
    const response = await runTool<{ initialized: boolean; path: string }>(initTool, {})
    expect(response.success).toBe(true)
    expect(response.data?.initialized).toBe(true)
  })

  test('task_create with template returns recommendations', async () => {
    const createTool = continuum_task_create({ directory })
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
    const createTool = continuum_task_create({ directory })
    const updateTool = continuum_task_update({ directory })

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
    const createTool = continuum_task_create({ directory })
    const updateTool = continuum_task_update({ directory })
    const getTool = continuum_task_get({ directory })

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
    const createTool = continuum_task_create({ directory })
    const updateTool = continuum_task_update({ directory })
    const getTool = continuum_task_get({ directory })

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
    const createTool = continuum_task_create({ directory })
    const updateTool = continuum_task_update({ directory })
    const getTool = continuum_task_get({ directory })

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
    const createTool = continuum_task_create({ directory })
    const updateTool = continuum_task_update({ directory })

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
    const createTool = continuum_task_create({ directory })
    const updateTool = continuum_task_update({ directory })

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
    const createTool = continuum_task_create({ directory })
    const getTool = continuum_task_get({ directory })

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
    const queryTool = continuum_query({ directory })
    const response = await runTool<{ templates: Array<{ name: string; plan_template: string }> }>(queryTool, {
      query: 'templates'
    })
    expect(response.success).toBe(true)
    expect(response.data?.templates.length).toBeGreaterThan(0)
  })

  // ==========================================================================
  // Execution Model Tests
  // ==========================================================================

  test('step_add adds steps to a task', async () => {
    const createTool = continuum_task_create({ directory })
    const stepAddTool = continuum_step_add({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature with steps',
      type: 'feature',
      intent: 'Ship feature',
      description: 'Build the thing',
      plan: 'Plan: do it'
    })

    const response = await runTool<{ task: Task }>(stepAddTool, {
      task_id: created.data!.task.id,
      steps: [
        { action: 'Create component' },
        { action: 'Add tests' },
        { action: 'Update docs' }
      ]
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.steps).toHaveLength(3)
    expect(response.data?.task.steps[0].action).toBe('Create component')
    expect(response.data?.task.steps[0].status).toBe('pending')
    expect(response.data?.task.current_step).toBe(1)
  })

  test('step_complete completes current step and advances', async () => {
    const createTool = continuum_task_create({ directory })
    const stepAddTool = continuum_step_add({ directory })
    const stepCompleteTool = continuum_step_complete({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature step complete',
      type: 'feature',
      intent: 'Ship',
      description: 'Build',
      plan: 'Plan: do it'
    })

    await runTool<{ task: Task }>(stepAddTool, {
      task_id: created.data!.task.id,
      steps: [
        { action: 'Step 1' },
        { action: 'Step 2' }
      ]
    })

    const response = await runTool<{ task: Task }>(stepCompleteTool, {
      task_id: created.data!.task.id,
      notes: 'Completed with alternative approach'
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.steps[0].status).toBe('completed')
    expect(response.data?.task.steps[0].notes).toBe('Completed with alternative approach')
    expect(response.data?.task.current_step).toBe(2)
  })

  test('step_update modifies a step', async () => {
    const createTool = continuum_task_create({ directory })
    const stepAddTool = continuum_step_add({ directory })
    const stepUpdateTool = continuum_step_update({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature step update',
      type: 'feature',
      intent: 'Ship',
      description: 'Build',
      plan: 'Plan: do it'
    })

    await runTool<{ task: Task }>(stepAddTool, {
      task_id: created.data!.task.id,
      steps: [{ action: 'Original action' }]
    })

    const response = await runTool<{ task: Task }>(stepUpdateTool, {
      task_id: created.data!.task.id,
      step_id: 1,
      action: 'Updated action',
      status: 'skipped',
      notes: 'Skipped because unnecessary'
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.steps[0].action).toBe('Updated action')
    expect(response.data?.task.steps[0].status).toBe('skipped')
    expect(response.data?.task.steps[0].notes).toBe('Skipped because unnecessary')
  })

  test('task_discover adds a discovery', async () => {
    const createTool = continuum_task_create({ directory })
    const discoverTool = continuum_task_discover({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature with discovery',
      type: 'feature',
      intent: 'Ship',
      description: 'Build',
      plan: 'Plan: do it'
    })

    const response = await runTool<{ task: Task }>(discoverTool, {
      task_id: created.data!.task.id,
      content: 'The API endpoint returns paginated results by default'
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.discoveries).toHaveLength(1)
    expect(response.data?.task.discoveries[0].content).toBe('The API endpoint returns paginated results by default')
    expect(response.data?.task.discoveries[0].created_at).toBeDefined()
  })

  test('task_decide adds a decision with rationale', async () => {
    const createTool = continuum_task_create({ directory })
    const decideTool = continuum_task_decide({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature with decision',
      type: 'feature',
      intent: 'Ship',
      description: 'Build',
      plan: 'Plan: do it'
    })

    const response = await runTool<{ task: Task }>(decideTool, {
      task_id: created.data!.task.id,
      content: 'Use React Query instead of SWR',
      rationale: 'Better TypeScript support and more active maintenance'
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.decisions).toHaveLength(1)
    expect(response.data?.task.decisions[0].content).toBe('Use React Query instead of SWR')
    expect(response.data?.task.decisions[0].rationale).toBe('Better TypeScript support and more active maintenance')
  })

  test('task_complete marks task as completed with outcome', async () => {
    const createTool = continuum_task_create({ directory })
    const completeTool = continuum_task_complete({ directory })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Feature to complete',
      type: 'feature',
      intent: 'Ship',
      description: 'Build',
      plan: 'Plan: do it'
    })

    const response = await runTool<{ task: Task }>(completeTool, {
      task_id: created.data!.task.id,
      outcome: 'Shipped the feature. Had to skip IE11 support due to time constraints.'
    })

    expect(response.success).toBe(true)
    expect(response.data?.task.status).toBe('completed')
    expect(response.data?.task.outcome).toBe('Shipped the feature. Had to skip IE11 support due to time constraints.')
  })

  test('task_complete fails with open blockers', async () => {
    const createTool = continuum_task_create({ directory })
    const completeTool = continuum_task_complete({ directory })

    const blocker = await runTool<{ task: Task }>(createTool, {
      title: 'Blocker task',
      type: 'chore',
      description: 'Prep',
      plan: 'Plan: ...'
    })

    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Blocked feature',
      type: 'feature',
      intent: 'Ship',
      description: 'Build',
      plan: 'Plan: do it',
      blocked_by: [blocker.data!.task.id]
    })

    const response = await runTool<{ task: Task }>(completeTool, {
      task_id: created.data!.task.id,
      outcome: 'Done'
    })

    expect(response.success).toBe(false)
    expect(response.error?.code).toBe('HAS_BLOCKERS')
  })

  test('full execution workflow', async () => {
    const createTool = continuum_task_create({ directory })
    const stepAddTool = continuum_step_add({ directory })
    const stepCompleteTool = continuum_step_complete({ directory })
    const discoverTool = continuum_task_discover({ directory })
    const decideTool = continuum_task_decide({ directory })
    const completeTool = continuum_task_complete({ directory })
    const getTool = continuum_task_get({ directory })

    // 1. Create task
    const created = await runTool<{ task: Task }>(createTool, {
      title: 'Add dark mode',
      type: 'feature',
      intent: 'Users want to reduce eye strain',
      description: 'Add theme toggle to settings',
      plan: 'Use CSS variables and React Context'
    })
    const taskId = created.data!.task.id

    // 2. Add steps
    await runTool<{ task: Task }>(stepAddTool, {
      task_id: taskId,
      steps: [
        { action: 'Create ThemeContext' },
        { action: 'Add toggle component' },
        { action: 'Implement CSS variables' }
      ]
    })

    // 3. Complete step 1 with discovery
    await runTool<{ task: Task }>(stepCompleteTool, {
      task_id: taskId,
      notes: 'Used Zustand instead of Context'
    })

    await runTool<{ task: Task }>(discoverTool, {
      task_id: taskId,
      content: 'Third-party date picker does not support CSS variables'
    })

    // 4. Complete step 2 with decision
    await runTool<{ task: Task }>(stepCompleteTool, { task_id: taskId })

    await runTool<{ task: Task }>(decideTool, {
      task_id: taskId,
      content: 'Use inline styles for date picker',
      rationale: 'Only component that needs override'
    })

    // 5. Complete step 3
    await runTool<{ task: Task }>(stepCompleteTool, { task_id: taskId })

    // 6. Complete task with outcome
    const completed = await runTool<{ task: Task }>(completeTool, {
      task_id: taskId,
      outcome: 'Dark mode shipped. Used Zustand instead of Context. Date picker required inline style workaround.'
    })

    expect(completed.success).toBe(true)
    expect(completed.data?.task.status).toBe('completed')

    // 7. Verify full state
    const final = await runTool<{ task: Task }>(getTool, { task_id: taskId })
    expect(final.data?.task.steps.every(s => s.status === 'completed')).toBe(true)
    expect(final.data?.task.current_step).toBe(null)
    expect(final.data?.task.discoveries).toHaveLength(1)
    expect(final.data?.task.decisions).toHaveLength(1)
    expect(final.data?.task.outcome).toBeDefined()
  })
})
