/**
 * The bundled English→Chinese dictionary.
 *
 * `data/dictionary.json.gz` ships next to the plugin code (ECDICT for the
 * Chinese senses, ipa-dict for the IPA), so a selection can show a gloss
 * immediately instead of waiting for a model. The payload is decompressed
 * and indexed once; every later lookup is a Map read and the batch route answers
 * without any network call. The payload is GPL-3.0-only (see data/README.md);
 * the code around it is MIT.
 *
 * The file is part of the package, so a missing or damaged payload is a normal
 * state for a hand-assembled profile: it is reported as `available: false` and
 * never thrown, which keeps the plugin's other routes alive.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

export const DEFAULT_DICTIONARY_PATH = fileURLToPath(new URL('../data/dictionary.json.gz', import.meta.url))

/** Batch ceiling shared by `lookupMany` and the /dictionary route. */
export const MAX_LOOKUP_WORDS = 24

const MAX_WORD_CHARS = 64
const MAX_QUERY_CHARS = 120
/** One word: letters/digits with apostrophes or hyphens allowed inside. */
const WORD_SHAPE = /^[a-z0-9][a-z0-9'-]{0,63}$/

const gunzipAsync = promisify(gunzip)

/**
 * Reduce one selection token to its dictionary key: lower case, curly quotes
 * folded to the ASCII apostrophe the payload uses, wrapping punctuation and
 * quotes removed (`“State,”` -> `state`, `’` -> `'`). Returns '' for anything
 * that is not a single word — a phrase, a bare number of punctuation, an
 * over-long token — and both lookup callers treat that as a miss.
 */
export function normalizeQuery(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[’‘]/g, "'")
  if (!text) return ''
  const stripped = text.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')
  if (!stripped || stripped.length > MAX_WORD_CHARS) return ''
  return WORD_SHAPE.test(stripped) ? stripped : ''
}

/** The `query` field: the caller's own spelling, trimmed and bounded. */
function queryLabel(value) {
  const text = String(value ?? '').trim()
  return text.length > MAX_QUERY_CHARS ? text.slice(0, MAX_QUERY_CHARS) : text
}

/**
 * Conservative re-inflection for words `forms` does not list.
 *
 * Every candidate is only used when it is a real entry, so an unknown word still
 * answers null; the list is ordered so the most likely base comes first.
 * Examples: states→state, boxes→box, studies→study, liked→like, stopped→stop,
 * running→run, making→make, bigger→big, quickest→quick, happier→happy,
 * quickly→quick, happily→happy.
 */
function morphologicalCandidates(word) {
  const candidates = []
  const add = (value) => {
    if (!value || value.length < 2 || value === word) return
    if (!candidates.includes(value)) candidates.push(value)
  }
  /** running -> runn -> run: undo the doubled consonant of a short stem. */
  const undouble = (stem) => (stem.length > 2 && stem.at(-1) === stem.at(-2) && !/[aeiou]/.test(stem.at(-1)) ? stem.slice(0, -1) : stem)

  // -ies / -ied / -ier / -iest / -ily -> y
  if (word.endsWith('ies') && word.length > 4) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ied') && word.length > 4) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ier') && word.length > 4) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('iest') && word.length > 5) add(`${word.slice(0, -4)}y`)
  if (word.endsWith('ily') && word.length > 4) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ly')) add(word.slice(0, -2))

  // plurals and third-person -s / -es
  if (word.endsWith('s') && !word.endsWith('ss')) {
    add(word.slice(0, -1))
    if (word.endsWith('es')) add(word.slice(0, -2))
  }

  // past tense -ed / -d, including stop→stopped and like→liked
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2)
    add(stem)
    add(`${stem}e`)
    add(undouble(stem))
  }
  if (word.endsWith('d')) add(word.slice(0, -1))

  // progressive -ing, including run→running and make→making
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3)
    add(stem)
    add(`${stem}e`)
    add(undouble(stem))
  }

  // comparative / superlative -er / -est, including big→bigger, nice→nicer
  if (word.endsWith('er')) {
    const stem = word.slice(0, -2)
    add(stem)
    add(`${stem}e`)
    add(undouble(stem))
  }
  if (word.endsWith('est')) {
    const stem = word.slice(0, -3)
    add(stem)
    add(`${stem}e`)
    add(undouble(stem))
  }

  return candidates
}

/** One response row for a hit; the key order matches the Host contract. */
function entryOf(query, entry, matched) {
  return {
    query,
    found: true,
    word: entry.word,
    ipa: entry.ipa,
    ipaUk: entry.ipaUk,
    translation: entry.translation,
    matched,
  }
}

