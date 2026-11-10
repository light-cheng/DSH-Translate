import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractJson,
  needsTranslation,
  normalizeTerms,
  parseExplain,
  parseToEnglish,
  parseTranslation,
  planChunks,
  splitChunks,
  stripFences,
} from '../lib/parse.js'

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

test('stripFences removes one surrounding code fence', () => {
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripFences('{"a":1}'), '{"a":1}')
  assert.equal(stripFences('  plain  '), 'plain')
})

test('extractJson reads fenced JSON and JSON surrounded by prose', () => {
  assert.deepEqual(extractJson('```json\n{"translation":"你好"}\n```'), { translation: '你好' })
  assert.deepEqual(extractJson('Here you go:\n{"translation":"你好"}\nthanks'), { translation: '你好' })
  assert.equal(extractJson('no json here'), null)
})

test('parseTranslation accepts the structured answer', () => {
  const raw = JSON.stringify({
    translation: '这段说明测试先失败。',
    context: '作者在强调测试先行。',
    terms: [
      { term: 'idempotent', pos: 'adj.', gloss: '幂等的', example: 'an idempotent call' },
      { term: 'retry', pos: 'v.', gloss: '重试' },
    ],
  })
  const parsed = parseTranslation(raw)
  assert.equal(parsed.structured, true)
  assert.equal(parsed.translation, '这段说明测试先失败。')
  assert.equal(parsed.contextNote, '作者在强调测试先行。')
  assert.equal(parsed.terms.length, 2)
  assert.equal(parsed.terms[0].term, 'idempotent')
})

test('parseTranslation degrades to plain text without JSON', () => {
  const parsed = parseTranslation('```\nJust a translation.\n```')
  assert.equal(parsed.structured, false)
  assert.equal(parsed.translation, 'Just a translation.')
  assert.deepEqual(parsed.terms, [])
})

test('parseTranslation keeps terms when the translation field is empty', () => {
  const parsed = parseTranslation('{"terms":[{"term":"cache","gloss":"缓存"}]}')
  assert.equal(parsed.structured, true)
  assert.equal(parsed.terms.length, 1)
})

test('normalizeTerms dedupes case-insensitively and caps the list', () => {
  const terms = normalizeTerms([
    { term: 'Cache', gloss: '缓存' },
    { term: 'cache', gloss: '重复' },
    { term: '   ' },
    null,
    ...Array.from({ length: 12 }, (_, index) => ({ term: `word${index}` })),
  ])
  assert.equal(terms[0].term, 'Cache')
  assert.equal(terms.filter((item) => item.term.toLowerCase() === 'cache').length, 1)
  assert.ok(terms.length <= 8)
})

test('parseExplain reads the meaning, usage, collocations and example', () => {
  const parsed = parseExplain(
    JSON.stringify({
      meaning: '在这里指调用一个接口。',
      usage: '常与 API、method 连用；不要和 evoke 混淆。',
      collocations: ['invoke an API', 'invoke a method', ''],
      example: 'The client invokes the endpoint with a stable idempotency key.',
    }),
  )
  assert.equal(parsed.meaning, '在这里指调用一个接口。')
  assert.equal(parsed.collocations.length, 2)
  assert.match(parsed.example, /invokes the endpoint/)
  assert.equal(parsed.structured, true)
})

test('parseExplain falls back to prose', () => {
  const parsed = parseExplain('调用接口的意思。')
  assert.equal(parsed.meaning, '调用接口的意思。')
  assert.deepEqual(parsed.collocations, [])
  assert.equal(parsed.structured, false)
})

test('parseToEnglish reads the rewrite and its notes', () => {
  const parsed = parseToEnglish(
    JSON.stringify({
      english: 'Please fix the failing test first.',
      notes: [{ original: '先修测试', suggestion: 'fix the failing test first', reason: '祈使句加 please 更客气' }],
    }),
  )
  assert.equal(parsed.english, 'Please fix the failing test first.')
  assert.equal(parsed.notes.length, 1)
  assert.equal(parsed.notes[0].reason, '祈使句加 please 更客气')
})

