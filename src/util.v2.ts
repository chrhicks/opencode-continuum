import { mkdir } from 'node:fs/promises'
import { init_db_v2 } from './db.v2'

interface InitStatusV2 {
  pluginDirExists: boolean
  dbFileExists: boolean
}

export async function dir_exists_v2(directory: string) {
  try {
    const stat = await Bun.file(`${directory}`).stat()
    return stat.isDirectory()
  } catch {
    return false
  }
}

export async function init_status_v2({ directory }: { directory: string }): Promise<InitStatusV2> {
  const pluginDirExists = await dir_exists_v2(`${directory}/.arbeit`)
  const dbFile = Bun.file(`${directory}/.arbeit/arbeit_v2.db`)
  const dbFileExists = await dbFile.exists()

  return {
    pluginDirExists,
    dbFileExists
  }
}

export async function init_project_v2({ directory }: { directory: string }) {
  const { pluginDirExists, dbFileExists } = await init_status_v2({ directory })

  if (!pluginDirExists) {
    await mkdir(`${directory}/.arbeit`, { recursive: true })
  }
  if (!dbFileExists) {
    await init_db_v2(directory)
  }
}
