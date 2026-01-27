import { tool } from '@opencode-ai/plugin'
import { ContinuumError, isContinuumError } from './error'
import { init_project } from './util'
import { STATIC } from './static-content'
import {
  TEMPLATE_RECOMMENDATIONS,
  create_task,
  get_task,
  get_db,
  has_open_blockers,
  is_valid_task_type,
  list_tasks_by_statuses,
  list_tasks,
  list_template_recommendations,
  resolve_template_type,
  update_task,
  validate_status_transition,
  validate_task_input,
  // Execution model
  add_steps,
  complete_step,
  update_step,
  add_discovery,
  add_decision,
  complete_task,
  type CreateTaskInput,
  type TaskStatus,
  type Task
} from './db'

const TASK_NOT_FOUND_SUGGESTIONS = [
  'Use continuum_query({ query: "tasks" }) to list valid task_ids.',
  'If you only have a title, list tasks and match by title.'
]


function continuum_success<T>(data: T) {
  return { success: true, data }
}

function continuum_error<T>(error: { code: string; message: string; suggestions?: string[] }) {
  return { success: false, error }
}

function with_continuum_error_handling<T>(fn: () => Promise<T>): Promise<string> {
  return fn()
    .then((data) => JSON.stringify(data))
    .catch((err) => {
      if (isContinuumError(err)) {
        return JSON.stringify(continuum_error({ code: err.code, message: err.message, suggestions: err.suggestions }))
      }
      const error = err as Error
      return JSON.stringify(continuum_error({ code: 'UNKNOWN_ERROR', message: error.message }))
    })
}

function recommendations_for_template(template: keyof typeof TEMPLATE_RECOMMENDATIONS) {
  return { plan_template: TEMPLATE_RECOMMENDATIONS[template].plan_template }
}

function merge_recommendations(
  template?: keyof typeof TEMPLATE_RECOMMENDATIONS,
  missing?: string[]
): { plan_template?: string; missing_fields?: string[] } | undefined {
  if (!template && (!missing || missing.length === 0)) return undefined
  return {
    ...(template ? recommendations_for_template(template) : {}),
    ...(missing && missing.length > 0 ? { missing_fields: missing } : {})
  }
}

export function continuum_init({ directory }: { directory: string }) {
  return tool({
    description: 'Initialize the continuum database.',
    args: {},
    async execute() {
      return with_continuum_error_handling(async () => {
        await init_project({ directory })
        return continuum_success({
          initialized: true,
          path: `${directory}/.continuum/continuum.db`,
          guide_markdown: STATIC.continuum_init_guide
        })
      })
    }
  })
}

export function continuum_task_create({ directory }: { directory: string }) {
  return tool({
    description: 'Create a task (supports templates for discovery).',
    args: {
      title: tool.schema.string().min(1).describe('Short task label.'),
      type: tool.schema.enum(['epic', 'feature', 'bug', 'investigation', 'chore']).optional().describe('Task type.'),
      template: tool.schema
        .enum(['epic', 'feature', 'bug', 'investigation', 'chore'])
        .optional()
        .describe('Template name for guided creation.'),
      intent: tool.schema.string().optional().describe('Why this task exists.'),
      description: tool.schema.string().optional().describe('What the task does.'),
      plan: tool.schema.string().optional().describe('How to implement.'),
      parent_id: tool.schema.string().optional().describe('Parent task ID.'),
      blocked_by: tool.schema.array(tool.schema.string()).optional().describe('Blocking task IDs.'),
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Initial status.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const templateType = resolve_template_type(args.template)

        if (args.template && !templateType) {
          throw new ContinuumError('INVALID_TEMPLATE', 'Template not recognized')
        }

        const type = args.type ?? templateType
        if (!type) {
          throw new ContinuumError('INVALID_TYPE', 'Task type is required when no template is provided')
        }

        if (!is_valid_task_type(type)) {
          throw new ContinuumError('INVALID_TYPE', 'Task type not recognized')
        }

        if (args.type && templateType && args.type !== templateType) {
          throw new ContinuumError('INVALID_TEMPLATE', 'Template does not match provided type')
        }

        const input: CreateTaskInput = {
          title: args.title,
          type,
          status: args.status,
          intent: args.intent ?? null,
          description: args.description ?? null,
          plan: args.plan ?? null,
          parent_id: args.parent_id ?? null,
          blocked_by: args.blocked_by ?? []
        }

        const task = await create_task(db, input)
        const missing = validate_task_input({ ...input, title: args.title })
        const recommendations = merge_recommendations(args.template as keyof typeof TEMPLATE_RECOMMENDATIONS, missing)

        return continuum_success({ task, recommendations })
      })
    }
  })
}

