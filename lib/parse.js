/**
 * Pure helpers for the model's structured output and for splitting long text.
 *
 * Everything here is dependency-free and synchronous so it can be unit tested
 * without a Harness or a model: the model may answer with fenced JSON, with
 * prose around the JSON, or with a plain translation, and the plugin must
 * never surface a parse failure to the user.
 */

const MAX_TERMS = 8
const DEFAULT_CHUNK_CHARS = 3000
const DEFAULT_MAX_CHUNKS = 3
// Planning default from the long-chain contract; the incremental route asks for
// smaller pieces than the legacy splitter ever did.
const DEFAULT_PLAN_CHUNK_CHARS = 2400

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Remove one surrounding Markdown code fence, when present. */
export function stripFences(value) {
  let result = String(value ?? '').trim()
  const fenced = /^```[A-Za-z0-9_+-]*\s*\n([\s\S]*?)\n?```$/.exec(result)
  if (fenced) result = fenced[1].trim()
  return result
}

function tryParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Read the first JSON object in the text, tolerating fences and prose. */
export function extractJson(value) {
  const body = stripFences(value)
  if (!body) return null
  const direct = tryParse(body)
  if (direct !== undefined) return direct
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const sliced = tryParse(body.slice(start, end + 1))
    if (sliced !== undefined) return sliced
  }
  return null
}

/** Coerce one model-supplied term into the shape the UI renders. */
export function normalizeTerms(input, limit = MAX_TERMS) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const terms = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const term = text(item.term ?? item.word ?? item.phrase)
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push({
      term,
      pos: text(item.pos ?? item.partOfSpeech ?? item.type),
      gloss: text(item.gloss ?? item.meaning ?? item.translation ?? item.zh),
      example: text(item.example ?? item.sentence),
    })
    if (terms.length >= limit) break
  }
  return terms
}

/**
 * Normalize a translation answer.
 * @returns {{translation: string, contextNote: string, terms: Array, structured: boolean}}
 */
export function parseTranslation(raw) {
  const json = extractJson(raw)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const translation = text(json.translation ?? json.text ?? json.zh ?? json.result)
    const contextNote = text(json.context ?? json.contextNote ?? json.meaning ?? json.note)
    const terms = normalizeTerms(json.terms ?? json.vocabulary ?? json.words)
    if (translation || terms.length) return { translation, contextNote, terms, structured: true }
  }
  // Fall back to the whole answer as the translation: a misuse of format is
  // not a failure the reader should see.
  return { translation: stripFences(raw), contextNote: '', terms: [], structured: false }
}

/**
 * Normalize a single-word explanation.
 * @returns {{meaning: string, usage: string, collocations: string[], example: string, structured: boolean}}
 */
export function parseExplain(raw) {
  const json = extractJson(raw)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const meaning = text(json.meaning ?? json.translation ?? json.gloss)
    const usage = text(json.usage ?? json.note ?? json.how)
    const collocations = Array.isArray(json.collocations)
      ? json.collocations.map((item) => text(item)).filter(Boolean).slice(0, 6)
      : []
    const example = text(json.example)
    if (meaning || usage || collocations.length || example) {
      return { meaning, usage, collocations, example, structured: true }
    }
  }
  return { meaning: stripFences(raw), usage: '', collocations: [], example: '', structured: false }
}

/**
 * Normalize a Chinese-to-English draft answer.
 * @returns {{english: string, notes: Array<{original: string, suggestion: string, reason: string}>, structured: boolean}}
 */
export function parseToEnglish(raw) {
  const json = extractJson(raw)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const english = text(json.english ?? json.translation ?? json.text ?? json.result)
    const notes = Array.isArray(json.notes)
      ? json.notes
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          original: text(item.original ?? item.from),
          suggestion: text(item.suggestion ?? item.to ?? item.fix),
          reason: text(item.reason ?? item.why ?? item.explain),
        }))
        .filter((item) => item.suggestion || item.reason)
        .slice(0, 4)
      : []
    if (english) return { english, notes, structured: true }
  }
  return { english: stripFences(raw), notes: [], structured: false }
}

