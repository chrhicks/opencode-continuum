import type { Plugin } from '@opencode-ai/plugin'
import {
  arbeit_v2_init,
  arbeit_v2_query,
  arbeit_v2_task_create,
  arbeit_v2_task_delete,
  arbeit_v2_task_get,
  arbeit_v2_task_update
} from './tools.v2'

export const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    tool: {
      arbeit_v2_init: arbeit_v2_init({ directory }),
      arbeit_v2_task_create: arbeit_v2_task_create({ directory }),
      arbeit_v2_task_get: arbeit_v2_task_get({ directory }),
      arbeit_v2_task_update: arbeit_v2_task_update({ directory }),
      arbeit_v2_task_delete: arbeit_v2_task_delete({ directory }),
      arbeit_v2_query: arbeit_v2_query({ directory })
    }
  }
}

