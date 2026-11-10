/**
 * Translation cache: an in-memory LRU mirroring a JSON file in the profile.
 *
 * A reasoning block is translated once and then read from here, so collapsing
 * and re-expanding a block costs nothing. Entries are keyed by the normalized
 * source plus the routing that produced them, so switching models or language
 * does not reuse a stale answer.
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CACHE_VERSION = 1

/** Collapse whitespace that would otherwise create duplicate entries. */
export function normalizeSource(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Stable cache key: same text plus same routing gives the same answer. */
export function cacheKey({ mode, targetLanguage, model, text }) {
  const source = normalizeSource(text)
  return createHash('sha256')
    .update(`${mode ?? ''}\u0000${targetLanguage ?? ''}\u0000${model ?? ''}\u0000${source}`)
    .digest('hex')
}

export class TranslationCache {
  constructor({ filePath, limit = 2000, logger } = {}) {
    this.filePath = filePath
    // Capacity only; the routes clamp the user-facing setting to a sane floor.
    this.limit = Math.max(1, Math.round(limit ?? 2000))
    this.logger = logger
    this.map = new Map()
    this.loaded = false
    this.dirty = false
    this.saveTimer = null
  }

  get size() {
    return this.map.size
  }

  async load() {
    if (this.loaded) return
    this.loaded = true
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (parsed?.version !== CACHE_VERSION) return
      for (const entry of Array.isArray(parsed?.entries) ? parsed.entries : []) {
        if (!Array.isArray(entry) || entry.length < 2) continue
        const [key, value] = entry
        if (typeof key === 'string' && value && typeof value === 'object') this.map.set(key, value)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') this.logger?.debug?.(`dsh-translate: could not read cache: ${error?.message ?? error}`)
    }
  }

  get(key) {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    // Touch: Map iteration order is the eviction order.
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    this.dirty = true
    this.#scheduleSave()
  }

  clear() {
    const had = this.map.size > 0
    this.map.clear()
    this.dirty = had
    this.#scheduleSave()
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.filePath && this.dirty) await this.#save()
  }

  #scheduleSave() {
    if (!this.filePath || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.#save()
    }, 400)
    this.saveTimer.unref?.()
  }

  async #save() {
    const filePath = this.filePath
    if (!filePath) return
    this.dirty = false
    const temp = `${filePath}.${process.pid}.tmp`
    try {
      await mkdir(path.dirname(filePath), { recursive: true })
      const payload = JSON.stringify({ version: CACHE_VERSION, entries: [...this.map.entries()] })
      await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, filePath)
    } catch (error) {
      // Keep the write pending: a later flush retries instead of losing it.
      this.dirty = true
      this.logger?.debug?.(`dsh-translate: could not write cache: ${error?.message ?? error}`)
    }
  }
}