export class Dictionary {
  /**
   * @param {object} [options]
   * @param {string} [options.filePath] Absolute path to the gzip payload.
   * @param {object} [options.logger]
   */
  constructor({ filePath = DEFAULT_DICTIONARY_PATH, logger } = {}) {
    this.filePath = filePath
    this.logger = logger
    this.words = null
    this.forms = null
    this.meta = null
    // One shared promise: concurrent requests wait for the same parse, and a
    // failed attempt is remembered instead of retried on every selection.
    this.pending = null
  }

  /** True when the payload is parsed and carries at least one word. */
  get available() {
    return Boolean(this.words?.size)
  }

  /** `{ words, forms, built, sources }`, or null until the payload is usable. */
  get stats() {
    if (!this.available) return null
    return {
      words: this.words.size,
      forms: this.forms.size,
      built: this.meta.built,
      sources: this.meta.sources,
    }
  }

  /**
   * Decompress and index the payload once. Never rejects: a missing or broken
   * file warns once and leaves the dictionary unavailable.
   * @returns {Promise<boolean>} true when lookups can be answered.
   */
  async load() {
    if (this.available) return true
    if (!this.pending) {
      this.pending = this.#read().catch((error) => {
        this.logger?.warn?.(`dsh-translate: local dictionary unavailable: ${error?.message ?? error}`)
        this.words = null
        this.forms = null
        this.meta = null
        return false
      })
    }
    return this.pending
  }

  /**
   * One word, in this order: exact entry, `forms` reverse lookup (ran→run,
   * matched 'form'), then the conservative rules (matched 'morph'). `query`
   * keeps the caller's spelling so answers can be paired with the tokens asked
   * about.
   * @returns {{query: string, found: true, word: string, ipa: string, ipaUk: string, translation: string, matched: 'exact'|'form'|'morph'} | null}
   */
  lookup(text) {
    const query = queryLabel(text)
    const key = normalizeQuery(text)
    if (!key || !this.available) return null
    const exact = this.words.get(key)
    if (exact) return entryOf(query, exact, 'exact')
    const base = this.forms.get(key)
    if (base) {
      const entry = this.words.get(base)
      if (entry) return entryOf(query, entry, 'form')
    }
    for (const candidate of morphologicalCandidates(key)) {
      const entry = this.words.get(candidate)
      if (entry) return entryOf(query, entry, 'morph')
    }
    return null
  }

  /**
   * Batch form of `lookup`: same order, exactly one row per input, capped at
   * MAX_LOOKUP_WORDS. Misses and non-words become `{ query, found: false }` so
   * the browser half can lay out its rows in one pass.
   * @param {string[]} texts
   */
  lookupMany(texts) {
    const list = Array.isArray(texts) ? texts.slice(0, MAX_LOOKUP_WORDS) : []
    return list.map((text) => this.lookup(text) ?? { query: queryLabel(text), found: false })
  }

  async #read() {
    const compressed = await readFile(this.filePath)
    const parsed = JSON.parse((await gunzipAsync(compressed)).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.words)) throw new Error('词典文件格式不正确')

    const words = new Map()
    for (const raw of parsed.words) {
      if (!Array.isArray(raw) || raw.length < 4) continue
      const word = String(raw[0] ?? '').trim().toLowerCase()
      const translation = String(raw[3] ?? '').trim()
      if (!word || !translation || words.has(word)) continue
      words.set(word, {
        word,
        ipa: String(raw[1] ?? '').trim(),
        ipaUk: String(raw[2] ?? '').trim(),
        translation,
      })
    }
    if (!words.size) throw new Error('词典文件没有可用的词条')

    // Only mappings that lead to a real entry are kept, so `stats.forms` counts
    // what a lookup can actually use.
    const forms = new Map()
    const rawForms = parsed.forms && typeof parsed.forms === 'object' ? parsed.forms : {}
    for (const [form, base] of Object.entries(rawForms)) {
      const key = String(form ?? '').trim().toLowerCase()
      const value = String(base ?? '').trim().toLowerCase()
      if (!key || !value || key === value || !words.has(value)) continue
      forms.set(key, value)
    }

    this.words = words
    this.forms = forms
    this.meta = {
      built: typeof parsed.built === 'string' ? parsed.built : null,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              name: String(item.name ?? ''),
              license: String(item.license ?? ''),
              url: String(item.url ?? ''),
            }))
        : [],
    }
    return true
  }
}
