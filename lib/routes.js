/**
 * Same-origin HTTP routes used by the browser half.
 *
 * The Web client cannot call the plugin's Host code directly, so every action
 * is one small JSON endpoint behind the DSH connection trust fence. Responses
 * never contain the configured model response for failures, and never contain
 * credentials.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { cacheKey } from './cache.js'
import { MAX_LOOKUP_WORDS, normalizeQuery } from './dictionary.js'
import { listLocalModels, chatLocal, normalizeBaseUrl } from './local.js'
import { generate, llmAvailable, localConfigured, pickSelection } from './model.js'
import { needsTranslation, normalizeTerms, parseExplain, parseToEnglish, parseTranslation, planChunks, stripFences } from './parse.js'
import { explainPrompt, toEnglishPrompt, translationBodyPrompt, translationPrompt } from './prompt.js'

export const API_PREFIX = '/dsh-translate/api'

const MAX_REQUEST_BYTES = 256 * 1024
const MAX_TEXT_CHARS = 60000
const MAX_POLISH_CHARS = 8000
const MAX_VOCAB = 1000
const MODEL_TIMEOUT_MS = 60000
const LOCAL_TIMEOUT_MS = 180000
const ENGINES = ['cloud', 'local', 'auto']
const TARGET_LANGUAGES = ['zh-CN', 'zh-TW']
const ACCENTS = ['us', 'uk']

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function methodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error('请求体过大'), { code: 'TOO_LARGE' })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' })
  }
}

/** True when the text carries Chinese characters worth rewriting in English. */
function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? ''))
}

function safeMessage(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  // Provider errors can echo request content; keep the message short and free
  // of anything that looks like a key.
  return raw.replace(/(sk|key|token)[-_A-Za-z0-9]{8,}/gi, '[redacted]').slice(0, 300) || '未知错误'
}

