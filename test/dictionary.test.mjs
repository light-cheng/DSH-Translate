/**
 * The dictionary is a pure lookup over a bundled payload, so a synthetic gzip
 * covers every branch: exact hits, case/punctuation folding, the inflected-form
 * table, the conservative re-inflection rules, batches and broken files.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { DEFAULT_DICTIONARY_PATH, Dictionary, MAX_LOOKUP_WORDS, normalizeQuery } from '../lib/dictionary.js'

const FIXTURE = {
  v: 1,
  built: '2026-01-02',
  sources: [{ name: 'ECDICT', license: 'MIT', url: 'https://example.test/ecdict' }],
  words: [
    ['better', '/ˈbetə/', '/ˈbetə/', 'a. 更好的'],
    ['big', '/bɪɡ/', '/bɪɡ/', 'a. 大的'],
    ['box', '/bɑks/', '/bɒks/', 'n. 盒子'],
    ["don't", '/doʊnt/', '/dəʊnt/', 'v. 不'],
    ['go', '/ɡoʊ/', '/ɡəʊ/', 'vi. 去'],
    ['good', '/ɡʊd/', '/ɡʊd/', 'a. 好的'],
    ['happy', '/ˈhæpi/', '/ˈhæpi/', 'a. 快乐的'],
    ['invoke', '/ɪnˈvoʊk/', '/ɪnˈvəʊk/', 'vt. 调用'],
    ['like', '/laɪk/', '/laɪk/', 'vt. 喜欢'],
    ['make', '/meɪk/', '/meɪk/', 'vt. 制造'],
    ['plain', '', '', 'a. 简单的'],
    ['quick', '/kwɪk/', '/kwɪk/', 'a. 快的'],
    ['run', '/rən/', '/rʌn/', 'vi. 跑'],
    ['state', '/ˈsteɪt/', '/ˈsteɪt/', 'n. 州, 状态\na. 国家的'],
    ['stop', '/stɑp/', '/stɒp/', 'vt. 停止'],
    ['study', '/ˈstədi/', '/ˈstʌdi/', 'n. 学习'],
    // Malformed rows must be skipped, never break the load.
    ['', '', '', 'n. 空'],
    ['tooShort', '/x/'],
    ['state', '/duplicate/', '/duplicate/', '重复词条'],
  ],
  forms: {
    better: 'good',
    invoked: 'invoke',
    ran: 'run',
    went: 'go',
    /** Points at a word that is not in `words`: ignored. */
    ghost: 'missing-base',
    /** Identity mappings carry no information: ignored. */
    same: 'same',
  },
}

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-translate-dict-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function fixtureDictionary(t) {
  const dir = await tempDir(t)
  const filePath = path.join(dir, 'dictionary.json.gz')
  await writeFile(filePath, gzipSync(Buffer.from(JSON.stringify(FIXTURE), 'utf8')))
  const dictionary = new Dictionary({ filePath })
  await dictionary.load()
  return { dir, filePath, dictionary }
}

test('the bundled payload path points at data/dictionary.json.gz', () => {
  assert.equal(path.isAbsolute(DEFAULT_DICTIONARY_PATH), true)
  assert.equal(path.basename(DEFAULT_DICTIONARY_PATH), 'dictionary.json.gz')
  assert.equal(path.basename(path.dirname(DEFAULT_DICTIONARY_PATH)), 'data')
})

test('load parses the payload once and reports its statistics', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  assert.equal(await dictionary.load(), true)
  assert.equal(dictionary.available, true)
  assert.deepEqual(dictionary.stats, {
    words: 16,
    forms: 4,
    built: '2026-01-02',
    sources: [{ name: 'ECDICT', license: 'MIT', url: 'https://example.test/ecdict' }],
  })
})

