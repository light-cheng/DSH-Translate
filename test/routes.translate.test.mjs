/**
 * /translate is driven through the real handler registered by
 * registerTranslateRoutes, with a fake Harness model that answers
 * deterministically.
 *
 * Every fake answer carries a fingerprint of the chunk text the model was
 * handed, so a test can prove which chunk each call saw and that a response
 * covers every planned chunk — no network, no real model, no timers to wait on.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { TranslationCache, cacheKey } from '../lib/cache.js'
import { planChunks } from '../lib/parse.js'
import { API_PREFIX, registerTranslateRoutes } from '../lib/routes.js'

const CONTEXT_MARK = 'SURROUNDING-CONTEXT-MARKER-7f3a'
const CONTEXT_NOTE = '这是模型给的上下文说明。'
const MODEL_NAME = 'fake/fake-model'

/** A 12k reasoning chain built from unique paragraphs, so offsets are testable. */
function makeLongText(chars = 12000) {
  const paragraphs = []
  let length = 0
  for (let index = 0; length < chars; index += 1) {
    const paragraph = `Paragraph ${index}: the runner keeps retrying the request until the queue drains, and step ${index} records its own state.`
    paragraphs.push(paragraph)
    length += paragraph.length + 2
  }
  return paragraphs.join('\n\n').slice(0, chars)
}

/** What the fake model echoes for one chunk: deterministic and chunk-specific. */
function fingerprint(text) {
  return `⟦zh:${text.length}:${text.slice(0, 16)}:${text.slice(-16)}⟧`
}

function structuredAnswer(chunk) {
  return JSON.stringify({
    translation: fingerprint(chunk),
    context: CONTEXT_NOTE,
    terms: [{ term: 'retry', pos: 'v.', gloss: '重试', example: 'the runner keeps retrying the request' }],
  })
}

/** The user prompt one Harness model request carries. */
function promptOf(request) {
  const content = request?.messages?.[0]?.content
  if (Array.isArray(content)) return content.map((part) => String(part?.text ?? '')).join('')
  return ''
}

/** Which planned chunk a prompt carries; -1 when none (e.g. a legacy cache hit). */
function matchingChunk(prompt, chunks) {
  let matched = -1
  let longest = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkText = chunks[index]?.text
    if (chunkText && chunkText.length > longest && prompt.includes(chunkText)) {
      matched = index
      longest = chunkText.length
    }
  }
  return matched
}

function defaultSettings(overrides = {}) {
  return {
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
}

/**
 * A runtime shaped like the one index.js builds, except the model is fake.
 *
 * `chunks` is the plan the test expects the route to use — planChunks(text) —
 * so the fake can name the chunk it was given and the route can be checked
 * against the same offsets.
 */
function createRuntime({ chunks = [], failFor = () => false, answer = structuredAnswer, settings = {} } = {}) {
  const config = defaultSettings(settings)
  const calls = []

  // Async generator: the body runs on the first `for await`, so a failing
  // model call rejects inside the route's try/catch exactly like a real one.
  const stream = async function* stream(request) {
    const prompt = promptOf(request)
    const matched = matchingChunk(prompt, chunks)
    calls.push({ matched, prompt, system: String(request?.system ?? '') })
    const failure = failFor(matched)
    if (failure) throw failure instanceof Error ? failure : new Error('fake model failure')
    yield { type: 'text-delta', text: answer(matched >= 0 ? chunks[matched].text : prompt) }
  }

  return {
    calls,
    runtime: {
      config,
      logger: { debug() {}, info() {}, warn() {} },
      services: {
        llm: { stream },
        agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) },
      },
      diagPath: undefined,
      diagnostic: null,
      settings: {
        persist: false,
        snapshot: () => config,
        async update(patch) {
          Object.assign(config, patch)
          return config
        },
      },
      vocab: { snapshot: () => ({ entries: [] }) },
      cache: new TranslationCache({ limit: config.cacheLimit }),
      dictionary: undefined,
      ready: Promise.resolve(),
    },
  }
}

/** Register the real routes on a fake ctx that only provides webServer+connection. */
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
      return callback(child)
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

function postTranslate(routes, body) {
  return call(routes, '/translate', { method: 'POST', body })
}

