import type { Plugin } from '@opencode-ai/plugin'
import {
  arbeit_init,
  arbeit_query,
  arbeit_task_create,
  arbeit_task_delete,
  arbeit_task_get,
  arbeit_task_update
} from './tools'

export const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    tool: {
      arbeit_init: arbeit_init({ directory }),
      arbeit_task_create: arbeit_task_create({ directory }),
      arbeit_task_get: arbeit_task_get({ directory }),
      arbeit_task_update: arbeit_task_update({ directory }),
      arbeit_task_delete: arbeit_task_delete({ directory }),
      arbeit_query: arbeit_query({ directory })
    }
  }
}

