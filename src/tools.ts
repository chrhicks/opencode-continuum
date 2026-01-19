import { tool } from '@opencode-ai/plugin'
import { ArbeitError, isArbeitError } from './error'
import { init_project } from './util'
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
  type CreateTaskInput,
  type TaskStatus,
  type Task
} from './db'

const TASK_NOT_FOUND_SUGGESTIONS = [
  'Use arbeit_query({ query: "tasks" }) to list valid task_ids.',
  'If you only have a title, list tasks and match by title.'
]


function arbeit_success<T>(data: T) {
  return { success: true, data }
}

function arbeit_error<T>(error: { code: string; message: string; suggestions?: string[] }) {
  return { success: false, error }
}

function with_arbeit_error_handling<T>(fn: () => Promise<T>): Promise<string> {
  return fn()
    .then((data) => JSON.stringify(data))
    .catch((err) => {
      if (isArbeitError(err)) {
        return JSON.stringify(arbeit_error({ code: err.code, message: err.message, suggestions: err.suggestions }))
      }
      const error = err as Error
      return JSON.stringify(arbeit_error({ code: 'UNKNOWN_ERROR', message: error.message }))
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

const GUIDE_MARKDOWN = `# Arbeit Quickstart (Agent Guide)

## 1) Read the user prompt
- Restate the goal in 1-2 sentences.
- Ask clarifying questions if requirements or constraints are missing.

## 2) Decide the task shape
- If starting new work: choose a template (epic, feature, bug, investigation, chore).
- If resuming: list active tasks and pick the most relevant one.

## 3) Capture concrete details
- Always fill description (what) and intent (why, when applicable).
- For feature/bug/investigation/chore, add a plan using the template stub.

## 4) Structure and dependencies
- Use parent_id for hierarchy.
- Use blocked_by for dependencies; don’t complete tasks while blocked.

## 5) Execute and update
- Move to in_progress only once the plan is filled.
- Update status and fields as decisions change.
`

export function arbeit_init({ directory }: { directory: string }) {
  return tool({
    description: 'Initialize the arbeit database.',
    args: {},
    async execute() {
      return with_arbeit_error_handling(async () => {
        await init_project({ directory })
        return arbeit_success({
          initialized: true,
          path: `${directory}/.arbeit/arbeit.db`,
          guide_markdown: GUIDE_MARKDOWN
        })
      })
    }
  })
}

export function arbeit_task_create({ directory }: { directory: string }) {
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
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const templateType = resolve_template_type(args.template)

        if (args.template && !templateType) {
          throw new ArbeitError('INVALID_TEMPLATE', 'Template not recognized')
        }

        const type = args.type ?? templateType
        if (!type) {
          throw new ArbeitError('INVALID_TYPE', 'Task type is required when no template is provided')
        }

        if (!is_valid_task_type(type)) {
          throw new ArbeitError('INVALID_TYPE', 'Task type not recognized')
        }

        if (args.type && templateType && args.type !== templateType) {
          throw new ArbeitError('INVALID_TEMPLATE', 'Template does not match provided type')
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

        return arbeit_success({ task, recommendations })
      })
    }
  })
}

export function arbeit_task_get({ directory }: { directory: string }) {
  return tool({
    description: 'Fetch a task by ID.',
    args: {
      task_id: tool.schema.string().describe('Task ID.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          throw new ArbeitError('TASK_NOT_FOUND', 'Task not found', TASK_NOT_FOUND_SUGGESTIONS)
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

        return arbeit_success({
          task,
          parent,
          children,
          blocking: Array.from(uniqueBlocking.values())
        })
      })
    }
  })
}

export function arbeit_task_update({ directory }: { directory: string }) {
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
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          throw new ArbeitError('TASK_NOT_FOUND', 'Task not found', TASK_NOT_FOUND_SUGGESTIONS)
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
              throw new ArbeitError('HAS_BLOCKERS', `Task has unresolved blockers: ${openBlockers.join(', ')}`, [
                `Complete blockers first: ${openBlockers.join(', ')}`
              ])
            }
          }

          const missingStatus = validate_status_transition(candidate, args.status)
          if (missingStatus.length > 0) {
            return arbeit_success({
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
        return arbeit_success({ task: updatedTask, recommendations })
      })
    }
  })
}

export function arbeit_task_delete({ directory }: { directory: string }) {
  return tool({
    description: 'Soft delete a task.',
    args: {
      task_id: tool.schema.string().describe('Task ID.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          throw new ArbeitError('TASK_NOT_FOUND', 'Task not found', TASK_NOT_FOUND_SUGGESTIONS)
        }

        if (task.status === 'deleted') {
          return arbeit_success({ deleted: true })
        }

        const deleted = await update_task(db, args.task_id, { status: 'deleted' as TaskStatus })
        return arbeit_success({ deleted: Boolean(deleted) })
      })
    }
  })
}

export function arbeit_query({ directory }: { directory: string }) {
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
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const params = args.params ?? {}

        switch (args.query) {
          case 'tasks': {
            const tasks = await list_tasks(db, {
              status: params.status as TaskStatus | undefined,
              parent_id: params.parent_id as string | null | undefined
            })
            return arbeit_success({ tasks })
          }
          case 'active_tasks': {
            const tasks = await list_tasks_by_statuses(db, {
              statuses: ['open', 'in_progress'],
              parent_id: params.parent_id as string | null | undefined
            })
            return arbeit_success({ tasks })
          }
          case 'children_of': {
            if (!params.task_id) {
              throw new ArbeitError('TASK_NOT_FOUND', 'task_id is required', TASK_NOT_FOUND_SUGGESTIONS)
            }
            const tasks = await list_tasks(db, { parent_id: params.task_id })
            return arbeit_success({ tasks })
          }
          case 'descendants_of': {
            if (!params.task_id) {
              throw new ArbeitError('TASK_NOT_FOUND', 'task_id is required', TASK_NOT_FOUND_SUGGESTIONS)
            }
            const tasks = await list_tasks(db)
            const descendants = collect_descendants(tasks, params.task_id)
            return arbeit_success({ task_ids: descendants })
          }
          case 'ancestors_of': {
            if (!params.task_id) {
              throw new ArbeitError('TASK_NOT_FOUND', 'task_id is required', TASK_NOT_FOUND_SUGGESTIONS)
            }
            const tasks = await list_tasks(db)
            const ancestors = collect_ancestors(tasks, params.task_id)
            return arbeit_success({ task_ids: ancestors })
          }
          case 'templates': {
            return arbeit_success({ templates: list_template_recommendations() })
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