export function sanitizeSettings(input, base) {
  const next = { ...base }
  if (!input || typeof input !== 'object') return next
  for (const field of ['enabled', 'autoTranslate', 'showTerms', 'showContext', 'showDict']) {
    if (typeof input[field] === 'boolean') next[field] = input[field]
  }
  if (typeof input.engine === 'string' && ENGINES.includes(input.engine)) next.engine = input.engine
  if (typeof input.accent === 'string') {
    const accent = input.accent.trim().toLowerCase()
    if (ACCENTS.includes(accent)) next.accent = accent
  }
  if (typeof input.localBaseUrl === 'string') {
    const url = input.localBaseUrl.trim().slice(0, 200)
    if (!url) next.localBaseUrl = 'http://127.0.0.1:11434'
    else if (/^https?:\/\//i.test(url)) next.localBaseUrl = normalizeBaseUrl(url)
  }
  if (typeof input.localModel === 'string') next.localModel = input.localModel.trim().slice(0, 120)
  if (typeof input.targetLanguage === 'string') {
    const language = input.targetLanguage.trim()
    if (TARGET_LANGUAGES.includes(language)) next.targetLanguage = language
  }
  if (Number.isFinite(input.maxChars)) next.maxChars = Math.min(30000, Math.max(500, Math.round(input.maxChars)))
  if (Number.isFinite(input.cacheLimit)) next.cacheLimit = Math.min(10000, Math.max(50, Math.round(input.cacheLimit)))
  if (input.model === null || input.model === undefined) next.model = null
  else if (typeof input.model === 'object') {
    const provider = String(input.model.provider ?? '').trim().slice(0, 80)
    const model = String(input.model.model ?? '').trim().slice(0, 120)
    next.model = provider && model ? { provider, model } : null
  }
  return next
}

function readVocab(runtime) {
  const data = runtime.vocab.snapshot()
  return Array.isArray(data?.entries) ? data.entries : []
}

function vocabId(term) {
  return String(term ?? '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 120)
}

function sanitizeVocabEntry(input) {
  if (!input || typeof input !== 'object') return null
  const term = String(input.term ?? '').trim().slice(0, 120)
  if (!term) return null
  return {
    id: vocabId(term),
    term,
    pos: String(input.pos ?? '').trim().slice(0, 24),
    gloss: String(input.gloss ?? '').trim().slice(0, 300),
    example: String(input.example ?? '').trim().slice(0, 500),
    source: input.source === 'selection' ? 'selection' : 'reasoning',
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  }
}

/** What the settings page shows about the bundled dictionary. */
function dictionaryState(runtime) {
  const stats = runtime.dictionary?.stats ?? null
  if (!stats) return { available: false, count: 0, forms: 0, built: null }
  return { available: true, count: stats.words, forms: stats.forms, built: stats.built ?? null }
}

function statePayload(runtime) {
  const settings = runtime.settings.snapshot()
  const selection = pickSelection(runtime.services, settings)
  return {
    ok: true,
    enabled: settings.enabled !== false,
    settings,
    llmAvailable: llmAvailable(runtime.services),
    model: selection,
    engine: settings.engine ?? 'cloud',
    localModel: String(settings.localModel ?? ''),
    localBaseUrl: normalizeBaseUrl(settings.localBaseUrl),
    localReady: localConfigured(settings),
    cacheSize: runtime.cache.size,
    vocabCount: readVocab(runtime).length,
    dict: dictionaryState(runtime),
    maxChars: settings.maxChars,
    persist: Boolean(runtime.settings.persist),
    targetLanguages: TARGET_LANGUAGES,
  }
}

/**
 * Drop repeats of the same normalized word and anything that is not a string.
 * The first spelling wins, in first-seen order, so the browser half can pair
 * rows back to its tokens without a second pass.
 */
function dedupeWords(texts) {
  const seen = new Set()
  const out = []
  for (const text of texts) {
    if (typeof text !== 'string') continue
    const key = normalizeQuery(text) || text.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= MAX_LOOKUP_WORDS) break
  }
  return out
}

/** One response shape for both methods: dictionary metadata plus one row each. */
function dictionaryPayload(dictionary, texts) {
  const stats = dictionary.stats
  return {
    ok: true,
    available: Boolean(stats),
    built: stats?.built ?? null,
    count: stats?.words ?? 0,
    entries: dictionary.lookupMany(dedupeWords(texts)),
  }
}

/**
 * The payload is parsed on the plugin's startup path, but a request can arrive
 * first. Waiting here is cheap (the parse is memoized) and makes /state honest;
 * an unreadable file stays `available: false` rather than turning into a 500.
 */
async function preloadDictionary(runtime) {
  try {
    await runtime.dictionary?.load?.()
  } catch {
    // load() reports failures itself; the routes must always answer.
  }
}

function noModelResponse() {
  return {
    ok: false,
    code: 'NO_MODEL',
    message: '没有可用的模型：请在插件设置里选云端模型，或配置本地 Ollama 模型。',
  }
}

/** True when at least one route could answer right now. */
function hasRoute(runtime, settings) {
  if (localConfigured(settings)) return true
  return llmAvailable(runtime.services) && Boolean(pickSelection(runtime.services, settings))
}

/** Seconds a local model may take; longer prompts get a longer budget. */
function requestBudget(settings) {
  return localConfigured(settings) && settings.engine !== 'auto' ? LOCAL_TIMEOUT_MS : MODEL_TIMEOUT_MS
}

const TIMEOUT_MESSAGE = '模型响应超时，请重试（本地小模型处理长文本会慢，可先选短一些的段落）。'
const EMPTY_ANSWER_MESSAGE = '模型没有返回可用的译文，请重试。'

/**
 * Run one model call with its own AbortController and its own timer.
 *
 * A long translation is a sequence of these calls. Each one must own its
 * cancellation: sharing one controller used to abort the whole request when a
 * later chunk was slow, throwing away chunks that were already translated.
 *
 * @returns {Promise<{ok: true, result: object} | {ok: false, code: string, message: string}>}
 */
async function runTranslationCall(runtime, settings, system, user) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), requestBudget(settings))
  try {
    const result = await generate({ services: runtime.services, settings, system, user, signal: controller.signal })
    if (!result) return { ok: false, code: 'NO_MODEL', message: noModelResponse().message }
    return { ok: true, result }
  } catch (error) {
    const cancelled = controller.signal.aborted
    return {
      ok: false,
      code: cancelled ? 'TIMEOUT' : 'MODEL_ERROR',
      message: cancelled ? TIMEOUT_MESSAGE : `模型调用失败：${safeMessage(error)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * True when a non-structured answer still opens like JSON. That shape means the
 * model was cut off by its output limit, so the text is half an object and must
 * not be rendered as a translation.
 */
function looksLikeCutJson(rawAnswer) {
  const raw = String(rawAnswer ?? '').trim()
  const body = stripFences(raw).trim()
  // stripFences needs a closing marker; a cut answer may still open with one.
  const head = body.startsWith('```') ? body.replace(/^```[A-Za-z0-9_+-]*\s*/, '').trim() : body
  return head.startsWith('{') || head.startsWith('[')
}

/**
 * Turn one model answer into a chunk result.
 * @returns {{ok: true, translation: string, contextNote: string, terms: Array, route: string, model: string}
 *   | {ok: false, code: string, message: string}}
 */
function readChunkResult(result) {
  const parsed = parseTranslation(result.text)
  if (!parsed.translation.trim()) return { ok: false, code: 'EMPTY_ANSWER', message: EMPTY_ANSWER_MESSAGE }
  if (!parsed.structured && looksLikeCutJson(result.text)) {
    return { ok: false, code: 'EMPTY_ANSWER', message: EMPTY_ANSWER_MESSAGE }
  }
  return {
    ok: true,
    translation: parsed.translation,
    contextNote: parsed.contextNote,
    terms: parsed.terms,
    route: result.route,
    model: result.model,
  }
}

export function registerTranslateRoutes(ctx, getRuntime) {
  ctx.inject(['webServer', 'connection'], (child) => {
    const reject = (req, res) => {
      const connection = child.get('connection')
      const rejection = connection?.requestRejection?.(req)
      // An explicit `undefined` is the only admitted answer.
      if (rejection === undefined) return false
      res.statusCode = typeof rejection === 'number' ? rejection : 403
      res.end()
      return true
    }

    const withRuntime = (handler) => async (req, res) => {
      if (reject(req, res)) return
      try {
        const runtime = getRuntime()
        if (!runtime) return sendJson(res, 503, { ok: false, code: 'NOT_READY', message: '插件尚未就绪' })
        await runtime.ready
        await handler(runtime, req, res)
      } catch (error) {
        const code = error?.code === 'TOO_LARGE' || error?.code === 'BAD_JSON' ? error.code : 'INTERNAL'
        sendJson(res, code === 'INTERNAL' ? 500 : 400, { ok: false, code, message: safeMessage(error) })
      }
    }

    // GET /state
    const stateHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
      await preloadDictionary(runtime)
      sendJson(res, 200, statePayload(runtime))
    })

    // POST /settings
    const settingsHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJsonBody(req)
      const next = sanitizeSettings(body?.settings ?? body, runtime.settings.snapshot())
      await runtime.settings.update(next)
      if (Number.isFinite(next.cacheLimit)) runtime.cache.limit = next.cacheLimit
      await preloadDictionary(runtime)
      sendJson(res, 200, statePayload(runtime))
    })

    // POST /translate — one chunk when the request names an index, the whole
    // text otherwise (legacy clients and selection translation).
    const translateHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJsonBody(req)
      const settings = runtime.settings.snapshot()
      if (settings.enabled === false) return sendJson(res, 200, { ok: false, code: 'DISABLED', message: '翻译已关闭' })
      const raw = String(body?.text ?? '')
      if (!raw.trim()) return sendJson(res, 200, { ok: false, code: 'EMPTY', message: '没有可翻译的文本' })
      if (raw.length > MAX_TEXT_CHARS) return sendJson(res, 200, { ok: false, code: 'TOO_LONG', message: '文本过长（上限 6 万字符），请分段翻译。' })
      const mode = body?.mode === 'selection' ? 'selection' : 'reasoning'
      const context = String(body?.context ?? '').slice(0, 2000)

      // An explicitly supplied index selects incremental mode; a request
      // without one is the legacy one-shot translation old clients still send.
      let index = null
      if (body?.index !== undefined && body?.index !== null) {
        if (!Number.isInteger(body.index) || body.index < 0) {
          return sendJson(res, 200, { ok: false, code: 'BAD_INDEX', message: '分块序号超出范围' })
        }
        index = body.index
      }

      // The chunk plan is deterministic, so the same text always yields the
      // same part count no matter which chunk a client asks for first.
      const chunks = planChunks(raw)
      if (index !== null && index >= chunks.length) {
        return sendJson(res, 200, { ok: false, code: 'BAD_INDEX', message: '分块序号超出范围' })
      }

      const selection = pickSelection(runtime.services, settings)
      const localModel = String(settings.localModel ?? '').trim()
      const engine = settings.engine ?? 'cloud'
      const routeId = engine !== 'cloud' && localModel ? `local:${localModel}` : selection ? `cloud:${selection.provider}/${selection.model}` : 'none'
      const targetLanguage = settings.targetLanguage ?? 'zh-CN'
      const count = chunks.length

      if (!needsTranslation(raw)) {
        if (index !== null) {
          return sendJson(res, 200, {
            ok: true,
            skipped: true,
            translation: '',
            contextNote: '',
            terms: [],
            part: { index, count },
            next: null,
          })
        }
        return sendJson(res, 200, { ok: true, skipped: true, translation: '', contextNote: '', terms: [], truncated: false })
      }

      if (!hasRoute(runtime, settings)) return sendJson(res, 200, noModelResponse())

      if (index !== null) {
        // Incremental: exactly one chunk per request, with its own timer.
        const chunk = chunks[index]
        const part = { index, count, start: chunk.start, end: chunk.end }
        const next = index + 1 < count ? index + 1 : null
        const partName = index === 0 ? 'head' : 'body'
        const partKey = cacheKey({ mode, targetLanguage, model: `${engine}|${routeId}|part:${partName}`, text: chunk.text })
        const hit = runtime.cache.get(partKey)
        if (hit) return sendJson(res, 200, { ok: true, ...hit, cached: true, part, next })

        const prompt = index === 0
          ? translationPrompt({ text: chunk.text, context, targetLanguage, mode, part: { index, count } })
          : translationBodyPrompt({ text: chunk.text, targetLanguage, part: { index, count } })
        const call = await runTranslationCall(runtime, settings, prompt.system, prompt.user)
        const parsed = call.ok ? readChunkResult(call.result) : call
        if (!parsed.ok) return sendJson(res, 200, { ok: false, code: parsed.code, message: parsed.message, part, next: index })
        const payload = {
          translation: parsed.translation,
          // Context and vocabulary only come with the opening segment.
          contextNote: index === 0 ? parsed.contextNote : '',
          terms: index === 0 ? normalizeTerms(parsed.terms, 6) : [],
          route: parsed.route,
          model: parsed.model,
        }
        runtime.cache.set(partKey, payload)
        void runtime.cache.flush()
        return sendJson(res, 200, { ok: true, ...payload, cached: false, part, next })
      }

      // Legacy: translate every chunk in order. A cached whole answer short-
      // circuits the loop, but only a complete answer is ever cached.
      const key = cacheKey({ mode, targetLanguage, model: `${engine}|${routeId}`, text: raw })
      const hit = runtime.cache.get(key)
      if (hit) {
        return sendJson(res, 200, {
          ok: true,
          ...hit,
          cached: true,
          truncated: false,
          partial: false,
          part: { index: 0, count },
          next: null,
        })
      }

      const translations = []
      const failed = []
      const terms = []
      let contextNote = ''
      let usedRoute = ''
      let usedModel = ''
      let firstError = null
      for (let chunkIndex = 0; chunkIndex < count; chunkIndex += 1) {
        const chunk = chunks[chunkIndex]
        const prompt = chunkIndex === 0
          ? translationPrompt({ text: chunk.text, context, targetLanguage, mode, part: { index: chunkIndex, count } })
          : translationBodyPrompt({ text: chunk.text, targetLanguage, part: { index: chunkIndex, count } })
        const call = await runTranslationCall(runtime, settings, prompt.system, prompt.user)
        const parsed = call.ok ? readChunkResult(call.result) : call
        if (!parsed.ok) {
          // One failed chunk never discards the ones that already succeeded.
          failed.push(chunkIndex)
          if (!firstError) firstError = { code: parsed.code, message: parsed.message }
          continue
        }
        translations.push(parsed.translation)
        if (!contextNote && parsed.contextNote) contextNote = parsed.contextNote
        terms.push(...parsed.terms)
        usedRoute = parsed.route
        usedModel = parsed.model
      }

      if (!translations.length) {
        return sendJson(res, 200, {
          ok: false,
          code: firstError?.code ?? 'EMPTY_ANSWER',
          message: firstError?.message ?? EMPTY_ANSWER_MESSAGE,
          truncated: false,
        })
      }

      const partial = failed.length > 0
      const payload = {
        translation: translations.join('\n\n'),
        contextNote,
        terms: normalizeTerms(terms, 6),
        route: usedRoute,
        model: usedModel,
      }
      // A partial answer is not a complete translation: leave it out of the
      // cache so the client can resume the failed chunks instead.
      if (!partial) {
        runtime.cache.set(key, payload)
        void runtime.cache.flush()
      }
      sendJson(res, 200, {
        ok: true,
        ...payload,
        cached: false,
        truncated: false,
        partial,
        ...(partial ? { failed } : {}),
        part: { index: 0, count },
        next: null,
      })
    })

    // POST /explain — one saved term, explained the way a reading card does it
    const explainHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJsonBody(req)
      const settings = runtime.settings.snapshot()
      if (settings.enabled === false) return sendJson(res, 200, { ok: false, code: 'DISABLED', message: '翻译已关闭' })
      const term = String(body?.term ?? '').trim().slice(0, 80)
      if (!term) return sendJson(res, 200, { ok: false, code: 'EMPTY', message: '没有要讲解的词' })
      if (!hasRoute(runtime, settings)) return sendJson(res, 200, noModelResponse())

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), requestBudget(settings))
      try {
        const prompt = explainPrompt({
          term,
          pos: String(body?.pos ?? '').slice(0, 24),
          gloss: String(body?.gloss ?? '').slice(0, 300),
          example: String(body?.example ?? '').slice(0, 300),
          targetLanguage: settings.targetLanguage,
        })
        const result = await generate({ services: runtime.services, settings, system: prompt.system, user: prompt.user, signal: controller.signal })
        if (!result) return sendJson(res, 200, noModelResponse())
        const parsed = parseExplain(result.text)
        if (!parsed.meaning.trim() && !parsed.example.trim()) {
          return sendJson(res, 200, { ok: false, code: 'EMPTY_ANSWER', message: '模型没有返回讲解，请重试。' })
        }
        sendJson(res, 200, { ok: true, ...parsed, route: result.route, model: result.model })
      } catch (error) {
        const cancelled = controller.signal.aborted
        sendJson(res, 200, {
          ok: false,
          code: cancelled ? 'TIMEOUT' : 'MODEL_ERROR',
          message: cancelled ? '模型响应超时，请重试。' : `模型调用失败：${safeMessage(error)}`,
        })
      } finally {
        clearTimeout(timer)
      }
    })

    // POST /toenglish — rewrite the Chinese draft in the composer as English
    const toEnglishHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJsonBody(req)
      const settings = runtime.settings.snapshot()
      if (settings.enabled === false) return sendJson(res, 200, { ok: false, code: 'DISABLED', message: '翻译已关闭' })
      const draft = String(body?.text ?? '').trim()
      if (!draft) return sendJson(res, 200, { ok: false, code: 'EMPTY', message: '输入框里没有内容' })
      if (draft.length > MAX_POLISH_CHARS) return sendJson(res, 200, { ok: false, code: 'TOO_LONG', message: '草稿过长，请分段转换' })
      if (!hasChinese(draft)) return sendJson(res, 200, { ok: false, code: 'NOT_CHINESE', message: '输入框里没有中文，未发送给模型' })
      if (!hasRoute(runtime, settings)) return sendJson(res, 200, noModelResponse())

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), requestBudget(settings))
      try {
        const prompt = toEnglishPrompt({ text: draft, targetLanguage: settings.targetLanguage })
        const result = await generate({ services: runtime.services, settings, system: prompt.system, user: prompt.user, signal: controller.signal })
        if (!result) return sendJson(res, 200, noModelResponse())
        const parsed = parseToEnglish(result.text)
        if (!parsed.english.trim()) return sendJson(res, 200, { ok: false, code: 'EMPTY_ANSWER', message: '模型没有返回英文，请重试。' })
        sendJson(res, 200, { ok: true, ...parsed, route: result.route, model: result.model })
      } catch (error) {
        const cancelled = controller.signal.aborted
        sendJson(res, 200, {
          ok: false,
          code: cancelled ? 'TIMEOUT' : 'MODEL_ERROR',
          message: cancelled ? '模型响应超时，请重试（本地小模型处理长文本会慢）。' : `模型调用失败：${safeMessage(error)}`,
        })
      } finally {
        clearTimeout(timer)
      }
    })

    // GET|POST /dictionary — local quick glosses, no model call involved
    const dictionaryHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, 'GET, POST')
      const dictionary = runtime.dictionary
      if (!dictionary) return sendJson(res, 503, { ok: false, code: 'NOT_READY', message: '本地词典尚未就绪' })

      if (req.method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const word = url.searchParams.get('word') ?? url.searchParams.get('w') ?? ''
        if (!word.trim()) return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少要查询的单词' })
        await preloadDictionary(runtime)
        return sendJson(res, 200, dictionaryPayload(dictionary, [word]))
      }

      const body = await readJsonBody(req)
      const words = body?.words
      if (!Array.isArray(words)) return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'words 必须是字符串数组' })
      if (words.length > MAX_LOOKUP_WORDS) {
        return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: `一次最多查询 ${MAX_LOOKUP_WORDS} 个单词` })
      }
      await preloadDictionary(runtime)
      sendJson(res, 200, dictionaryPayload(dictionary, words))
    })

    // GET/POST /vocab
    const vocabHandler = withRuntime(async (runtime, req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, entries: readVocab(runtime) })
      if (req.method !== 'POST') return methodNotAllowed(res, 'GET, POST')
      const body = await readJsonBody(req)
      const entries = readVocab(runtime)
      if (body?.action === 'add') {
        const entry = sanitizeVocabEntry(body.entry)
        if (!entry) return sendJson(res, 200, { ok: false, code: 'BAD_ENTRY', message: '术语为空' })
        const existing = entries.filter((item) => item.id !== entry.id)
        const next = [entry, ...existing].slice(0, MAX_VOCAB)
        await runtime.vocab.replace({ entries: next })
        return sendJson(res, 200, { ok: true, entries: next, added: entry })
      }
      if (body?.action === 'remove') {
        const id = String(body?.id ?? '').trim()
        const next = entries.filter((item) => item.id !== id)
        await runtime.vocab.replace({ entries: next })
        return sendJson(res, 200, { ok: true, entries: next })
      }
      if (body?.action === 'clear') {
        await runtime.vocab.replace({ entries: [] })
        return sendJson(res, 200, { ok: true, entries: [] })
      }
      return sendJson(res, 400, { ok: false, code: 'BAD_ACTION', message: '未知操作' })
    })

    // POST /cache/clear
    const cacheHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      runtime.cache.clear()
      await runtime.cache.flush()
      sendJson(res, 200, { ok: true, cacheSize: runtime.cache.size })
    })

    // POST /diag — the browser half reports what the live composer exposes
    // once, so a wrong assumption about InputState/InputActions can be fixed
    // from an observed fact instead of a guess. No user text is included.
    const diagHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJsonBody(req)
      const payload = { at: new Date().toISOString(), report: body }
      runtime.diagnostic = payload
      if (runtime.diagPath) {
        try {
          await mkdir(path.dirname(runtime.diagPath), { recursive: true })
          await writeFile(runtime.diagPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 })
        } catch (error) {
          runtime.logger?.debug?.(`dsh-translate: could not write diagnostic: ${error?.message ?? error}`)
        }
      }
      sendJson(res, 200, { ok: true })
    })

    // GET /local/models — what the local Ollama store has installed
    const localModelsHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
      const baseUrl = normalizeBaseUrl(runtime.settings.snapshot().localBaseUrl)
      try {
        const models = await listLocalModels(baseUrl)
        sendJson(res, 200, { ok: true, baseUrl, models })
      } catch (error) {
        sendJson(res, 200, { ok: false, baseUrl, models: [], message: safeMessage(error) })
      }
    })

    // POST /local/test — one tiny completion, so the page can show real latency
    const localTestHandler = withRuntime(async (runtime, req, res) => {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
      const body = await readJsonBody(req)
      const settings = runtime.settings.snapshot()
      const baseUrl = normalizeBaseUrl(settings.localBaseUrl)
      const model = String(body?.model ?? settings.localModel ?? '').trim()
      if (!model) return sendJson(res, 200, { ok: false, code: 'NO_MODEL', message: '先选择一个本地模型' })
      const started = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), LOCAL_TIMEOUT_MS)
      try {
        const reply = await chatLocal({
          baseUrl,
          model,
          system: 'Answer with one very short Chinese phrase.',
          user: '用中文回答两个字：收到',
          signal: controller.signal,
        })
        sendJson(res, 200, { ok: true, model, ms: Date.now() - started, reply: reply.slice(0, 120) })
      } catch (error) {
        const cancelled = controller.signal.aborted
        sendJson(res, 200, {
          ok: false,
          message: cancelled ? `本地模型 ${Math.round(LOCAL_TIMEOUT_MS / 1000)} 秒内没有响应` : safeMessage(error),
        })
      } finally {
        clearTimeout(timer)
      }
    })

    const routes = [
      ['/state', stateHandler, 'GET /state'],
      ['/settings', settingsHandler, 'POST /settings'],
      ['/translate', translateHandler, 'POST /translate'],
      ['/toenglish', toEnglishHandler, 'POST /toenglish'],
      ['/explain', explainHandler, 'POST /explain'],
      ['/dictionary', dictionaryHandler, 'GET|POST /dictionary'],
      ['/vocab', vocabHandler, 'GET|POST /vocab'],
      ['/cache/clear', cacheHandler, 'POST /cache/clear'],
      ['/diag', diagHandler, 'POST /diag'],
      ['/local/models', localModelsHandler, 'GET /local/models'],
      ['/local/test', localTestHandler, 'POST /local/test'],
    ]
    for (const [suffix, handler, label] of routes) {
      child.effect(
        () => child.webServer.register({ kind: 'exact', path: `${API_PREFIX}${suffix}`, handler }),
        `dsh-translate: ${label}`,
      )
    }
  })
}