test('lookup answers an exact entry with the documented fields', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  const entry = dictionary.lookup('state')
  assert.deepEqual(Object.keys(entry), ['query', 'found', 'word', 'ipa', 'ipaUk', 'translation', 'matched'])
  assert.deepEqual(entry, {
    query: 'state',
    found: true,
    word: 'state',
    ipa: '/ˈsteɪt/',
    ipaUk: '/ˈsteɪt/',
    translation: 'n. 州, 状态\na. 国家的',
    matched: 'exact',
  })
  // A missing IPA stays an empty string rather than null, so the row shape is stable.
  const plain = dictionary.lookup('plain')
  assert.equal(plain.ipa, '')
  assert.equal(plain.ipaUk, '')
  assert.equal(plain.translation, 'a. 简单的')
})

test('lookup folds case, quotes and surrounding punctuation', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  for (const input of ['  State  ', 'STATE', '“state,”', '(state)', 'state...', "'state'"]) {
    const entry = dictionary.lookup(input)
    assert.equal(entry?.matched, 'exact', `expected an exact hit for ${JSON.stringify(input)}`)
    assert.equal(entry.word, 'state')
  }
  // `query` keeps the caller's spelling so rows can be paired with their token.
  assert.equal(dictionary.lookup('  State! ').query, 'State!')
})

test('lookup folds curly apostrophes into the ASCII ones the payload uses', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  for (const input of ['don’t', 'DON’T', "don't", '“don’t”', 'don’t…']) {
    const entry = dictionary.lookup(input)
    assert.equal(entry?.matched, 'exact', `expected an exact hit for ${JSON.stringify(input)}`)
    assert.equal(entry.word, "don't")
    assert.equal(entry.translation, 'v. 不')
  }
  // The caller's own spelling is still what `query` reports.
  assert.equal(dictionary.lookup('DON’T').query, 'DON’T')
  // Curly single quotes wrapping a plain word are just stripping punctuation.
  assert.equal(dictionary.lookup('‘state’').word, 'state')
  assert.equal(dictionary.lookup('‘state’').matched, 'exact')
  assert.equal(normalizeQuery('DON’T'), "don't")
  assert.equal(normalizeQuery('‘State’'), 'state')
  assert.equal(normalizeQuery('rock’n’roll'), "rock'n'roll")
})

test('lookup rejects phrases, empty input and over-long tokens', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  assert.equal(dictionary.lookup(''), null)
  assert.equal(dictionary.lookup('   '), null)
  assert.equal(dictionary.lookup('two words'), null)
  assert.equal(dictionary.lookup('state of the art'), null)
  assert.equal(dictionary.lookup('x'.repeat(65)), null)
  assert.equal(dictionary.lookup(null), null)
  assert.equal(dictionary.lookup(undefined), null)
  assert.equal(dictionary.lookup('qwerty'), null)
})

test('normalizeQuery keeps single words and drops everything else', () => {
  assert.equal(normalizeQuery('  “State,” '), 'state')
  assert.equal(normalizeQuery("don't"), "don't")
  assert.equal(normalizeQuery('well-known'), 'well-known')
  assert.equal(normalizeQuery('two words'), '')
  assert.equal(normalizeQuery('   '), '')
  assert.equal(normalizeQuery('x'.repeat(65)), '')
})

test('lookup falls back to the inflected-form table', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  assert.deepEqual(dictionary.lookup('Ran'), {
    query: 'Ran',
    found: true,
    word: 'run',
    ipa: '/rən/',
    ipaUk: '/rʌn/',
    translation: 'vi. 跑',
    matched: 'form',
  })
  assert.equal(dictionary.lookup('invoked').word, 'invoke')
  assert.equal(dictionary.lookup('went').matched, 'form')
  // A form whose base is missing from `words` is ignored at load time.
  assert.equal(dictionary.lookup('ghost'), null)
  assert.equal(dictionary.lookup('same'), null)
})

test('an exact entry wins over a form mapping', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  const entry = dictionary.lookup('better')
  assert.equal(entry.matched, 'exact')
  assert.equal(entry.word, 'better')
  assert.equal(entry.translation, 'a. 更好的')
})