test('an incremental run translates every planned part and ends with next: null', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  assert.ok(chunks.length > 3, 'a 12k reasoning chain must plan more than three parts')

  const { runtime, calls } = createRuntime({ chunks })
  const routes = createHarness(runtime)

  const translations = []
  let index = 0
  for (let guard = 0; index !== null; guard += 1) {
    assert.ok(guard <= chunks.length + 1, '`next` must advance or terminate, never loop')
    const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index })
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true, `part ${index} should succeed: ${result.raw}`)
    assert.deepEqual(result.json.part, {
      index,
      count: chunks.length,
      start: chunks[index].start,
      end: chunks[index].end,
    })
    assert.equal(result.json.cached, false)
    assert.equal(result.json.next, index + 1 < chunks.length ? index + 1 : null)
    assert.ok(
      result.json.translation.includes(fingerprint(chunks[index].text)),
      `part ${index} translation must be the answer for that chunk`,
    )
    if (index > 0) assert.ok(!result.json.translation.includes(fingerprint(chunks[0].text)), 'a part must not repeat the first chunk')
    translations.push(result.json.translation)
    index = result.json.next
  }

  assert.equal(translations.length, chunks.length, 'the loop covers every part')
  assert.deepEqual(calls.map((entry) => entry.matched), chunks.map((_, chunkIndex) => chunkIndex), 'each chunk reaches the model once, in order')

  const joined = translations.join('\n\n')
  for (const chunk of chunks) assert.ok(joined.includes(fingerprint(chunk.text)), 'joined translations cover every chunk')
  const positions = chunks.map((chunk) => joined.indexOf(fingerprint(chunk.text)))
  for (let offset = 1; offset < positions.length; offset += 1) {
    assert.ok(positions[offset] > positions[offset - 1], 'translations keep the source order')
  }
})

test('only the first part prompt carries the surrounding context', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime, calls } = createRuntime({ chunks })
  const routes = createHarness(runtime)

  const head = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 0 })
  assert.equal(head.json.ok, true)
  assert.equal(head.json.contextNote, CONTEXT_NOTE)
  assert.ok(Array.isArray(head.json.terms))
  assert.equal(head.json.terms.length, 1)

  const body = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 1 })
  assert.equal(body.json.ok, true)

  assert.equal(calls.length, 2)
  assert.ok(calls[0].prompt.includes(CONTEXT_MARK), 'the first part keeps the translation prompt context')
  assert.ok(calls[0].prompt.includes('"terms"'), 'the first part keeps the vocabulary instruction')
  assert.match(calls[0].prompt, new RegExp(`1\\s*\\/\\s*${chunks.length}`), 'the first part says it is part 1 of N')
  assert.ok(!calls[1].prompt.includes(CONTEXT_MARK), 'later parts must not resend the surrounding context')
  assert.ok(!calls[1].prompt.includes('"terms"'), 'later parts must not ask for vocabulary')
  assert.ok(calls[1].prompt.includes(chunks[1].text), 'later parts carry their own chunk text')
})

test('a repeated part is served from the per-part cache', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime, calls } = createRuntime({ chunks })
  const routes = createHarness(runtime)
  const body = { text, context: CONTEXT_MARK, mode: 'reasoning', index: 1 }

  const first = await postTranslate(routes, body)
  assert.equal(first.json.ok, true)
  assert.equal(first.json.cached, false)
  assert.equal(calls.length, 1)

  const second = await postTranslate(routes, body)
  assert.equal(second.json.ok, true)
  assert.equal(second.json.cached, true)
  assert.equal(calls.length, 1, 'a cache hit must not call the model again')
  assert.equal(second.json.translation, first.json.translation)
  assert.deepEqual(second.json.part, first.json.part, 'a cached part replies with the same part/next fields')
  assert.equal(second.json.next, 2)
})

