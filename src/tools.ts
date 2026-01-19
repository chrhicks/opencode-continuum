import { tool } from '@opencode-ai/plugin'
import {
  complete_progress_items,
  create_context_entry,
  create_progress_items,
  create_relationship,
  create_task,
  ensure_session_link,
  get_active_work,
  get_blocked_by_tasks,
  get_blocking_tasks_for_task,
  get_context_entries_for_task,
  get_db,
  get_file_associations_for_task,
  get_parent_task,
  get_progress_items_for_task,
  get_progress_summary,
  get_relationships_for_task,
  get_session_links_for_task,
  get_task,
  insert_active_work,
  list_tasks,
  list_tasks_by_statuses,
  query_ancestors_of,
  query_blocked_tasks,
  query_blocking_tasks,
  query_children_of,
  query_descendants_of,
  remove_active_work,
  remove_relationship,
  soft_delete_task,
  supersede_context_entry,
  task_has_children,
  update_task,
  validate_relationship_input,
  CONTEXT_TYPES,
  type RelationshipInputType,
  type Task,
  type TaskStatus
} from './db'
import { init_project } from './util'
import { isArbeitError } from './error'

type ArbeitResponse<T> = {
  success: boolean
  data?: T
  warnings?: string[]
  error?: {
    code: string
    message: string
    suggestions?: string[]
  }
}

const TASK_NOT_FOUND_SUGGESTIONS = [
  'Use arbeit_query({ query: "tasks" }) to list valid task_ids.',
  'If you only have a title, list tasks and match by title.'
]

const PROGRESS_EMPTY_SUGGESTIONS = [
  'Provide at least one progress item ID in item_ids.',
  'Fetch progress with arbeit_task_get({ task_id, include: ["progress"] }).'
]

const BRIEFING_INCLUDES: Array<
  | 'parent'
  | 'children'
  | 'blocked_by'
  | 'blocking'
  | 'relationships'
  | 'context_all'
  | 'progress_summary'
  | 'files'
  | 'sessions'
  | 'recent_events'
> = [
  'parent',
  'children',
  'blocked_by',
  'blocking',
  'relationships',
  'context_all',
  'progress_summary',
  'files',
  'sessions',
  'recent_events'
]

function arbeit_success<T>(data: T): ArbeitResponse<T> {
  return {
    success: true,
    data: data
  }
}

function arbeit_error<T>(error: { code: string; message: string; suggestions?: string[] }): ArbeitResponse<T> {
  return {
    success: false,
    error: error
  }
}

async function with_arbeit_error_handling(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn()
  } catch (error) {
    if (isArbeitError(error)) {
      return JSON.stringify(arbeit_error({ code: error.code, message: error.message, suggestions: error.suggestions }))
    }
    throw error
  }
}

/**
 * Initialize arbeit in the current directory.
 *
 * Parameters: none
 *
 * Returns: { initialized: boolean, path: string }
 *
 * Errors:
 * - ALREADY_INITIALIZED: .arbeit already exists
 */
export function arbeit_init({ directory }: { directory: string }) {
  return tool({
    description: 'Use before any other arbeit tools; creates the local .arbeit database.',
    args: {},

    async execute() {
      return with_arbeit_error_handling(async () => {
        await init_project({ directory })
        return JSON.stringify(arbeit_success({ initialized: true, path: directory }))
      })
    }
  })
}

/**
 * Create a new task.
 *
 * Parameters:
 * - title: string (required) Brief description
 * - intent?: string The "why" (immutable after creation)
 * - parent_id?: string Parent task ID for hierarchy
 * - status?: string Initial status (default: open)
 *
 * Returns: { task: Task }
 *
 * Errors:
 * - PARENT_NOT_FOUND: Specified parent task doesn't exist
 * - MAX_DEPTH_EXCEEDED: Would exceed 4-level hierarchy limit
 */