test('parseToEnglish falls back to the raw answer', () => {
  const parsed = parseToEnglish('Please fix the failing test first.')
  assert.equal(parsed.english, 'Please fix the failing test first.')
  assert.deepEqual(parsed.notes, [])
})

test('needsTranslation skips Chinese and code-only text', () => {
  assert.equal(needsTranslation('这是一段中文说明，里面有一个 identifier'), false)
  assert.equal(needsTranslation('The runner keeps retrying the request.'), true)
  assert.equal(needsTranslation('a1'), false)
  assert.equal(needsTranslation(''), false)
})

test('splitChunks keeps short text whole and respects the chunk cap', () => {
  assert.deepEqual(splitChunks('one short paragraph'), ['one short paragraph'])
  const long = Array.from({ length: 40 }, (_, index) => `Paragraph ${index} ${'word '.repeat(60)}`).join('\n\n')
  const chunks = splitChunks(long, { chunkChars: 2000, maxChunks: 3 })
  assert.ok(chunks.length > 1)
  assert.ok(chunks.length <= 3)
  for (const chunk of chunks) assert.ok(chunk.length <= 2100, `chunk too long: ${chunk.length}`)
})

test('splitChunks hard-splits a single oversized paragraph', () => {
  const chunks = splitChunks('x'.repeat(9000), { chunkChars: 3000, maxChunks: 3 })
  assert.equal(chunks.length, 3)
  assert.equal(chunks[0].length, 3000)
})

test('planChunks splits a 12k text into more than three covered parts', () => {
  const source = makeLongText(12000)
  const chunks = planChunks(source)
  assert.ok(chunks.length > 3, `expected more than 3 parts, got ${chunks.length}`)

  const first = chunks[0]
  assert.equal(first.start, 0)
  for (const chunk of chunks) {
    assert.equal(typeof chunk.text, 'string')
    assert.ok(chunk.text.length > 0, 'a chunk is never empty')
    // Boundary separator whitespace may sit inside the span but outside `text`.
    const span = source.slice(chunk.start, chunk.end)
    assert.ok(span.includes(chunk.text), 'the span carries the planned text')
    assert.equal(span.trim(), chunk.text, 'start/end are offsets of the planned text')
    assert.ok(chunk.text.length <= 2400, `default chunkChars is 2400, got ${chunk.text.length}`)
  }

  // Parts are ordered and tile the source: only boundary whitespace is dropped.
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].start >= chunks[index - 1].end, 'parts are ordered')
    assert.match(source.slice(chunks[index - 1].end, chunks[index].start), /^\s*$/, 'the gap between parts is whitespace only')
  }
  assert.match(source.slice(chunks.at(-1).end), /^\s*$/, 'nothing but whitespace is dropped after the last part')
})

test('planChunks is deterministic and does not depend on settings', () => {
  const source = makeLongText(12000)
  assert.deepEqual(planChunks(source), planChunks(source))
  assert.deepEqual(planChunks(source, {}), planChunks(source))
})

test('planChunks honours chunkChars and keeps every character accounted for', () => {
  const source = makeLongText(12000)
  const small = planChunks(source, { chunkChars: 1000 })
  const normal = planChunks(source)
  assert.ok(small.length > normal.length, 'a smaller chunkChars must plan more parts')
  for (const chunk of small) {
    assert.ok(chunk.text.length <= 1000, `chunkChars 1000 must not produce a ${chunk.text.length}-char part`)
    assert.equal(source.slice(chunk.start, chunk.end).trim(), chunk.text)
  }
  for (let index = 1; index < small.length; index += 1) {
    assert.match(source.slice(small[index - 1].end, small[index].start), /^\s*$/)
  }
  assert.equal(small[0].start, 0)
  assert.match(source.slice(small.at(-1).end), /^\s*$/)
})

test('planChunks keeps short text whole', () => {
  const short = 'The runner keeps retrying the request.'
  assert.deepEqual(planChunks(short), [{ text: short, start: 0, end: short.length }])
})
