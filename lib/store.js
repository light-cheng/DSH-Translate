/**
 * Small JSON stores for the plugin's own state (settings and vocabulary).
 *
 * The profile directory is the only durable place this plugin writes; both
 * files are owner-only, replaced atomically, and optional. Without a profile
 * directory the store keeps working in memory and reports `persist: false`.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const FILE_VERSION = 1

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export class JsonStore {
  /**
   * @param {object} options
   * @param {string | undefined} options.filePath Absolute file path, or undefined for memory only.
   * @param {object} options.defaults Defaults merged under the persisted values.
   * @param {object} [options.logger]
   */
  constructor({ filePath, defaults = {}, logger } = {}) {
    this.filePath = filePath
    this.defaults = defaults
    this.logger = logger
    this.data = { ...defaults }
    this.loaded = false
    this.loadError = null
  }

  get persist() {
    return Boolean(this.filePath)
  }

  async load() {
    if (this.loaded) return this
    this.loaded = true
    if (!this.filePath) return this
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (isPlainObject(parsed?.data) && parsed.version === FILE_VERSION) {
        this.data = { ...this.defaults, ...parsed.data }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.loadError = error
        this.logger?.debug?.(`dsh-translate: could not read ${path.basename(this.filePath)}: ${error?.message ?? error}`)
      }
    }
    return this
  }

  /** Current values; callers must not mutate the returned object. */
  snapshot() {
    return this.data
  }

  /** Merge a patch and persist it. Resolves to the new snapshot. */
  async update(patch) {
    if (!isPlainObject(patch)) return this.data
    this.data = { ...this.data, ...patch }
    await this.save()
    return this.data
  }

  /** Replace the whole value and persist it. */
  async replace(value) {
    if (!isPlainObject(value)) return this.data
    this.data = value
    await this.save()
    return this.data
  }

  async save() {
    if (!this.filePath) return
    const temp = `${this.filePath}.${process.pid}.tmp`
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(temp, JSON.stringify({ version: FILE_VERSION, data: this.data }), { encoding: 'utf8', mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, this.filePath)
      this.loadError = null
    } catch (error) {
      this.loadError = error
      this.logger?.debug?.(`dsh-translate: could not write ${path.basename(this.filePath)}: ${error?.message ?? error}`)
    }
  }
}
