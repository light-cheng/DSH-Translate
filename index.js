/**
 * dsh-translate — English translation and learning for DeepSeek Harness.
 *
 * The Host half owns the durable state (settings, vocabulary, translation
 * cache) and the model calls; the browser half (`client.js`) owns every pixel.
 * They talk over same-origin HTTP routes registered at /dsh-translate/api.
 */

import path from 'node:path'

import { TranslationCache } from './lib/cache.js'
import { Dictionary } from './lib/dictionary.js'
import { registerTranslateRoutes } from './lib/routes.js'
import { JsonStore } from './lib/store.js'

export const name = 'dsh-translate'

/**
 * Read from `cordis.patch.yml`; the settings page stores overrides next to the
 * profile, and those win. Values here are defaults, not a schema.
 */
const DEFAULT_CONFIG = {
  enabled: true,
  targetLanguage: 'zh-CN',
  /** Off by default: the reader decides when a block is worth a model call. */
  autoTranslate: false,
  showTerms: true,
  showContext: true,
  showDock: true,
  /** Show a bundled-dictionary gloss before the model explains a word. */
  showDict: true,
  /** 'us' | 'uk': which IPA and which Youdao audio the word cards prefer. */
  accent: 'us',
  maxChars: 8000,
  cacheLimit: 2000,
  /** null = whatever model the Harness currently uses. */
  model: null,
  /** 'cloud' | 'local' | 'auto' (local first, cloud on failure). */
  engine: 'cloud',
  localBaseUrl: 'http://127.0.0.1:11434',
  /** Ollama model name, for example qwen2.5:3b-instruct. */
  localModel: '',
}

function readConfig(rawConfig) {
  const config = { ...DEFAULT_CONFIG }
  if (!rawConfig || typeof rawConfig !== 'object') return config
  for (const [key, value] of Object.entries(rawConfig)) {
    if (value === undefined) continue
    config[key] = value
  }
  return config
}

export async function apply(ctx, rawConfig) {
  const logger = ctx.logger
  const config = readConfig(rawConfig)

  // Durable files live beside the profile so they survive restarts without
  // widening this plugin's file access. Without a profile they stay in memory.
  const profileDir = ctx.get?.('profileContext')?.dir
  const dataDir = profileDir ? path.join(profileDir, 'dsh-translate') : undefined

  const runtime = {
    config,
    logger,
    services: {},
    diagPath: dataDir ? path.join(dataDir, 'diagnostic.json') : undefined,
    diagnostic: null,
    settings: new JsonStore({ filePath: dataDir ? path.join(dataDir, 'settings.json') : undefined, defaults: config, logger }),
    vocab: new JsonStore({ filePath: dataDir ? path.join(dataDir, 'vocab.json') : undefined, defaults: { entries: [] }, logger }),
    cache: new TranslationCache({ filePath: dataDir ? path.join(dataDir, 'cache.json') : undefined, limit: config.cacheLimit, logger }),
    /** Bundled English→Chinese dictionary; loaded lazily, warmed below. */
    dictionary: new Dictionary({ logger }),
    ready: null,
  }
  // Warm the ~2 MB gzip off the startup path: parsing happens once, the browser
  // half asks lazily, and both await the same promise, so a slow disk never
  // delays plugin registration or blocks the first paint.
  void runtime.dictionary.load()

  runtime.ready = Promise.all([runtime.settings.load(), runtime.vocab.load(), runtime.cache.load()])
    .then(() => {
      const settings = runtime.settings.snapshot()
      if (Number.isFinite(settings.cacheLimit)) runtime.cache.limit = settings.cacheLimit
    })
    .catch((error) => {
      logger?.warn?.(`dsh-translate: could not load state: ${error?.message ?? error}`)
    })

  // Both services are optional: without them the plugin still renders and the
  // settings page explains that no model route is available.
  const disposeModel = ctx.inject(['llm', 'agentDefaultModel'], (child) => {
    runtime.services.llm = child.llm
    runtime.services.agentDefaultModel = child.agentDefaultModel
  })
  if (typeof disposeModel === 'function') ctx.effect(() => disposeModel)

  const disposeRoutes = registerTranslateRoutes(ctx, () => runtime)
  if (typeof disposeRoutes === 'function') ctx.effect(() => disposeRoutes)

  await runtime.ready
  const settings = runtime.settings.snapshot()
  logger?.info?.(
    `dsh-translate: ready (persist: ${runtime.settings.persist ? dataDir : 'memory only'}, cache: ${runtime.cache.size}, model: ${settings.model ? `${settings.model.provider}/${settings.model.model}` : 'harness default'})`,
  )

  // Persist the LRU before the plugin unloads so a restart does not re-spend.
  ctx.effect(() => () => {
    void runtime.cache.flush()
    return undefined
  })
}
