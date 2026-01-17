import type { Plugin } from '@opencode-ai/plugin'
import { arbeit_init } from './tools'

export const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    tool: {
      arbeit_init: arbeit_init({ directory }),
    }
  }
}

