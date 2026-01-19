import type { Plugin } from '@opencode-ai/plugin'
import {
  arbeit_init,
  arbeit_query,
  arbeit_relationship_add,
  arbeit_relationship_remove,
  arbeit_task_create,
  arbeit_task_delete,
  arbeit_task_get,
  arbeit_task_list,
  arbeit_task_start_work,
  arbeit_task_stop_work,
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
      arbeit_task_list: arbeit_task_list({ directory }),
      arbeit_task_start_work: arbeit_task_start_work({ directory }),
      arbeit_task_stop_work: arbeit_task_stop_work({ directory }),
      arbeit_relationship_add: arbeit_relationship_add({ directory }),
      arbeit_relationship_remove: arbeit_relationship_remove({ directory }),
      arbeit_query: arbeit_query({ directory })
    }
  }
}

