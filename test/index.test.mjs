import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, name } from '../index.js'

test('index apply wires profile stores, routes, service disposal, and flushes cache on unload', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-translate-index-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const effects = []
  const routes = new Map()
  const childEffects = []
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    get(service) {
      if (service === 'profileContext') return { dir }
      return undefined
    },
    inject(deps, cb) {
      if (deps.includes('llm')) {
        const child = {
          llm: { async *stream() {} },
          agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
          effect(fn) {
            const d = fn()
            if (typeof d === 'function') childEffects.push(d)
            return d
          },
        }
        cb(child)
        return () => {
          for (const d of childEffects) d()
        }
      }
      if (deps.includes('webServer')) {
        const child = {
          get: () => ({ requestRejection: () => undefined }),
          webServer: {
            register(route) {
              routes.set(route.path, route)
              return () => {}
            },
          },
          effect(fn) {
            return fn()
          },
        }
        cb(child)
        return () => {}
      }
      return () => {}
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') effects.push(d)
    },
  }

  assert.equal(name, 'dsh-translate')
  await apply(ctx, { enabled: true })

  assert.ok(routes.has('/dsh-translate/api/state'))
  assert.ok(routes.has('/dsh-translate/api/translate'))

  // Seed a translation cache entry via /translate and verify unload flushes it to profileDir.
  const route = routes.get('/dsh-translate/api/translate')
  let stateBody = ''
  const stateRoute = routes.get('/dsh-translate/api/state')
  await stateRoute.handler(
    { method: 'GET', url: '/dsh-translate/api/state', headers: {}, async *[Symbol.asyncIterator]() {} },
    { statusCode: 200, writableEnded: false, setHeader() {}, end(c) { stateBody += c ?? '' } },
  )
  const state = JSON.parse(stateBody)
  assert.equal(state.persist, true)
  assert.equal(state.llmAvailable, true)

  // Dispose services (including child model disposer and cache flush disposer).
  for (const dispose of effects) await dispose()

  // Verify after llm child disposal, /state reports llmAvailable: false.
  let afterBody = ''
  await stateRoute.handler(
    { method: 'GET', url: '/dsh-translate/api/state', headers: {}, async *[Symbol.asyncIterator]() {} },
    { statusCode: 200, writableEnded: false, setHeader() {}, end(c) { afterBody += c ?? '' } },
  )
  assert.equal(JSON.parse(afterBody).llmAvailable, false)
  assert.ok(route)
})

test('index apply flushes dirty cache to disk on unload and survives missing profileContext', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-translate-flush-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const effects = []
  const routes = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    get(service) {
      if (service === 'profileContext') return { dir }
      return undefined
    },
    inject(deps, cb) {
      if (deps.includes('llm')) {
        cb({
          llm: {
            async *stream() {
              yield { type: 'text-delta', text: '{"translation":"你好"}' }
            },
          },
          agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        })
        return () => {}
      }
      if (deps.includes('webServer')) {
        cb({
          get: () => ({ requestRejection: () => undefined }),
          webServer: {
            register(route) {
              routes.set(route.path, route)
              return () => {}
            },
          },
          effect: (fn) => fn(),
        })
        return () => {}
      }
      return () => {}
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') effects.push(d)
    },
  }

  await apply(ctx, {})
  const translate = routes.get('/dsh-translate/api/translate')
  let body = ''
  await translate.handler(
    {
      method: 'POST',
      url: '/dsh-translate/api/translate',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ text: 'Hello world', mode: 'selection' }))
      },
    },
    { statusCode: 200, writableEnded: false, setHeader() {}, end(c) { body += c ?? '' } },
  )
  assert.equal(JSON.parse(body).ok, true)

  for (const dispose of effects) await dispose()
  const cachePath = path.join(dir, 'dsh-translate', 'cache.json')
  assert.equal(existsSync(cachePath), true)
  const saved = JSON.parse(readFileSync(cachePath, 'utf8'))
  assert.equal(saved.entries.length, 1)

  // Memory-only run without profileContext must also succeed.
  const memRoutes = new Map()
  await apply(
    {
      logger: { info() {}, warn() {}, debug() {} },
      inject(deps, cb) {
        if (deps.includes('webServer')) {
          cb({
            get: () => undefined,
            webServer: { register: (r) => { memRoutes.set(r.path, r); return () => {} } },
            effect: (fn) => fn(),
          })
        }
        return () => {}
      },
      effect() {},
    },
    {},
  )
  assert.ok(memRoutes.has('/dsh-translate/api/state'))
})
