import type { Plugin } from '@opencode-ai/plugin'
import {
  arbeit_context_add,
  arbeit_init,
  arbeit_progress_add,
  arbeit_progress_complete,
  arbeit_query,
  arbeit_relationship,
  arbeit_task_brief,
  arbeit_task_create,
  arbeit_task_delete,
  arbeit_task_get,
  arbeit_task_start_work,
  arbeit_task_stop_work,
  arbeit_task_update
} from './tools'

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
      arbeit_init: arbeit_init({ directory }),
      arbeit_task_create: arbeit_task_create({ directory }),
      arbeit_task_get: arbeit_task_get({ directory }),
      arbeit_task_brief: arbeit_task_brief({ directory }),
      arbeit_task_update: arbeit_task_update({ directory }),
      arbeit_task_delete: arbeit_task_delete({ directory }),
      arbeit_task_start_work: arbeit_task_start_work({ directory }),
      arbeit_task_stop_work: arbeit_task_stop_work({ directory }),
      arbeit_context_add: arbeit_context_add({ directory }),
      arbeit_progress_add: arbeit_progress_add({ directory }),
      arbeit_progress_complete: arbeit_progress_complete({ directory }),
      arbeit_relationship: arbeit_relationship({ directory }),
      arbeit_query: arbeit_query({ directory }),
      arbeit_v2_init: arbeit_v2_init({ directory }),
      arbeit_v2_task_create: arbeit_v2_task_create({ directory }),
      arbeit_v2_task_get: arbeit_v2_task_get({ directory }),
      arbeit_v2_task_update: arbeit_v2_task_update({ directory }),
      arbeit_v2_task_delete: arbeit_v2_task_delete({ directory }),
      arbeit_v2_query: arbeit_v2_query({ directory })
    }
  }
}