export function arbeit_task_create({ directory }: { directory: string }) { 
  return tool({
    description: 'Use to create a planning unit or subtask; optionally link it into a hierarchy.',
    args: {
      title: tool.schema.string().min(1).describe('Short task label for planning.'),
      intent: tool.schema.string().optional().describe('Immutable goal or rationale to resume later.'),
      parent_id: tool.schema.string().optional().describe('Optional parent task to build hierarchy.'),
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Initial status; usually open.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
         const taskId = await create_task(db, args)
         const task = await get_task(db, taskId)

         if (!task) {
           return JSON.stringify(
             arbeit_error({
               code: 'TASK_NOT_FOUND',
               message: 'Task not found after create',
               suggestions: TASK_NOT_FOUND_SUGGESTIONS
             })
           )
         }

         if (args.parent_id) {
           const validation = await validate_relationship_input(db, {
             from_task_id: args.parent_id,
             to_task_id: taskId,
             type: 'parent_of'
           })
           await create_relationship(db, { ...validation.normalized })
         }

         const relationships = await get_relationships_for_task(db, taskId)
         return JSON.stringify(arbeit_success({ task, relationships }))

      })
    }
  })
}

/**
 * Get a task by ID.
 *
 * Parameters:
 * - task_id: string (required) Task ID
 * - include?: string[] Optional sections to include
 *
 * Returns: { task: Task, ... }
 *
 * Errors:
  * - TASK_NOT_FOUND: Task doesn't exist
  */
export function arbeit_task_get({ directory }: { directory: string }) {
  return tool({
    description: 'Use to fetch a task; request sections in include for briefing-level context.',
    args: {
      task_id: tool.schema.string().describe('Task ID to fetch.'),
      include: tool.schema
        .array(
          tool.schema.enum([
            'relationships',
            'context',
            'context_all',
            'progress',
            'progress_summary',
            'parent',
            'children',
            'blocked_by',
            'blocking',
            'files',
            'sessions',
            'recent_events'
          ])
        )
        .optional()
        .describe('Optional sections for context/briefing; omit for core task only.'),
      briefing: tool.schema.boolean().optional().describe('Use a default include set for briefing-level context.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }

        const briefingIncludes = args.briefing ? BRIEFING_INCLUDES : []
        const include = new Set([...briefingIncludes, ...(args.include ?? [])])
        const response: Record<string, unknown> = { task }

        if (include.has('relationships')) {
          response.relationships = await get_relationships_for_task(db, args.task_id)
        }

        if (include.has('context') || include.has('context_all')) {
          response.context = await get_context_entries_for_task(db, args.task_id, {
            include_superseded: include.has('context_all')
          })
        }

        if (include.has('progress')) {
          response.progress = await get_progress_items_for_task(db, args.task_id)
        }

        if (include.has('progress_summary')) {
          response.progress_summary = await get_progress_summary(db, args.task_id)
        }

        if (include.has('parent')) {
          response.parent = (await get_parent_task(db, args.task_id)) ?? null
        }

        if (include.has('children')) {
          response.children = await query_children_of(db, args.task_id)
        }

        if (include.has('blocked_by')) {
          response.blocked_by = await get_blocked_by_tasks(db, args.task_id)
        }

        if (include.has('blocking')) {
          response.blocking = await get_blocking_tasks_for_task(db, args.task_id)
        }

        if (include.has('files')) {
          response.files = await get_file_associations_for_task(db, args.task_id)
        }

        if (include.has('sessions')) {
          response.sessions = await get_session_links_for_task(db, args.task_id)
        }

        if (include.has('recent_events')) {
          response.recent_events = []
        }

        return JSON.stringify(arbeit_success(response))
      })
    }
  })
}

/**
 * Fetch a task and its child summaries for briefing.
 *
 * Parameters:
 * - task_id: string (required) Task ID
 * - include?: string[] Optional root sections to include (defaults to briefing set)
 * - include_progress?: "summary" | "full" Child progress verbosity (default: summary)
 *
 * Returns: { task: Task, children: Array<{ task: Task, context: ContextEntry[], progress_summary?: ProgressSummary, progress?: ProgressItem[] }>, ... }
 *
 * Errors:
 * - TASK_NOT_FOUND: Task doesn't exist
 */
