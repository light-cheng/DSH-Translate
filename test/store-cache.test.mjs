import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { TranslationCache } from '../lib/cache.js'
import { JsonStore } from '../lib/store.js'

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-translate-store-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('JsonStore loads defaults, tolerates corrupt files, and merges persisted data', async (t) => {
  const dir = await tempDir(t)
  const filePath = path.join(dir, 'settings.json')

  const fresh = new JsonStore({ filePath, defaults: { a: 1, b: 2 } })
  await fresh.load()
  assert.deepEqual(fresh.snapshot(), { a: 1, b: 2 })

  await writeFile(filePath, '{broken json', 'utf8')
  const corrupt = new JsonStore({ filePath, defaults: { a: 1, b: 2 } })
  await corrupt.load()
  assert.deepEqual(corrupt.snapshot(), { a: 1, b: 2 })
  assert.ok(corrupt.loadError instanceof Error)

  await corrupt.update({ b: 9 })
  const reloaded = new JsonStore({ filePath, defaults: { a: 1, b: 2, c: 3 } })
  await reloaded.load()
  assert.deepEqual(reloaded.snapshot(), { a: 1, b: 9, c: 3 })
})

test('JsonStore serializes concurrent mutate and update calls with no leftover tmp files', async (t) => {
  const dir = await tempDir(t)
  const filePath = path.join(dir, 'vocab.json')
  const store = new JsonStore({ filePath, defaults: { entries: [] } })
  await store.load()

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.mutate(async (current) => {
        await new Promise((resolve) => setTimeout(resolve, i % 3))
        return { entries: [...current.entries, `item-${i}`] }
      }),
    ),
  )

  const snapshot = store.snapshot()
  assert.equal(snapshot.entries.length, 20)
  const onDisk = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(onDisk.data.entries.length, 20)

  const files = await readdir(dir)
  assert.deepEqual(files, ['vocab.json'])
})

test('TranslationCache persists, reloads, updates limit with eviction, and flushes concurrently without tmp residue', async (t) => {
  const dir = await tempDir(t)
  const filePath = path.join(dir, 'cache.json')
  const cache = new TranslationCache({ filePath, limit: 10 })
  await cache.load()

  cache.set('k1', { translation: 't1' })
  cache.set('k2', { translation: 't2' })
  cache.set('k3', { translation: 't3' })
  cache.set('k4', { translation: 't4' })

  await Promise.all([cache.flush(), cache.flush(), cache.flush()])
  assert.equal(cache.size, 4)

  cache.setLimit(2)
  assert.equal(cache.size, 2)
  assert.equal(cache.get('k1'), undefined)
  assert.equal(cache.get('k2'), undefined)
  assert.deepEqual(cache.get('k3'), { translation: 't3' })
  assert.deepEqual(cache.get('k4'), { translation: 't4' })
  await cache.flush()

  const reloaded = new TranslationCache({ filePath, limit: 2 })
  await reloaded.load()
  assert.equal(reloaded.size, 2)
  assert.deepEqual(reloaded.get('k3'), { translation: 't3' })

  const files = await readdir(dir)
  assert.deepEqual(files, ['cache.json'])
})
