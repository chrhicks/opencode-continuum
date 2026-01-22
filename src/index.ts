import type { Plugin } from '@opencode-ai/plugin'
import {
  continuum_init,
  continuum_query,
  continuum_task_create,
  continuum_task_delete,
  continuum_task_get,
  continuum_task_update,
  // Execution model
  continuum_step_add,
  continuum_step_complete,
  continuum_step_update,
  continuum_task_discover,
  continuum_task_decide,
  continuum_task_complete
} from './tools'

export const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    tool: {
      continuum_init: continuum_init({ directory }),
      continuum_task_create: continuum_task_create({ directory }),
      continuum_task_get: continuum_task_get({ directory }),
      continuum_task_update: continuum_task_update({ directory }),
      continuum_task_delete: continuum_task_delete({ directory }),
      continuum_query: continuum_query({ directory }),
      // Execution model
      continuum_step_add: continuum_step_add({ directory }),
      continuum_step_complete: continuum_step_complete({ directory }),
      continuum_step_update: continuum_step_update({ directory }),
      continuum_task_discover: continuum_task_discover({ directory }),
      continuum_task_decide: continuum_task_decide({ directory }),
      continuum_task_complete: continuum_task_complete({ directory })
    }
  }
}

