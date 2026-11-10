/**
 * /dictionary is driven through the real handlers registered by
 * registerTranslateRoutes, with a fake ctx providing WebServer and connection.
 * The dictionary itself is a real instance over a small synthetic payload, so
 * the route test also covers the payload wiring end to end.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { Dictionary } from '../lib/dictionary.js'
import { API_PREFIX, registerTranslateRoutes } from '../lib/routes.js'

const FIXTURE = {
  v: 1,
  built: '2026-01-02',
  sources: [{ name: 'ECDICT', license: 'MIT', url: 'https://example.test/ecdict' }],
  words: [
    ['invoke', '/ɪnˈvoʊk/', '/ɪnˈvəʊk/', 'vt. 调用'],
    ['run', '/rən/', '/rʌn/', 'vi. 跑'],
    ['state', '/ˈsteɪt/', '/ˈsteɪt/', 'n. 州, 状态'],
  ],
  forms: { invoked: 'invoke', ran: 'run' },
}

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-translate-routes-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function loadedDictionary(t) {
  const dir = await tempDir(t)
  const filePath = path.join(dir, 'dictionary.json.gz')
  await writeFile(filePath, gzipSync(Buffer.from(JSON.stringify(FIXTURE), 'utf8')))
  const dictionary = new Dictionary({ filePath })
  await dictionary.load()
  return dictionary
}

/** The plugin settings a fresh profile would start with. */
function createRuntime(dictionary, overrides = {}) {
  const settings = {
    enabled: true,
    targetLanguage: 'zh-CN',
    autoTranslate: false,
    showTerms: true,
    showContext: true,
    showDock: true,
    showDict: true,
    accent: 'us',
    maxChars: 8000,
    cacheLimit: 2000,
    model: null,
    engine: 'cloud',
    localBaseUrl: 'http://127.0.0.1:11434',
    localModel: '',
    ...overrides,
  }
  return {
    config: settings,
    logger: { debug() {}, info() {}, warn() {} },
    services: {},
    diagPath: undefined,
    diagnostic: null,
    settings: {
      persist: false,
      snapshot: () => settings,
      async update(patch) {
        Object.assign(settings, patch)
        return settings
      },
    },
    vocab: { snapshot: () => ({ entries: [] }) },
    cache: { size: 0, limit: 2000, clear() {}, async flush() {} },
    dictionary,
    ready: Promise.resolve(),
  }
}

function createHarness(runtime) {
  const routes = new Map()
  const ctx = {
    inject(services, callback) {
      assert.deepEqual(services, ['webServer', 'connection'])
      const child = {
        get(name) {
          // `undefined` is the only answer that admits a request.
          if (name === 'connection') return { requestRejection: () => undefined }
          return undefined
        },
        webServer: {
          register(route) {
            routes.set(route.path, route)
            return () => {}
          },
        },
        effect(factory, label) {
          assert.equal(typeof label, 'string')
          return factory()
        },
      }
      const disposer = callback(child)
      return disposer
    },
  }
  registerTranslateRoutes(ctx, () => runtime)
  return routes
}

function createRequest({ method = 'GET', url = '/', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value)
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
    },
  }
}

async function call(routes, suffix, options = {}) {
  const route = routes.get(`${API_PREFIX}${suffix}`)
  assert.ok(route, `${suffix} is registered`)
  assert.equal(route.kind, 'exact')
  const response = createResponse()
  const request = createRequest({ method: options.method ?? 'GET', url: options.url ?? `${API_PREFIX}${suffix}`, body: options.body })
  await route.handler(request, response)
  return {
    status: response.statusCode,
    headers: response.headers,
    raw: response.body,
    json: response.body ? JSON.parse(response.body) : undefined,
  }
}

test('the dictionary route sits beside the existing routes', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  for (const suffix of ['/dictionary', '/state', '/settings', '/vocab']) {
    assert.ok(routes.has(`${API_PREFIX}${suffix}`), `${suffix} should stay registered`)
  }
})

test('GET /dictionary answers one word with dictionary metadata', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const result = await call(routes, '/dictionary', { url: `${API_PREFIX}/dictionary?word=state` })
  assert.equal(result.status, 200)
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.deepEqual(result.json, {
    ok: true,
    available: true,
    built: '2026-01-02',
    count: 3,
    entries: [
      {
        query: 'state',
        found: true,
        word: 'state',
        ipa: '/ˈsteɪt/',
        ipaUk: '/ˈsteɪt/',
        translation: 'n. 州, 状态',
        matched: 'exact',
      },
    ],
  })
  assert.deepEqual(Object.keys(result.json.entries[0]), ['query', 'found', 'word', 'ipa', 'ipaUk', 'translation', 'matched'])
})

test('GET /dictionary accepts ?w= and folds the input', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const result = await call(routes, '/dictionary', { url: `${API_PREFIX}/dictionary?w=Invoked` })
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.entries, [
    {
      query: 'Invoked',
      found: true,
      word: 'invoke',
      ipa: '/ɪnˈvoʊk/',
      ipaUk: '/ɪnˈvəʊk/',
      translation: 'vt. 调用',
      matched: 'form',
    },
  ])
})