export function continuum_task_get({ directory }: { directory: string }) {
  return tool({
    description: 'Fetch a task by ID.',
    args: {
      task_id: tool.schema.string().describe('Task ID.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          throw new ContinuumError('TASK_NOT_FOUND', 'Task not found', TASK_NOT_FOUND_SUGGESTIONS)
        }

        const parent = task.parent_id ? await get_task(db, task.parent_id) : null
        const children = await list_tasks(db, { parent_id: task.id })
        const blockers = task.blocked_by.length > 0
          ? await Promise.all(task.blocked_by.map((id) => get_task(db, id)))
          : []

        const uniqueBlocking = new Map<string, Task>()
        for (const item of blockers) {
          if (!item) continue
          if (!uniqueBlocking.has(item.id)) {
            uniqueBlocking.set(item.id, item)
          }
        }

        return continuum_success({
          task,
          parent,
          children,
          blocking: Array.from(uniqueBlocking.values())
        })
      })
    }
  })
}

export function continuum_task_update({ directory }: { directory: string }) {
  return tool({
    description: 'Update a task.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      title: tool.schema.string().optional().describe('Updated title.'),
      type: tool.schema.enum(['epic', 'feature', 'bug', 'investigation', 'chore']).optional().describe('Updated type.'),
      intent: tool.schema.string().optional().describe('Updated intent.'),
      description: tool.schema.string().optional().describe('Updated description.'),
      plan: tool.schema.string().optional().describe('Updated plan.'),
      parent_id: tool.schema.string().nullable().optional().describe('Updated parent ID.'),
      blocked_by: tool.schema.array(tool.schema.string()).optional().describe('Updated blocking IDs.'),
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Updated status.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          throw new ContinuumError('TASK_NOT_FOUND', 'Task not found', TASK_NOT_FOUND_SUGGESTIONS)
        }

        if (args.status) {
          const candidate: Task = {
            ...task,
            title: args.title ?? task.title,
            type: args.type ?? task.type,
            status: args.status,
            intent: args.intent ?? task.intent,
            description: args.description ?? task.description,
            plan: args.plan ?? task.plan,
            parent_id: args.parent_id ?? task.parent_id,
            blocked_by: args.blocked_by ?? task.blocked_by
          }

          if (args.status === 'completed') {
            const openBlockers = await has_open_blockers(db, candidate)
            if (openBlockers.length > 0) {
              throw new ContinuumError('HAS_BLOCKERS', `Task has unresolved blockers: ${openBlockers.join(', ')}`, [
                `Complete blockers first: ${openBlockers.join(', ')}`
              ])
            }
          }

          const missingStatus = validate_status_transition(candidate, args.status)
          if (missingStatus.length > 0) {
            return continuum_success({
              task,
              recommendations: { missing_fields: missingStatus, plan_template: TEMPLATE_RECOMMENDATIONS[candidate.type].plan_template }
            })
          }
        }

        const updatedTask = await update_task(db, args.task_id, {
          title: args.title,
          type: args.type,
          status: args.status,
          intent: args.intent,
          description: args.description,
          plan: args.plan,
          parent_id: args.parent_id ?? undefined,
          blocked_by: args.blocked_by
        })

        const missing = validate_task_input({
          title: updatedTask.title,
          type: updatedTask.type,
          status: updatedTask.status === 'deleted' ? undefined : updatedTask.status,
          intent: updatedTask.intent,
          description: updatedTask.description,
          plan: updatedTask.plan,
          parent_id: updatedTask.parent_id,
          blocked_by: updatedTask.blocked_by
        })

        const recommendations = merge_recommendations(undefined, missing)
        return continuum_success({ task: updatedTask, recommendations })
      })
    }
  })
}

export function continuum_task_delete({ directory }: { directory: string }) {
  return tool({
    description: 'Soft delete a task.',
    args: {
      task_id: tool.schema.string().describe('Task ID.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          throw new ContinuumError('TASK_NOT_FOUND', 'Task not found', TASK_NOT_FOUND_SUGGESTIONS)
        }

        if (task.status === 'deleted') {
          return continuum_success({ deleted: true })
        }

        const deleted = await update_task(db, args.task_id, { status: 'deleted' as TaskStatus })
        return continuum_success({ deleted: Boolean(deleted) })
      })
    }
  })
}

export function continuum_query({ directory }: { directory: string }) {
  return tool({
    description: 'List and graph queries for tasks.',
    args: {
      query: tool.schema.enum(['tasks', 'active_tasks', 'children_of', 'descendants_of', 'ancestors_of', 'templates']).describe('Named query to run.'),
      params: tool.schema
        .object({
          status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
          parent_id: tool.schema.string().nullable().optional(),
          task_id: tool.schema.string().optional()
        })
        .optional()
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const params = args.params ?? {}

        switch (args.query) {
          case 'tasks': {
            const tasks = await list_tasks(db, {
              status: params.status as TaskStatus | undefined,
              parent_id: params.parent_id as string | null | undefined
            })
            return continuum_success({ tasks })
          }
          case 'active_tasks': {
            const tasks = await list_tasks_by_statuses(db, {
              statuses: ['open', 'in_progress'],
              parent_id: params.parent_id as string | null | undefined
            })
            return continuum_success({ tasks })
          }
          case 'children_of': {
            if (!params.task_id) {
              throw new ContinuumError('TASK_NOT_FOUND', 'task_id is required', TASK_NOT_FOUND_SUGGESTIONS)
            }
            const tasks = await list_tasks(db, { parent_id: params.task_id })
            return continuum_success({ tasks })
          }
          case 'descendants_of': {
            if (!params.task_id) {
              throw new ContinuumError('TASK_NOT_FOUND', 'task_id is required', TASK_NOT_FOUND_SUGGESTIONS)
            }
            const tasks = await list_tasks(db)
            const descendants = collect_descendants(tasks, params.task_id)
            return continuum_success({ task_ids: descendants })
          }
          case 'ancestors_of': {
            if (!params.task_id) {
              throw new ContinuumError('TASK_NOT_FOUND', 'task_id is required', TASK_NOT_FOUND_SUGGESTIONS)
            }
            const tasks = await list_tasks(db)
            const ancestors = collect_ancestors(tasks, params.task_id)
            return continuum_success({ task_ids: ancestors })
          }
          case 'templates': {
            return continuum_success({ templates: list_template_recommendations() })
          }
        }
      })
    }
  })
}

