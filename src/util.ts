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
  } catch {
    return false
  }
}

export async function init_status({ directory }: { directory: string }): Promise<InitStatus> {
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