/** True when the text is mostly Latin script and worth translating. */
export function needsTranslation(value) {
  const body = String(value ?? '')
  if (!body.trim()) return false
  const latin = (body.match(/[A-Za-z]/g) ?? []).length
  if (latin < 3) return false
  const cjk = (body.match(/[\u3400-\u9fff]/g) ?? []).length
  // Chinese text with an English identifier inside does not need translation.
  return latin >= cjk * 2
}

/**
 * Split source text into at most `maxChunks` pieces of about `chunkChars`,
 * preferring paragraph and sentence boundaries.
 */
export function splitChunks(value, { chunkChars = DEFAULT_CHUNK_CHARS, maxChunks = DEFAULT_MAX_CHUNKS } = {}) {
  const body = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (!body) return []
  const size = Math.max(500, Math.round(chunkChars))
  const limit = Math.max(1, Math.round(maxChunks))
  if (body.length <= size) return [body]

  const paragraphs = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const pieces = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      pieces.push(paragraph)
      continue
    }
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).filter(Boolean)
    let current = ''
    for (const sentence of sentences) {
      if (sentence.length > size) {
        if (current) { pieces.push(current); current = '' }
        for (let index = 0; index < sentence.length; index += size) pieces.push(sentence.slice(index, index + size))
        continue
      }
      if ((current + ' ' + sentence).trim().length > size) { pieces.push(current); current = sentence } else current = current ? `${current} ${sentence}` : sentence
    }
    if (current) pieces.push(current)
  }

  const chunks = []
  let current = ''
  for (const piece of pieces) {
    if (!current) { current = piece; continue }
    if ((current + '\n\n' + piece).length > size) { chunks.push(current); current = piece } else current = `${current}\n\n${piece}`
    if (chunks.length >= limit) break
  }
  if (current && chunks.length < limit) chunks.push(current)
  return chunks.length ? chunks : [body.slice(0, size)]
}

/**
 * Match the non-whitespace characters of `piece` inside `source` from `from`.
 * `splitChunks` may collapse separator whitespace when it re-joins paragraphs or
 * sentences, so only the characters themselves are compared.
 * @returns {{start: number, end: number}|null} `end` is exclusive.
 */
function locatePiece(source, piece, from) {
  let index = from
  let offset = 0
  let start = -1
  while (offset < piece.length) {
    const char = piece[offset]
    if (/\s/.test(char)) { offset += 1; continue }
    while (index < source.length && /\s/.test(source[index])) index += 1
    if (index >= source.length) return null
    if (source[index] !== char) return null
    if (start < 0) start = index
    index += 1
    offset += 1
  }
  return start < 0 ? null : { start, end: index }
}

/**
 * Plan deterministic translation chunks for a long text.
 *
 * Unlike `splitChunks`, the plan is never capped: every character of `value`
 * belongs to exactly one chunk, and the spans tile the source so a caller can
 * map a chunk back to what the reader sees. Whitespace at a chunk boundary may
 * be left out of `text` (the contract allows that), but the offsets stay
 * contiguous so progress and resume math never drift.
 *
 * @param {string} value Source text.
 * @param {{chunkChars?: number}} [options]
 * @returns {Array<{text: string, start: number, end: number}>}
 */
export function planChunks(value, { chunkChars = DEFAULT_PLAN_CHUNK_CHARS } = {}) {
  const source = String(value ?? '')
  const texts = splitChunks(source, { chunkChars, maxChunks: Number.MAX_SAFE_INTEGER })
  if (!texts.length) return []

  // Locate every chunk in the source in order; a whitespace-only gap between
  // two chunks is folded into the span that ends before it.
  const located = []
  let cursor = 0
  for (const text of texts) {
    const found = locatePiece(source, text, cursor)
    if (!found) {
      // Defensive: keep the plan monotonic even if a future splitter rewrites
      // characters instead of only whitespace.
      const end = Math.min(source.length, cursor + text.length)
      located.push({ start: cursor, end })
      cursor = end
      continue
    }
    located.push(found)
    cursor = found.end
  }

  return located.map((span, index) => ({
    text: texts[index],
    start: index === 0 ? 0 : located[index - 1].end,
    end: index === located.length - 1 ? source.length : span.end,
  }))
}