export function arbeit_task_brief({ directory }: { directory: string }) {
  return tool({
    description: 'Use to fetch a task with child context and progress summaries.',
    args: {
      task_id: tool.schema.string().describe('Task ID to fetch.'),
      include: tool.schema
        .array(
          tool.schema.enum([
            'relationships',
            'context',
            'context_all',
            'progress',
            'progress_summary',
            'parent',
            'children',
            'blocked_by',
            'blocking',
            'files',
            'sessions',
            'recent_events'
          ])
        )
        .optional()
        .describe('Optional root sections to include (defaults to briefing set).'),
      include_progress: tool.schema
        .enum(['summary', 'full'])
        .optional()
        .describe('Child progress verbosity (summary or full).')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }

        const include = new Set([...BRIEFING_INCLUDES, ...(args.include ?? [])])
        const response: Record<string, unknown> = { task }

        if (include.has('relationships')) {
          response.relationships = await get_relationships_for_task(db, args.task_id)
        }

        if (include.has('context') || include.has('context_all')) {
          response.context = await get_context_entries_for_task(db, args.task_id, {
            include_superseded: include.has('context_all')
          })
        }

        if (include.has('progress')) {
          response.progress = await get_progress_items_for_task(db, args.task_id)
        }

        if (include.has('progress_summary')) {
          response.progress_summary = await get_progress_summary(db, args.task_id)
        }

        if (include.has('parent')) {
          response.parent = (await get_parent_task(db, args.task_id)) ?? null
        }

        if (include.has('blocked_by')) {
          response.blocked_by = await get_blocked_by_tasks(db, args.task_id)
        }

        if (include.has('blocking')) {
          response.blocking = await get_blocking_tasks_for_task(db, args.task_id)
        }

        if (include.has('files')) {
          response.files = await get_file_associations_for_task(db, args.task_id)
        }

        if (include.has('sessions')) {
          response.sessions = await get_session_links_for_task(db, args.task_id)
        }

        if (include.has('recent_events')) {
          response.recent_events = []
        }

        const childTasks = await query_children_of(db, args.task_id)
        const includeProgress = args.include_progress ?? 'summary'
        const children = await Promise.all(
          childTasks.map(async (child) => {
            const context = await get_context_entries_for_task(db, child.id, { include_superseded: true })
            if (includeProgress === 'full') {
              const progress = await get_progress_items_for_task(db, child.id)
              return { task: child, context, progress }
            }

            const progress_summary = await get_progress_summary(db, child.id)
            return { task: child, context, progress_summary }
          })
        )

        response.children = children

        return JSON.stringify(arbeit_success(response))
      })
    }
  })
}

/**
 * Update a task's properties.
 *
 * Parameters:
 * - task_id: string (required) Task ID
 * - title?: string New title
 * - status?: string New status
 *
 * Returns: { task: Task }
 *
 * Errors:
 * - TASK_NOT_FOUND: Task doesn't exist
 *
 * Warnings:
 * - HAS_INCOMPLETE_CHILDREN: Completing a task with incomplete children
 */
export function arbeit_task_update({ directory }: { directory: string }) {
  return tool({
    description: 'Use to rename a task or advance its status as work progresses.',
    args: {
      task_id: tool.schema.string().describe('Task ID to update.'),
      title: tool.schema.string().min(1).optional().describe('New title when scope changes.'),
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Updated lifecycle state.'),
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)

        if (!args.title && !args.status) {
          return JSON.stringify(arbeit_error({ code: 'NO_CHANGES_MADE', message: 'No changes made' }))
        }

        const task = await get_task(db, args.task_id)

        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }
        const updateResult = await update_task(db, args.task_id, { title: args.title, status: args.status })
        
        if (!updateResult) {
          return JSON.stringify(arbeit_error({ code: 'TASK_UPDATE_FAILED', message: 'An error occurred while updating the task in the database' }))
        }
        const updatedTask = await get_task(db, args.task_id)
        if (!updatedTask) {
          return JSON.stringify(
            arbeit_error({
              code: 'TASK_NOT_FOUND',
              message: `Updated task not found after update. task_id: ${args.task_id}`,
              suggestions: TASK_NOT_FOUND_SUGGESTIONS
            })
          )
        }
        return JSON.stringify(arbeit_success({ task: updatedTask }))
      })
    }
  })
}

