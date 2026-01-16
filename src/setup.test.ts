import { describe, expect, test } from 'bun:test'
import { init_status } from './index'

test('init_status empty', async () => {
  const directory = `${process.cwd()}/src/__test__/wrk_no_init`
  const status = await init_status({ directory })
  expect(status).toHaveProperty('pluginDirExists')
  expect(status).toHaveProperty('dbFileExists')
  expect(status.pluginDirExists).toBe(false)
  expect(status.dbFileExists).toBe(false)
})

test('init_status plugin only', async () => {
  const directory = `${process.cwd()}/src/__test__/wrk_plugin_init`
  console.log(directory)
  const status = await init_status({ directory })
  expect(status).toHaveProperty('pluginDirExists')
  expect(status).toHaveProperty('dbFileExists')
  expect(status.pluginDirExists).toBe(true)
  expect(status.dbFileExists).toBe(false)
})

test('init_status full', async () => {
  const directory = `${process.cwd()}/src/__test__/wrk_full_init`
  const status = await init_status({ directory })
  expect(status).toHaveProperty('pluginDirExists')
  expect(status).toHaveProperty('dbFileExists')
  expect(status.pluginDirExists).toBe(true)
  expect(status.dbFileExists).toBe(true)
})