test('GET /dictionary rejects a missing word', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  for (const url of [`${API_PREFIX}/dictionary`, `${API_PREFIX}/dictionary?word=`, `${API_PREFIX}/dictionary?word=%20%20`]) {
    const result = await call(routes, '/dictionary', { url })
    assert.equal(result.status, 400, url)
    assert.equal(result.json.ok, false)
    assert.equal(result.json.code, 'BAD_REQUEST')
    assert.equal(typeof result.json.message, 'string')
  }
})

test('GET /dictionary reports an unknown word without failing', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const result = await call(routes, '/dictionary', { url: `${API_PREFIX}/dictionary?word=qwerty` })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.available, true)
  assert.deepEqual(result.json.entries, [{ query: 'qwerty', found: false }])
})

test('POST /dictionary answers a batch in order and drops duplicates', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const result = await call(routes, '/dictionary', {
    method: 'POST',
    body: { words: ['state', 'STATE', 'state.', 'qwerty', 'ran'] },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.count, 3)
  assert.deepEqual(
    result.json.entries.map((entry) => [entry.query, entry.found, entry.word ?? null, entry.matched ?? null]),
    [
      ['state', true, 'state', 'exact'],
      ['qwerty', false, null, null],
      ['ran', true, 'run', 'form'],
    ],
  )
})

test('POST /dictionary rejects a bad body and ignores non-strings', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  for (const body of [{}, { words: 'state' }, { words: 42 }, null, { words: null }]) {
    const result = await call(routes, '/dictionary', { method: 'POST', body })
    assert.equal(result.status, 400, JSON.stringify(body))
    assert.equal(result.json.code, 'BAD_REQUEST')
  }
  const noBody = await call(routes, '/dictionary', { method: 'POST' })
  assert.equal(noBody.status, 400)
  assert.equal(noBody.json.code, 'BAD_REQUEST')

  const oversize = await call(routes, '/dictionary', { method: 'POST', body: { words: new Array(25).fill('state') } })
  assert.equal(oversize.status, 400)
  assert.equal(oversize.json.code, 'BAD_REQUEST')

  // 24 distinct words is the ceiling, and every one of them gets a row.
  const atLimit = await call(routes, '/dictionary', {
    method: 'POST',
    body: { words: Array.from({ length: 24 }, (_, index) => `word${index}`) },
  })
  assert.equal(atLimit.status, 200)
  assert.equal(atLimit.json.entries.length, 24)

  const mixed = await call(routes, '/dictionary', { method: 'POST', body: { words: ['state', 42, null, { x: 1 }, 'ran'] } })
  assert.equal(mixed.status, 200)
  assert.deepEqual(mixed.json.entries.map((entry) => entry.query), ['state', 'ran'])
})

test('other methods are not allowed on /dictionary', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const result = await call(routes, '/dictionary', { method: 'PUT' })
  assert.equal(result.status, 405)
  assert.equal(result.headers.allow, 'GET, POST')
  assert.equal(result.raw, '')
})

test('an unavailable dictionary still answers every row', async (t) => {
  const dir = await tempDir(t)
  const dictionary = new Dictionary({ filePath: path.join(dir, 'missing.json.gz'), logger: { warn() {} } })
  const routes = createHarness(createRuntime(dictionary))

  const single = await call(routes, '/dictionary', { url: `${API_PREFIX}/dictionary?word=state` })
  assert.equal(single.status, 200)
  assert.deepEqual(single.json, {
    ok: true,
    available: false,
    built: null,
    count: 0,
    entries: [{ query: 'state', found: false }],
  })

  const batch = await call(routes, '/dictionary', { method: 'POST', body: { words: ['state', 'ran'] } })
  assert.equal(batch.status, 200)
  assert.deepEqual(batch.json.entries, [{ query: 'state', found: false }, { query: 'ran', found: false }])

  const state = await call(routes, '/state')
  assert.deepEqual(state.json.dict, { available: false, count: 0, forms: 0, built: null })
})

test('GET /state summarises the dictionary', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const result = await call(routes, '/state')
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.dict, { available: true, count: 3, forms: 2, built: '2026-01-02' })
  assert.equal(result.json.settings.showDict, true)
  assert.equal(result.json.settings.accent, 'us')
})

test('POST /settings accepts showDict and accent, and ignores junk', async (t) => {
  const routes = createHarness(createRuntime(await loadedDictionary(t)))
  const accepted = await call(routes, '/settings', { method: 'POST', body: { settings: { showDict: false, accent: 'UK' } } })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.json.settings.showDict, false)
  assert.equal(accepted.json.settings.accent, 'uk')

  const ignored = await call(routes, '/settings', { method: 'POST', body: { showDict: 'yes', accent: 'de' } })
  assert.equal(ignored.status, 200)
  assert.equal(ignored.json.settings.showDict, false)
  assert.equal(ignored.json.settings.accent, 'uk')
})