/**
 * Soft delete a task by setting status to deleted.
 *
 * Parameters:
 * - task_id: string (required) Task ID
 *
 * Returns: { deleted: boolean }
 *
 * Errors:
 * - TASK_NOT_FOUND: Task doesn't exist
 * - HAS_CHILDREN: Task has child tasks (must delete or re-parent children first)
 */
export function arbeit_task_delete({ directory }: { directory: string }) {
  return tool({
    description: 'Use to remove a task that is no longer needed (must have no children).',
    args: {
      task_id: tool.schema.string().describe('Task ID to delete (must have no children).'),
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)

        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }

        if (task.status === 'deleted') {
          return JSON.stringify(arbeit_success({ deleted: true }))
        }

        const hasChildren = await task_has_children(db, args.task_id)
        if (hasChildren) {
          return JSON.stringify(arbeit_error({ code: 'HAS_CHILDREN', message: 'Task has child tasks and cannot be deleted' }))
        }

        const deleted = await soft_delete_task(db, args.task_id)
        if (!deleted) {
          return JSON.stringify(arbeit_error({ code: 'TASK_DELETE_FAILED', message: 'An error occurred while deleting the task in the database' }))
        }

        return JSON.stringify(arbeit_success({ deleted: true }))
      })
    }
  })
}

/**
 * Signal that the agent is starting work on a task.
 *
 * Parameters:
 * - task_id: string (required) Task ID
 *
 * Returns: { task: Task, session_linked: boolean }
 *
 * Errors:
 * - TASK_NOT_FOUND: Task doesn't exist
 * - ALREADY_WORKING: This session is already working on a different task
 * - TASK_NOT_ACTIVE: Task is completed or cancelled
 */
export function arbeit_task_start_work({ directory }: { directory: string }) {
  return tool({
    description: 'Use when actively working in this session; links the session and enables file tracking.',
    args: {
      task_id: tool.schema.string().describe('Task ID to actively work on.')
    },
    async execute(args, context) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)

        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }

        if (task.status === 'completed' || task.status === 'cancelled') {
          return JSON.stringify(arbeit_error({ code: 'TASK_NOT_ACTIVE', message: 'Task is not active' }))
        }

        const activeWork = await get_active_work(db, context.sessionID)
        if (activeWork && activeWork.task_id !== args.task_id) {
          return JSON.stringify(arbeit_error({ code: 'ALREADY_WORKING', message: 'Session already working on a different task' }))
        }

        if (task.status === 'open') {
          await update_task(db, args.task_id, { status: 'in_progress' })
        }

        const sessionLinked = await ensure_session_link(db, { session_id: context.sessionID, task_id: args.task_id })

        if (!activeWork) {
          await insert_active_work(db, { session_id: context.sessionID, task_id: args.task_id })
        }

        const updatedTask = await get_task(db, args.task_id)
        if (!updatedTask) {
          return JSON.stringify(
            arbeit_error({
              code: 'TASK_NOT_FOUND',
              message: `Task not found after start work. task_id: ${args.task_id}`,
              suggestions: TASK_NOT_FOUND_SUGGESTIONS
            })
          )
        }

        return JSON.stringify(arbeit_success({ task: updatedTask, session_linked: sessionLinked }))
      })
    }
  })
}

/**
 * Signal that the agent is done working on a task (for this session).
 *
 * Parameters:
 * - task_id: string (required) Task ID
 *
 * Returns: { stopped: boolean }
 *
 * Errors:
 * - NOT_WORKING_ON_TASK: This session is not working on the task
 */
export function arbeit_task_stop_work({ directory }: { directory: string }) {
  return tool({
    description: 'Use when pausing or finishing work in this session; ends active tracking.',
    args: {
      task_id: tool.schema.string().describe('Task ID to stop working on.')
    },
    async execute(args, context) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const activeWork = await get_active_work(db, context.sessionID)

        if (!activeWork || activeWork.task_id !== args.task_id) {
          return JSON.stringify(arbeit_error({ code: 'NOT_WORKING_ON_TASK', message: 'Session is not working on this task' }))
        }

        await remove_active_work(db, { session_id: context.sessionID, task_id: args.task_id })

        return JSON.stringify(arbeit_success({ stopped: true }))
      })
    }
  })
}

