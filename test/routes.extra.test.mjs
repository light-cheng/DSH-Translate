import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { TranslationCache } from '../lib/cache.js'
import { listLocalModels } from '../lib/local.js'
import { API_PREFIX, registerTranslateRoutes, safeMessage } from '../lib/routes.js'
import { JsonStore } from '../lib/store.js'

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-translate-extra-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function createRuntime(t, { dir, answer = () => '{}', rejection } = {}) {
  const defaults = {
    enabled: true,
    targetLanguage: 'zh-CN',
    autoTranslate: false,
    showTerms: true,
    showContext: true,
    showDict: true,
    accent: 'us',
    maxChars: 8000,
    cacheLimit: 2000,
    model: null,
    engine: 'cloud',
    localBaseUrl: 'http://127.0.0.1:11434',
    localModel: '',
  }
  const settings = new JsonStore({
    filePath: dir ? path.join(dir, 'settings.json') : undefined,
    defaults,
  })
  const vocab = new JsonStore({
    filePath: dir ? path.join(dir, 'vocab.json') : undefined,
    defaults: { entries: [] },
  })
  const cache = new TranslationCache({
    filePath: dir ? path.join(dir, 'cache.json') : undefined,
    limit: defaults.cacheLimit,
  })
  const calls = []
  const runtime = {
    config: defaults,
    logger: { debug() {}, info() {}, warn() {} },
    services: {
      llm: {
        async *stream(req) {
          const prompt = req?.messages?.[0]?.content?.[0]?.text ?? ''
          calls.push(prompt)
          yield { type: 'text-delta', text: answer(prompt) }
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'm1' }) },
    },
    settings,
    vocab,
    cache,
    dictionary: { stats: null, async load() { return false }, lookupMany: (words) => words.map((w) => ({ query: w, found: false })) },
    ready: Promise.all([settings.load(), vocab.load(), cache.load()]),
  }

  const routes = new Map()
  let disposed = 0
  const ctx = {
    inject(services, callback) {
      assert.deepEqual(services, ['webServer', 'connection'])
      const child = {
        get(name) {
          if (name === 'connection') return { requestRejection: () => rejection }
          return undefined
        },
        webServer: {
          register(route) {
            routes.set(route.path, route)
            return () => {
              disposed += 1
            }
          },
        },
        effect(factory) {
          const d = factory()
          return d
        },
      }
      callback(child)
      return () => {
        disposed += 100
      }
    },
  }
  const disposer = registerTranslateRoutes(ctx, () => runtime)
  return { runtime, routes, calls, disposer, getDisposed: () => disposed }
}

async function callRoute(routes, suffix, { method = 'GET', url, body } = {}) {
  const route = routes.get(`${API_PREFIX}${suffix}`)
  assert.ok(route, `${suffix} must be registered`)
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  const req = {
    method,
    url: url ?? `${API_PREFIX}${suffix}`,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    statusCode: 200,
    writableEnded: false,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value)
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
      this.writableEnded = true
    },
  }
  await route.handler(req, res)
  return {
    status: res.statusCode,
    raw: res.body,
    json: res.body ? JSON.parse(res.body) : undefined,
  }
}

test('registerTranslateRoutes returns disposer and omits dead /diag route', (t) => {
  const { routes, disposer, getDisposed } = createRuntime(t)
  assert.equal(typeof disposer, 'function')
  assert.equal(routes.has(`${API_PREFIX}/diag`), false)
  disposer()
  assert.equal(getDisposed(), 100)
})

test('connection trust fence rejects unauthorized requests with configured status', async (t) => {
  const { routes } = createRuntime(t, { rejection: 403 })
  const res = await callRoute(routes, '/state')
  assert.equal(res.status, 403)
  assert.equal(res.raw, '')
})

test('POST /settings preserves model on partial updates, rejects invalid localBaseUrl, and updates cacheLimit', async (t) => {
  const { runtime, routes } = createRuntime(t)
  await runtime.ready

  const setModel = await callRoute(routes, '/settings', {
    method: 'POST',
    body: { settings: { model: { provider: 'deepseek', model: 'deepseek-chat' } } },
  })
  assert.deepEqual(setModel.json.settings.model, { provider: 'deepseek', model: 'deepseek-chat' })

  const partial = await callRoute(routes, '/settings', {
    method: 'POST',
    body: { settings: { showDict: false } },
  })
  assert.equal(partial.json.ok, true)
  assert.equal(partial.json.settings.showDict, false)
  assert.deepEqual(partial.json.settings.model, { provider: 'deepseek', model: 'deepseek-chat' })

  const badUrl = await callRoute(routes, '/settings', {
    method: 'POST',
    body: { settings: { localBaseUrl: '127.0.0.1:11434' } },
  })
  assert.equal(badUrl.json.ok, false)
  assert.equal(badUrl.json.code, 'BAD_URL')

  for (let i = 0; i < 60; i += 1) runtime.cache.set(`k${i}`, { translation: `t${i}` })
  assert.equal(runtime.cache.size, 60)

  const shrink = await callRoute(routes, '/settings', {
    method: 'POST',
    body: { settings: { cacheLimit: 50 } },
  })
  assert.equal(shrink.json.ok, true)
  assert.equal(shrink.json.cacheSize, 50)
})