test('a failing part reports its own index and leaves other parts usable', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime, calls } = createRuntime({ chunks, failFor: (matched) => (matched === 1 ? new Error('boom') : null) })
  const routes = createHarness(runtime)

  const head = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 0 })
  assert.equal(head.json.ok, true)

  const failed = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 1 })
  assert.equal(failed.json.ok, false)
  assert.equal(failed.json.code, 'MODEL_ERROR')
  assert.equal(typeof failed.json.message, 'string')
  assert.equal(failed.json.next, 1, 'the failure points back at the failed part so the client can resume')
  assert.deepEqual(failed.json.part, { index: 1, count: chunks.length, start: chunks[1].start, end: chunks[1].end })
  assert.ok(!failed.json.translation, 'a failed part never returns a translation')

  // A failure is not cached: retrying the same part calls the model again.
  const retried = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 1 })
  assert.equal(retried.json.ok, false)
  assert.equal(calls.filter((entry) => entry.matched === 1).length, 2)

  // The part after the failure still works, and the head is still cached.
  const after = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 2 })
  assert.equal(after.json.ok, true)
  assert.equal(after.json.part.index, 2)
  const headAgain = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 0 })
  assert.equal(headAgain.json.ok, true)
  assert.equal(headAgain.json.cached, true, 'one failed part must not discard the parts already translated')
})

test('a cut-off structured answer becomes EMPTY_ANSWER instead of half JSON', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  for (const cut of ['{"translation":"半截译文', '[{"translation":"半截译文']) {
    const { runtime } = createRuntime({ chunks, answer: () => cut })
    const routes = createHarness(runtime)
    const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 0 })
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, false, `${cut} must be treated as a failure`)
    assert.equal(result.json.code, 'EMPTY_ANSWER')
    assert.equal(result.json.part.index, 0)
    assert.equal(result.json.next, 0)
    assert.ok(!result.json.translation, 'half JSON must never be surfaced as a translation')
    assert.ok(!result.raw.includes('半截译文'), 'the cut JSON fragment must not appear anywhere in the response')
  }
})

test('a plain-text answer that is not JSON is still accepted', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime } = createRuntime({ chunks, answer: () => '这是纯文本译文，没有 JSON。' })
  const routes = createHarness(runtime)

  const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning', index: 0 })
  assert.equal(result.json.ok, true, 'a model that ignores the JSON shape is a normal case, not a failure')
  assert.equal(result.json.translation, '这是纯文本译文，没有 JSON。')
})

test('an out-of-range part index is refused without a model call', async () => {
  const text = 'The runner keeps retrying the request until the queue drains.'
  const chunks = planChunks(text)
  assert.equal(chunks.length, 1)
  const { runtime, calls } = createRuntime({ chunks })
  const routes = createHarness(runtime)

  for (const index of [1, 6, 999]) {
    const result = await postTranslate(routes, { text, context: '', mode: 'reasoning', index })
    assert.equal(result.json.ok, false)
    assert.equal(result.json.code, 'BAD_INDEX')
    assert.match(result.json.message, /分块序号/)
  }
  assert.equal(calls.length, 0)
})

test('a legacy request translates every chunk and is never truncated', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime, calls } = createRuntime({ chunks })
  const routes = createHarness(runtime)

  const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning' })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true, result.raw)
  assert.equal(result.json.truncated, false, 'no silent truncation any more')
  assert.equal(result.json.partial, false)
  assert.equal(result.json.cached, false)
  assert.equal(result.json.part.index, 0)
  assert.equal(result.json.part.count, chunks.length)
  assert.equal(result.json.next, null)
  assert.equal(result.json.contextNote, CONTEXT_NOTE)
  assert.ok(Array.isArray(result.json.terms))
  assert.ok(result.json.terms.length >= 1)

  assert.equal(calls.length, chunks.length, 'every chunk is translated; no maxChunks cap')
  assert.deepEqual(calls.map((entry) => entry.matched), chunks.map((_, chunkIndex) => chunkIndex))
  const positions = chunks.map((chunk) => result.json.translation.indexOf(fingerprint(chunk.text)))
  for (let offset = 0; offset < positions.length; offset += 1) {
    assert.ok(positions[offset] >= 0, `chunk ${offset} must appear in the legacy translation`)
    if (offset > 0) assert.ok(positions[offset] > positions[offset - 1], 'legacy translations keep the source order')
  }
})