export function arbeit_relationship({ directory }: { directory: string }) {
  return tool({
    description: 'Use to add or remove hierarchy/dependency links between tasks.',
    args: {
      action: tool.schema.enum(['add', 'remove']).describe('Whether to add or remove the relationship.'),
      from_task_id: tool.schema.string().describe('Source task for the relationship.'),
      to_task_id: tool.schema.string().describe('Target task for the relationship.'),
      type: tool.schema.enum([
        'parent_of',
        'child_of',
        'blocks',
        'blocked_by',
        'relates_to',
        'duplicates',
        'duplicated_by',
        'splits_from',
        'split_into'
      ]).describe('Relationship type; inverse forms normalize automatically.'),
      metadata: tool.schema.object({}).passthrough().optional().describe('Optional reason/metadata (add only).')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)

        if (args.action === 'add') {
          const validation = await validate_relationship_input(db, {
            from_task_id: args.from_task_id,
            to_task_id: args.to_task_id,
            type: args.type as RelationshipInputType
          })

          const relationship = await create_relationship(db, {
            ...validation.normalized,
            metadata: args.metadata
          })

          return JSON.stringify(arbeit_success({ relationship }))
        }

        const removed = await remove_relationship(db, {
          from_task_id: args.from_task_id,
          to_task_id: args.to_task_id,
          type: args.type as RelationshipInputType
        })
        return JSON.stringify(arbeit_success({ removed }))
      })
    }
  })
}

export function arbeit_context_add({ directory }: { directory: string }) {
  return tool({
    description: 'Use to record decisions, attempts, blockers, or notes; can supersede stale context.',
    args: {
      task_id: tool.schema.string().describe('Task this context belongs to.'),
      type: tool.schema.enum(CONTEXT_TYPES).describe('Context label (decision, blocker, attempt, etc.).'),
      content: tool.schema.string().min(1).describe('The context text to store.'),
      metadata: tool.schema.object({}).passthrough().optional().describe('Optional structured details (source, links, etc.).'),
      supersede_entry_id: tool.schema.string().optional().describe('Set to replace a stale entry with this one.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }

        if (args.supersede_entry_id) {
          const { old_entry, new_entry } = await supersede_context_entry(db, {
            entry_id: args.supersede_entry_id,
            new_content: args.content,
            type: args.type,
            metadata: args.metadata
          })

          if (args.metadata === undefined) {
            new_entry.metadata = old_entry.metadata
          }

          return JSON.stringify(arbeit_success({ entry: new_entry, superseded: old_entry }))
        }

        const entry = await create_context_entry(db, {
          task_id: args.task_id,
          type: args.type,
          content: args.content,
          metadata: args.metadata ?? null
        })

        return JSON.stringify(arbeit_success({ entry }))
      })
    }
  })
}

/**
 * Add progress items for a task.
 *
 * Parameters:
 * - task_id: string (required) Task ID
 * - items: string[] (required) Progress items
 * - completed?: boolean Mark items complete on creation
 *
 * Returns: { items: ProgressItem[] }
 *
 * Errors:
 * - TASK_NOT_FOUND: Task doesn't exist
 * - NO_CHANGES_MADE: Items list was empty
 */
export function arbeit_progress_add({ directory }: { directory: string }) {
  return tool({
    description: 'Use to create progress items for a task.',
    args: {
      task_id: tool.schema.string().describe('Task ID to attach progress items to.'),
      items: tool.schema.array(tool.schema.string()).describe('Progress items to add.'),
      completed: tool.schema.boolean().optional().describe('Mark items as completed when created.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)
        if (!task) {
          return JSON.stringify(
            arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found', suggestions: TASK_NOT_FOUND_SUGGESTIONS })
          )
        }

        if (args.items.length === 0) {
          return JSON.stringify(
            arbeit_error({
              code: 'NO_CHANGES_MADE',
              message: 'No progress items provided',
              suggestions: ['Provide at least one progress item in items.']
            })
          )
        }

        const items = await create_progress_items(db, {
          task_id: args.task_id,
          items: args.items,
          completed: args.completed
        })

        return JSON.stringify(arbeit_success({ items }))
      })
    }
  })
}

