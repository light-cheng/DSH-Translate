/**
 * Prompt contracts.
 *
 * Both answers are strict JSON so one model call can carry the translation and
 * the learning material; `lib/parse.js` tolerates a model that ignores that.
 */

const LANGUAGE_NAMES = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
}

export function languageName(targetLanguage) {
  const key = String(targetLanguage ?? '').trim()
  return LANGUAGE_NAMES[key] ?? (/^zh/i.test(key) ? 'Simplified Chinese' : key || 'Simplified Chinese')
}

const TRANSLATION_SYSTEM = [
  'You help a Chinese-speaking software engineer read English while programming.',
  'Answer with one JSON object and nothing else: no prose, no markdown fence.',
  'Keep code identifiers, file paths, CLI flags, API names, numbers and URLs exactly as written.',
].join(' ')

/**
 * One instruction for a chunk that is part of a longer text. The head chunk
 * still carries the context and the vocabulary request; every later chunk is
 * told to translate its own segment only, so a small model never summarizes
 * the whole chain from one piece of it.
 */
function segmentNote(part) {
  if (!part || !Number.isFinite(part.count) || part.count <= 1) return ''
  const position = Number.isFinite(part.index) ? part.index + 1 : 1
  return `- This is segment ${position}/${part.count} of one long text: translate only this segment, keep its own line breaks, and never summarize or merge text across segments.`
}

export function translationPrompt({ text, context, targetLanguage, mode, part }) {
  const language = languageName(targetLanguage)
  const lines = [
    `Translate the English below into ${language}.`,
    'Then explain what it means in this exact context, and list 3-6 English items a Chinese developer would benefit from learning.',
    '',
    'JSON shape:',
    '{"translation":"<the translation>","context":"<one or two sentences in Chinese: what this means here and why it is phrased this way>","terms":[{"term":"<English word or short phrase from the text>","pos":"<n. / v. / adj. / phr.>","gloss":"<Chinese gloss>","example":"<a short fragment copied from the text>"}]}',
    '',
    'Rules:',
    '- "translation" keeps the original line breaks and never summarizes.',
    '- "terms" only contains items that actually appear in the text; "example" is copied, never invented.',
    '- Vocabulary that is only a code identifier is not a learning term.',
  ]
  const note = segmentNote(part)
  if (note) lines.push(note)
  if (mode === 'selection') lines.push('- The text is one selection from a longer message: use the surrounding context to resolve pronouns and intent.')
  if (context) {
    lines.push('', 'Surrounding context (do not translate it):', '<<<', String(context).slice(0, 2000), '>>>')
  }
  lines.push('', 'Text to translate:', '<<<', text, '>>>')
  return { system: TRANSLATION_SYSTEM, user: lines.join('\n') }
}

/**
 * Prompt for segments after the first one: only the translation is requested,
 * because context and vocabulary come from the opening segment. Asking for
 * less output saves tokens and keeps the answer well inside the output limit.
 */
export function translationBodyPrompt({ text, targetLanguage, part }) {
  const language = languageName(targetLanguage)
  const lines = [
    `Translate the English below into ${language}.`,
    '',
    'JSON shape:',
    '{"translation":"<the translation>"}',
    '',
    'Rules:',
    '- "translation" keeps the original line breaks and never summarizes.',
    '- Keep code identifiers, file paths, CLI flags, API names, numbers and URLs exactly as written.',
  ]
  const note = segmentNote(part)
  if (note) lines.push(note)
  lines.push('', 'Text to translate:', '<<<', text, '>>>')
  return { system: TRANSLATION_SYSTEM, user: lines.join('\n') }
}

const EXPLAIN_SYSTEM = [
  'You explain one English term to a Chinese-speaking software engineer.',
  'Answer with one JSON object and nothing else: no prose, no markdown fence.',
  'Be concrete and brief; never invent context that the supplied gloss does not support.',
].join(' ')

export function explainPrompt({ term, pos, gloss, example, targetLanguage }) {
  const language = languageName(targetLanguage)
  const lines = [
    `Explain the English ${pos ? `${pos} ` : ''}term "${term}" as this reader saved it.`,
    `Write every Chinese field in ${language}.`,
    '',
    'JSON shape:',
    '{"meaning":"<one sentence: what it means here>","usage":"<1-2 sentences: how it is used, and what it is usually confused with>","collocations":["<2-4 short English collocations or patterns>"],"example":"<one natural English sentence using it>"}',
    '',
    'Rules:',
    '- "meaning" is fully Chinese; keep the term itself in English.',
    '- "collocations" stay in English, at most 4.',
    '- If the saved gloss already fixes the meaning, do not contradict it.',
  ]
  if (gloss) lines.push('', `Saved gloss: ${gloss}`)
  if (example) lines.push(`Saved fragment: ${example}`)
  return { system: EXPLAIN_SYSTEM, user: lines.join('\n') }
}

const TO_ENGLISH_SYSTEM = [
  'You turn a Chinese draft into natural English for a software engineer.',
  'Answer with one JSON object and nothing else: no prose, no markdown fence.',
  'Keep code identifiers, file paths, CLI flags, API names, numbers and URLs exactly as written.',
].join(' ')

export function toEnglishPrompt({ text, targetLanguage }) {
  const language = languageName(targetLanguage)
  const lines = [
    'Rewrite the Chinese draft below as the English message the author wants to send.',
    'The rewrite IS the message: keep every requirement, code fragment and number, and add nothing.',
    `Write the notes in ${language} so the author learns something from the change.`,
    '',
    'JSON shape:',
    '{"english":"<the English message>","notes":[{"original":"<Chinese fragment>","suggestion":"<the English you chose>","reason":"<short explanation of a grammar or usage point>"}]}',
    '',
    'Rules:',
    '- 0-3 notes, only for points worth learning.',
    '- Do not translate code fences or inline code.',
    '- If the draft is already mostly English, return it unchanged with no notes.',
    '',
    'Draft:',
    '<<<',
    text,
    '>>>',
  ]
  return { system: TO_ENGLISH_SYSTEM, user: lines.join('\n') }
}