test('POST /explain handles structured output, cut-off JSON, and missing term', async (t) => {
  let reply = JSON.stringify({
    meaning: '在这里指幂等的',
    usage: '常用于接口设计',
    collocations: ['idempotent request'],
    example: 'Retries are safe when requests are idempotent.',
  })
  const { routes } = createRuntime(t, { answer: () => reply })

  const empty = await callRoute(routes, '/explain', { method: 'POST', body: { term: '  ' } })
  assert.equal(empty.json.code, 'EMPTY')

  const ok = await callRoute(routes, '/explain', { method: 'POST', body: { term: 'idempotent' } })
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.meaning, '在这里指幂等的')
  assert.deepEqual(ok.json.collocations, ['idempotent request'])

  reply = '{"meaning":"半截'
  const cut = await callRoute(routes, '/explain', { method: 'POST', body: { term: 'idempotent' } })
  assert.equal(cut.json.ok, false)
  assert.equal(cut.json.code, 'EMPTY_ANSWER')
})

test('POST /toenglish validates Chinese input, cut-off JSON, and returns structured rewrite', async (t) => {
  let reply = JSON.stringify({
    english: 'Please fix the failing test first.',
    notes: [{ original: '先修测试', suggestion: 'fix the failing test first', reason: '更自然' }],
  })
  const { routes } = createRuntime(t, { answer: () => reply })

  const notZh = await callRoute(routes, '/toenglish', { method: 'POST', body: { text: 'already english' } })
  assert.equal(notZh.json.code, 'NOT_CHINESE')

  const tooLong = await callRoute(routes, '/toenglish', { method: 'POST', body: { text: '中'.repeat(8001) } })
  assert.equal(tooLong.json.code, 'TOO_LONG')

  const ok = await callRoute(routes, '/toenglish', { method: 'POST', body: { text: '请先修这个失败的测试' } })
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.english, 'Please fix the failing test first.')
  assert.equal(ok.json.notes.length, 1)

  reply = '{"english":"Please fix'
  const cut = await callRoute(routes, '/toenglish', { method: 'POST', body: { text: '请先修这个失败的测试' } })
  assert.equal(cut.json.ok, false)
  assert.equal(cut.json.code, 'EMPTY_ANSWER')
})

test('GET|POST /vocab serializes concurrent adds and supports remove and clear', async (t) => {
  const dir = await tempDir(t)
  const { routes } = createRuntime(t, { dir })

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      callRoute(routes, '/vocab', {
        method: 'POST',
        body: { action: 'add', entry: { term: `term-${i}`, pos: 'n.', gloss: `释义 ${i}` } },
      }),
    ),
  )

  const list = await callRoute(routes, '/vocab')
  assert.equal(list.json.entries.length, 10)

  const removed = await callRoute(routes, '/vocab', {
    method: 'POST',
    body: { action: 'remove', id: 'term-0' },
  })
  assert.equal(removed.json.entries.length, 9)

  const bad = await callRoute(routes, '/vocab', { method: 'POST', body: { action: 'nope' } })
  assert.equal(bad.status, 400)
  assert.equal(bad.json.code, 'BAD_ACTION')

  const cleared = await callRoute(routes, '/vocab', { method: 'POST', body: { action: 'clear' } })
  assert.deepEqual(cleared.json.entries, [])
})

test('POST /cache/clear, POST /local/test without model, and listLocalModels timeout', async (t) => {
  const dir = await tempDir(t)
  const { runtime, routes } = createRuntime(t, { dir })
  await runtime.ready
  runtime.cache.set('k', { translation: 'v' })
  await runtime.cache.flush()

  const cleared = await callRoute(routes, '/cache/clear', { method: 'POST', body: {} })
  assert.equal(cleared.json.ok, true)
  assert.equal(cleared.json.cacheSize, 0)

  const noLocal = await callRoute(routes, '/local/test', { method: 'POST', body: {} })
  assert.equal(noLocal.json.ok, false)
  assert.equal(noLocal.json.code, 'NO_MODEL')

  const sockets = new Set()
  const server = http.createServer((_req, _res) => {})
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  const { port } = server.address()
  await assert.rejects(() => listLocalModels(`http://127.0.0.1:${port}`, AbortSignal.timeout(40)))
})

test('safeMessage redacts Bearer tokens and key=secret values', () => {
  assert.equal(safeMessage(new Error('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')), 'Authorization: Bearer [redacted]')
  assert.equal(safeMessage(new Error('failed with api_key=my_secret_value_1234')), 'failed with api_key=[redacted]')
  assert.equal(safeMessage(new Error('token: abcdef123456 failed')), 'token=[redacted] failed')
  assert.equal(safeMessage(new Error('sk-1234567890abcdef')), '[redacted]')
})