/**
 * Complete progress items by ID.
 *
 * Parameters:
 * - item_ids: string[] (required) Progress item IDs to complete
 *
 * Returns: { completed: ProgressItem[] }
 *
 * Errors:
 * - ITEM_NOT_FOUND: One or more progress items not found
 * - NO_CHANGES_MADE: item_ids was empty
 */
export function arbeit_progress_complete({ directory }: { directory: string }) {
  return tool({
    description: 'Use to mark progress items as complete.',
    args: {
      item_ids: tool.schema.array(tool.schema.string()).describe('Progress item IDs to mark complete.')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)

        if (args.item_ids.length === 0) {
          return JSON.stringify(
            arbeit_error({
              code: 'NO_CHANGES_MADE',
              message: 'No progress item IDs provided',
              suggestions: PROGRESS_EMPTY_SUGGESTIONS
            })
          )
        }

        const completed = await complete_progress_items(db, { item_ids: args.item_ids })
        return JSON.stringify(arbeit_success({ completed }))
      })
    }
  })
}

function tasks_query_params(params: Record<string, unknown>): { status?: TaskStatus; parent_id?: string | null } {
  return {
    status: params.status as TaskStatus | undefined,
    parent_id: params.parent_id as string | null | undefined
  }
}

export function arbeit_query({ directory }: { directory: string }) {
  return tool({
    description: 'Use for list and graph queries (tasks, blockers, ancestry).',
    args: {
      query: tool.schema.enum([
        'tasks',
        'active_tasks',
        'blocked_tasks',
        'blocking_tasks',
        'children_of',
        'descendants_of',
        'ancestors_of'
      ]).describe('Named query to run.'),
      params: tool.schema
        .object({
          status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
          parent_id: tool.schema.string().nullable().optional(),
          task_id: tool.schema.string().optional()
        })
        .passthrough()
        .optional()
        .describe('Query filters (status, parent_id, task_id).')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const params = args.params ?? {}

        switch (args.query) {
          case 'tasks': {
            const filters = tasks_query_params(params)
            const tasks = await list_tasks(db, filters)
            return JSON.stringify(arbeit_success({ tasks }))
          }
          case 'active_tasks': {
            const tasks = await list_tasks_by_statuses(db, {
              statuses: ['open', 'in_progress'],
              parent_id: params.parent_id as string | null | undefined
            })
            return JSON.stringify(arbeit_success({ tasks }))
          }
          case 'blocked_tasks': {
            const tasks = await query_blocked_tasks(db, params.status as TaskStatus | undefined)
            return JSON.stringify(arbeit_success({ tasks }))
          }
          case 'blocking_tasks': {
            const tasks = await query_blocking_tasks(db, params.status as TaskStatus | undefined)
            return JSON.stringify(arbeit_success({ tasks }))
          }
          case 'children_of': {
            if (!params.task_id) {
              return JSON.stringify(
                arbeit_error({
                  code: 'TASK_NOT_FOUND',
                  message: 'task_id is required',
                  suggestions: TASK_NOT_FOUND_SUGGESTIONS
                })
              )
            }
            const tasks = await query_children_of(db, params.task_id)
            return JSON.stringify(arbeit_success({ tasks }))
          }
          case 'descendants_of': {
            if (!params.task_id) {
              return JSON.stringify(
                arbeit_error({
                  code: 'TASK_NOT_FOUND',
                  message: 'task_id is required',
                  suggestions: TASK_NOT_FOUND_SUGGESTIONS
                })
              )
            }
            const task_ids = await query_descendants_of(db, params.task_id)
            return JSON.stringify(arbeit_success({ task_ids }))
          }
          case 'ancestors_of': {
            if (!params.task_id) {
              return JSON.stringify(
                arbeit_error({
                  code: 'TASK_NOT_FOUND',
                  message: 'task_id is required',
                  suggestions: TASK_NOT_FOUND_SUGGESTIONS
                })
              )
            }
            const task_ids = await query_ancestors_of(db, params.task_id)
            return JSON.stringify(arbeit_success({ task_ids }))
          }
        }
      })
    }
  })
}
