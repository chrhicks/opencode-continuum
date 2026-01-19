import { tool } from '@opencode-ai/plugin'
import {
  create_relationship,
  create_task,
  ensure_session_link,
  get_active_work,
  get_db,
  get_relationships_for_task,
  get_task,
  insert_active_work,
  list_tasks,
  query_ancestors_of,
  query_blocked_tasks,
  query_blocking_tasks,
  query_children_of,
  query_descendants_of,
  remove_active_work,
  remove_relationship,
  soft_delete_task,
  task_has_children,
  update_task,
  validate_relationship_input,
  type RelationshipInputType,
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
    description: 'Initialize arbeit in the current directory',
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
    description: 'Create a new task',
    args: {
      title: tool.schema.string().min(1).describe('Brief description'),
      intent: tool.schema.string().optional().describe('The "why" (immutable after creation)'),
      parent_id: tool.schema.string().optional().describe('The parent task ID for hierarchy'),
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('The initial status of the task (default: open)')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
         const taskId = await create_task(db, args)
         const task = await get_task(db, taskId)

         if (!task) {
           return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found after create' }))
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
 *
 * Returns: { task: Task, relationships: Relationship[], context: ContextEntry[], progress: ProgressItem[] }
 *
 * Errors:
 * - TASK_NOT_FOUND: Task doesn't exist
 */
export function arbeit_task_get({ directory }: { directory: string }) {
  return tool({
    description: 'Get a task by ID',
    args: {
      task_id: tool.schema.string().describe('The ID of the task to get'),
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
         const task = await get_task(db, args.task_id)
         if (!task) {
           return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found' }))
         }
         const relationships = await get_relationships_for_task(db, args.task_id)
         return JSON.stringify(arbeit_success({ task, relationships }))

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
    description: 'Update a task by ID',
    args: {
      task_id: tool.schema.string().describe('The ID of the task to update'),
      title: tool.schema.string().min(1).optional().describe('New title'),
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('New status'),
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)

        if (!args.title && !args.status) {
          return JSON.stringify(arbeit_error({ code: 'NO_CHANGES_MADE', message: 'No changes made' }))
        }

        const task = await get_task(db, args.task_id)

        if (!task) {
          return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found' }))
        }
        const updateResult = await update_task(db, args.task_id, { title: args.title, status: args.status })
        
        if (!updateResult) {
          return JSON.stringify(arbeit_error({ code: 'TASK_UPDATE_FAILED', message: 'An error occurred while updating the task in the database' }))
        }
        const updatedTask = await get_task(db, args.task_id)
        if (!updatedTask) {
          return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: `Updated task not found after update. task_id: ${args.task_id}` }))
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
    description: 'Delete a task by ID',
    args: {
      task_id: tool.schema.string().describe('The ID of the task to delete'),
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)

        if (!task) {
          return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found' }))
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
 * List tasks with optional filters.
 *
 * Parameters:
 * - status?: string Filter by status
 * - parent_id?: string | null Filter by parent (use null for root tasks)
 *
 * Returns: { tasks: Task[] }
 */
export function arbeit_task_list({ directory }: { directory: string }) {
  return tool({
    description: 'List tasks with optional filters',
    args: {
      status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Filter by status'),
      parent_id: tool.schema.string().nullable().optional().describe('Filter by parent (use null for root tasks)')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const tasks = await list_tasks(db, { status: args.status, parent_id: args.parent_id })
        return JSON.stringify(arbeit_success({ tasks }))
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
    description: 'Signal that the agent is starting work on a task',
    args: {
      task_id: tool.schema.string().describe('The ID of the task to start work on')
    },
    async execute(args, context) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const task = await get_task(db, args.task_id)

        if (!task) {
          return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'Task not found' }))
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
          return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: `Task not found after start work. task_id: ${args.task_id}` }))
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
    description: 'Signal that the agent is done working on a task (for this session)',
    args: {
      task_id: tool.schema.string().describe('The ID of the task to stop work on')
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

export function arbeit_relationship_add({ directory }: { directory: string }) {
  return tool({
    description: 'Create a relationship between tasks',
    args: {
      from_task_id: tool.schema.string().describe('Source task'),
      to_task_id: tool.schema.string().describe('Target task'),
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
      ]).describe('Relationship type'),
      metadata: tool.schema.object({}).passthrough().optional().describe('Additional metadata')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
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
      })
    }
  })
}

export function arbeit_relationship_remove({ directory }: { directory: string }) {
  return tool({
    description: 'Remove a relationship between tasks',
    args: {
      from_task_id: tool.schema.string().describe('Source task'),
      to_task_id: tool.schema.string().describe('Target task'),
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
      ]).describe('Relationship type')
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
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

export function arbeit_query({ directory }: { directory: string }) {
  return tool({
    description: 'Execute a named query',
    args: {
      query: tool.schema.enum([
        'blocked_tasks',
        'blocking_tasks',
        'children_of',
        'descendants_of',
        'ancestors_of'
      ]).describe('Query name'),
      params: tool.schema
        .object({
          status: tool.schema.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
          task_id: tool.schema.string().optional()
        })
        .passthrough()
        .optional()
    },
    async execute(args) {
      return with_arbeit_error_handling(async () => {
        const db = await get_db(directory)
        const params = args.params ?? {}

        switch (args.query) {
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
              return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'task_id is required' }))
            }
            const tasks = await query_children_of(db, params.task_id)
            return JSON.stringify(arbeit_success({ tasks }))
          }
          case 'descendants_of': {
            if (!params.task_id) {
              return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'task_id is required' }))
            }
            const task_ids = await query_descendants_of(db, params.task_id)
            return JSON.stringify(arbeit_success({ task_ids }))
          }
          case 'ancestors_of': {
            if (!params.task_id) {
              return JSON.stringify(arbeit_error({ code: 'TASK_NOT_FOUND', message: 'task_id is required' }))
            }
            const task_ids = await query_ancestors_of(db, params.task_id)
            return JSON.stringify(arbeit_success({ task_ids }))
          }
        }
      })
    }
  })
}
