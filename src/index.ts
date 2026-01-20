import type { Plugin } from '@opencode-ai/plugin'
import {
  continuum_init,
  continuum_query,
  continuum_task_create,
  continuum_task_delete,
  continuum_task_get,
  continuum_task_update
} from './tools'

export const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    tool: {
      continuum_init: continuum_init({ directory }),
      continuum_task_create: continuum_task_create({ directory }),
      continuum_task_get: continuum_task_get({ directory }),
      continuum_task_update: continuum_task_update({ directory }),
      continuum_task_delete: continuum_task_delete({ directory }),
      continuum_query: continuum_query({ directory })
    }
  }
}