function collect_descendants(tasks: Task[], parent_id: string): string[] {
  const byParent = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.parent_id) continue
    const list = byParent.get(task.parent_id) ?? []
    list.push(task)
    byParent.set(task.parent_id, list)
  }

  const result: string[] = []
  const queue = [...(byParent.get(parent_id) ?? [])]
  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current.id)
    const children = byParent.get(current.id)
    if (children) queue.push(...children)
  }
  return result
}

function collect_ancestors(tasks: Task[], task_id: string): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const result: string[] = []
  let current = byId.get(task_id)
  while (current?.parent_id) {
    result.push(current.parent_id)
    current = byId.get(current.parent_id)
  }
  return result
}

// =============================================================================
// Execution Model Tools
// =============================================================================

export function continuum_step_add({ directory }: { directory: string }) {
  return tool({
    description: 'Add execution steps to a task. Steps define the tactical actions to complete the task.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      steps: tool.schema.array(
        tool.schema.object({
          title: tool.schema.string().optional().describe('Short step name (e.g., "Create ThemeContext").'),
          summary: tool.schema.string().optional().describe('1-2 sentence description of what this step accomplishes.'),
          details: tool.schema.string().optional().describe('Full specification: files, functions, APIs, specific values. Enough detail for any agent to execute blindly.')
        })
      ).describe('Steps to add.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await add_steps(db, {
          task_id: args.task_id,
          steps: args.steps
        })
        return continuum_success({ task })
      })
    }
  })
}

export function continuum_step_complete({ directory }: { directory: string }) {
  return tool({
    description: 'Mark a step as completed. If step_id is not provided, completes the current_step. Auto-advances to the next pending step.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      step_id: tool.schema.number().optional().describe('Step ID to complete. Defaults to current_step.'),
      notes: tool.schema.string().optional().describe('Notes about how the step was completed.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await complete_step(db, {
          task_id: args.task_id,
          step_id: args.step_id,
          notes: args.notes
        })
        return continuum_success({ task })
      })
    }
  })
}

export function continuum_step_update({ directory }: { directory: string }) {
  return tool({
    description: 'Update a step\'s title, summary, details, status, or notes.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      step_id: tool.schema.number().describe('Step ID to update.'),
      title: tool.schema.string().optional().describe('Updated step title.'),
      summary: tool.schema.string().optional().describe('Updated summary.'),
      details: tool.schema.string().optional().describe('Updated details.'),
      status: tool.schema.enum(['pending', 'in_progress', 'completed', 'skipped']).optional().describe('Updated status.'),
      notes: tool.schema.string().optional().describe('Updated notes.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await update_step(db, {
          task_id: args.task_id,
          step_id: args.step_id,
          title: args.title,
          summary: args.summary,
          details: args.details,
          status: args.status,
          notes: args.notes
        })
        return continuum_success({ task })
      })
    }
  })
}

export function continuum_task_discover({ directory }: { directory: string }) {
  return tool({
    description: 'Record a discovery made during task execution. Discoveries are things learned that may be useful later.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      content: tool.schema.string().describe('What was discovered.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await add_discovery(db, {
          task_id: args.task_id,
          content: args.content
        })
        return continuum_success({ task })
      })
    }
  })
}

export function continuum_task_decide({ directory }: { directory: string }) {
  return tool({
    description: 'Record a decision made during task execution, with optional rationale.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      content: tool.schema.string().describe('What was decided.'),
      rationale: tool.schema.string().optional().describe('Why this decision was made.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await add_decision(db, {
          task_id: args.task_id,
          content: args.content,
          rationale: args.rationale
        })
        return continuum_success({ task })
      })
    }
  })
}

export function continuum_task_complete({ directory }: { directory: string }) {
  return tool({
    description: 'Complete a task with an outcome summary. Records what actually happened vs. the plan.',
    args: {
      task_id: tool.schema.string().describe('Task ID.'),
      outcome: tool.schema.string().describe('Summary of what was accomplished and any deviations from the plan.')
    },
    async execute(args) {
      return with_continuum_error_handling(async () => {
        const db = await get_db(directory)
        const task = await complete_task(db, {
          task_id: args.task_id,
          outcome: args.outcome
        })
        return continuum_success({ task })
      })
    }
  })
}