test('lookup reduces inflected words the form table missed', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  const cases = [
    ['states', 'state'],
    ['boxes', 'box'],
    ['studies', 'study'],
    ['liked', 'like'],
    ['stopped', 'stop'],
    ['studied', 'study'],
    ['running', 'run'],
    ['making', 'make'],
    ['bigger', 'big'],
    ['biggest', 'big'],
    ['quickest', 'quick'],
    ['happier', 'happy'],
    ['happiest', 'happy'],
    ['quickly', 'quick'],
    ['happily', 'happy'],
  ]
  for (const [input, word] of cases) {
    const entry = dictionary.lookup(input)
    assert.equal(entry?.matched, 'morph', `${input} should be reduced to a known word`)
    assert.equal(entry.word, word, `${input} should reduce to ${word}`)
  }
})

test('lookupMany keeps input order with one row per input', async (t) => {
  const { dictionary } = await fixtureDictionary(t)
  const entries = dictionary.lookupMany(['running', 'State', 'qwerty', 'ran', 42])
  assert.deepEqual(
    entries.map((entry) => [entry.query, entry.found, entry.word ?? null, entry.matched ?? null]),
    [
      ['running', true, 'run', 'morph'],
      ['State', true, 'state', 'exact'],
      ['qwerty', false, null, null],
      ['ran', true, 'run', 'form'],
      ['42', false, null, null],
    ],
  )
  assert.deepEqual(Object.keys(entries[2]), ['query', 'found'])
  assert.equal(entries[2].translation, undefined)
  // The batch ceiling is the same number the route enforces.
  assert.equal(MAX_LOOKUP_WORDS, 24)
  assert.equal(dictionary.lookupMany(new Array(30).fill('state')).length, MAX_LOOKUP_WORDS)
  assert.deepEqual(dictionary.lookupMany([]), [])
  assert.deepEqual(dictionary.lookupMany(undefined), [])
})

test('a missing payload is reported once and never thrown', async (t) => {
  const dir = await tempDir(t)
  const warnings = []
  const dictionary = new Dictionary({
    filePath: path.join(dir, 'missing.json.gz'),
    logger: { warn: (message) => warnings.push(message) },
  })
  // Concurrent callers share the same failed attempt.
  assert.deepEqual(await Promise.all([dictionary.load(), dictionary.load()]), [false, false])
  assert.equal(dictionary.available, false)
  assert.equal(dictionary.stats, null)
  assert.equal(dictionary.lookup('state'), null)
  assert.equal(await dictionary.load(), false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /local dictionary unavailable/)
  assert.deepEqual(dictionary.lookupMany(['state', 42]), [
    { query: 'state', found: false },
    { query: '42', found: false },
  ])
})

test('a damaged payload is reported instead of thrown', async (t) => {
  const dir = await tempDir(t)
  const cases = [
    ['not-gzip.json.gz', Buffer.from('this is not a gzip stream')],
    ['not-json.json.gz', gzipSync(Buffer.from('not json at all'))],
    ['empty-words.json.gz', gzipSync(Buffer.from(JSON.stringify({ v: 1, words: [] })))],
    ['no-words.json.gz', gzipSync(Buffer.from(JSON.stringify({ v: 1 })))],
    ['unusable-words.json.gz', gzipSync(Buffer.from(JSON.stringify({ words: [['x'], 'y', null, ['', '', '', '']] })))],
  ]
  for (const [name, bytes] of cases) {
    const filePath = path.join(dir, name)
    await writeFile(filePath, bytes)
    const warnings = []
    const dictionary = new Dictionary({ filePath, logger: { warn: (message) => warnings.push(message) } })
    assert.equal(await dictionary.load(), false, name)
    assert.equal(dictionary.available, false, name)
    assert.equal(dictionary.stats, null, name)
    assert.equal(dictionary.lookup('state'), null, name)
    assert.equal(warnings.length, 1, name)
  }
})
