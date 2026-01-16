import type { Plugin } from '@opencode-ai/plugin'
import { mkdir } from 'node:fs/promises'
import { init_db } from './db'

interface InitStatus {
  pluginDirExists: boolean
  dbFileExists: boolean
}

export async function dir_exists(directory: string) {
  try {
    const stat = await Bun.file(`${directory}`).stat()
    return stat.isDirectory()
  } catch (error) {
    return false
  }
}

export async function init_status({ directory}: { directory: string }): Promise<InitStatus> {
  const pluginDirExists = await dir_exists(`${directory}/.arbeit`)
  const dbFile = Bun.file(`${directory}/.arbeit/arbeit.db`)
  const dbFileExists = await dbFile.exists()

  return {
    pluginDirExists,
    dbFileExists
  }
}

export async function init_project({ directory }: { directory: string }) {
  const { pluginDirExists, dbFileExists } = await init_status({ directory })

  console.log('[arbeit] init_project', { pluginDirExists, dbFileExists }) 
  if (!pluginDirExists) {
    console.log(`Initializing plugin directory at ${directory}/.arbeit`)
    await mkdir(`${directory}/.arbeit`, { recursive: true })
  }
  if (!dbFileExists) {
    console.log(`Initializing database at ${directory}/.arbeit/arbeit.db`)
    await init_db(directory)
  }
}

export const plugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  console.log('[arbeit] init', { project, directory, worktree })
  await init_project({ directory })
  return {
  }
}

