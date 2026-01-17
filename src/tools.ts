import { tool } from '@opencode-ai/plugin'
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
  
  if (!pluginDirExists) {
    await mkdir(`${directory}/.arbeit`, { recursive: true })
  }
  if (!dbFileExists) {
    await init_db(directory)
  }
}

export function arbeit_init({ directory }: { directory: string }) {
 return tool({
    description: 'Initialize arbeit in the current directory',
    args: {},
    async execute(args, ctx) {
        await init_project({ directory })
        
        return JSON.stringify({ success: true, data: { initialized: true, path: directory } })
    }
  })
}