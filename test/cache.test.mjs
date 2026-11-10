import assert from 'node:assert/strict'
import test from 'node:test'

import { TranslationCache, cacheKey, normalizeSource } from '../lib/cache.js'

test('normalizeSource folds CRLF and trailing spaces', () => {
  assert.equal(normalizeSource('a\r\nb  \n\n\n\nc  '), 'a\nb\n\nc')
})

test('cacheKey is stable for equivalent text and differs per route', () => {
  const base = { mode: 'reasoning', targetLanguage: 'zh-CN', model: 'p/m', text: 'Hello\r\nthere' }
  const same = { ...base, text: 'Hello\nthere' }
  assert.equal(cacheKey(base), cacheKey(same))
  assert.notEqual(cacheKey(base), cacheKey({ ...base, model: 'p/other' }))
  assert.notEqual(cacheKey(base), cacheKey({ ...base, mode: 'selection' }))
  assert.notEqual(cacheKey(base), cacheKey({ ...base, targetLanguage: 'zh-TW' }))
  assert.match(cacheKey(base), /^[0-9a-f]{64}$/)
})

test('TranslationCache evicts the least recently used entry', () => {
  const cache = new TranslationCache({ limit: 2 })
  cache.set('a', { translation: 'A' })
  cache.set('b', { translation: 'B' })
  assert.equal(cache.size, 2)
  // Reading `a` makes `b` the oldest.
  assert.deepEqual(cache.get('a'), { translation: 'A' })
  cache.set('c', { translation: 'C' })
  assert.equal(cache.get('b'), undefined)
  assert.deepEqual(cache.get('a'), { translation: 'A' })
  assert.deepEqual(cache.get('c'), { translation: 'C' })
})

test('TranslationCache clear empties every entry', () => {
  const cache = new TranslationCache({ limit: 5 })
  cache.set('a', { translation: 'A' })
  cache.set('b', { translation: 'B' })
  cache.clear()
  assert.equal(cache.size, 0)
  assert.equal(cache.get('a'), undefined)
})
