import { tool } from '@opencode-ai/plugin'
import { create_task, ensure_session_link, get_active_work, get_db, get_task, insert_active_work, list_tasks, remove_active_work, soft_delete_task, task_has_children, update_task } from './db'
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

        // TODO: IMPLEMENT PARENT TASK CHECK AND MAX DEPTH CHECK
        // if (args.parent_id) {
        //   const parentTask = await get_task(db, args.parent_id)
        //   if (!parentTask) {
        //     return JSON.stringify(arbeit_error({ code: 'PARENT_NOT_FOUND', message: 'Parent task not found' }))
        //   }
        // }

        // TODO: TEMP RESPONSE
        return JSON.stringify(arbeit_success({ task }))
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
        return JSON.stringify(arbeit_success({ task }))
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