test('settings.maxChars no longer slices the translation input', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  // The old route cut the text to this many characters before splitting.
  const { runtime, calls } = createRuntime({ chunks, settings: { maxChars: 500 } })
  const routes = createHarness(runtime)

  const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning' })
  assert.equal(result.json.ok, true, result.raw)
  assert.equal(result.json.truncated, false)
  assert.equal(result.json.part.count, chunks.length)
  assert.equal(calls.length, chunks.length, 'maxChars must not cap the number of translated chunks')
  for (const chunk of chunks) assert.ok(result.json.translation.includes(fingerprint(chunk.text)))
})

test('a legacy request keeps successful parts and reports the failed ones', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime, calls } = createRuntime({ chunks, failFor: (matched) => (matched === 1 ? new Error('boom') : null) })
  const routes = createHarness(runtime)

  const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning' })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true, 'one failed chunk must not fail the whole request')
  assert.equal(result.json.partial, true)
  assert.deepEqual(result.json.failed, [1])
  assert.equal(result.json.next, null)
  assert.equal(result.json.truncated, false)
  assert.equal(calls.length, chunks.length, 'every chunk is attempted, so the client is told exactly which failed')
  assert.ok(!result.json.translation.includes(fingerprint(chunks[1].text)), 'the failed chunk contributes no translation')
  for (let index = 0; index < chunks.length; index += 1) {
    if (index === 1) continue
    assert.ok(result.json.translation.includes(fingerprint(chunks[index].text)), `chunk ${index} translation is retained`)
  }
})

test('a legacy request fails only when no part produced a translation', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime } = createRuntime({ chunks, failFor: () => new Error('boom') })
  const routes = createHarness(runtime)

  const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning' })
  assert.equal(result.json.ok, false)
  assert.equal(result.json.code, 'MODEL_ERROR')
  assert.equal(typeof result.json.message, 'string')
})

test('legacy cache entries written with the pre-chunk key are still reused', async () => {
  const text = makeLongText(12000)
  const chunks = planChunks(text)
  const { runtime, calls } = createRuntime({ chunks })
  const routes = createHarness(runtime)

  // Exactly the key the pre-chunk route used: `${engine}|${routeId}` with no part.
  const legacyKey = cacheKey({ mode: 'reasoning', targetLanguage: 'zh-CN', model: `cloud|cloud:${MODEL_NAME}`, text })
  runtime.cache.set(legacyKey, { translation: '旧版整段译文', contextNote: '', terms: [] })

  const result = await postTranslate(routes, { text, context: CONTEXT_MARK, mode: 'reasoning' })
  assert.equal(result.json.ok, true, result.raw)
  assert.equal(result.json.cached, true)
  assert.equal(result.json.translation, '旧版整段译文')
  assert.equal(calls.length, 0, 'a legacy cache hit must not spend a model call')
})

test('text over the hard limit is refused before any model call', async () => {
  const { runtime, calls } = createRuntime({ chunks: [] })
  const routes = createHarness(runtime)

  const over = await postTranslate(routes, { text: 'a'.repeat(60001), context: '', mode: 'reasoning' })
  assert.equal(over.json.ok, false)
  assert.equal(over.json.code, 'TOO_LONG')
  assert.match(over.json.message, /文本过长/)
  assert.equal(calls.length, 0)

  // 60000 characters is still allowed; the limit is only the hard ceiling.
  const text = 'a'.repeat(60000)
  const chunks = planChunks(text)
  const atLimitRuntime = createRuntime({ chunks })
  const atLimitRoutes = createHarness(atLimitRuntime.runtime)
  const atLimit = await postTranslate(atLimitRoutes, { text, context: '', mode: 'reasoning', index: 0 })
  assert.equal(atLimit.json.ok, true, atLimit.raw)
  assert.equal(atLimit.json.part.count, chunks.length)
})

test('text that needs no translation is skipped and still reports a part', async () => {
  const text = '这是一段中文说明，里面有一个 identifier。'
  const { runtime, calls } = createRuntime({ chunks: [] })
  const routes = createHarness(runtime)

  const result = await postTranslate(routes, { text, context: '', mode: 'reasoning', index: 0 })
  assert.equal(result.json.ok, true)
  assert.equal(result.json.skipped, true)
  assert.equal(result.json.translation, '')
  assert.equal(result.json.next, null)
  assert.equal(result.json.part.index, 0)
  assert.equal(result.json.part.count, 1)
  assert.equal(calls.length, 0)
})
