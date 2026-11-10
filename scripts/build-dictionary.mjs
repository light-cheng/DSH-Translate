/**
 * Build the bundled English→Chinese dictionary for dsh-translate.
 *
 * Sources and licences (the resulting data file is GPL-3.0-only):
 *   - ECDICT by skywind3000 — MIT, Copyright (c) 2025 Linwei. Chinese
 *     translations, exam / Collins / Oxford flags, BNC/COCA frequency ranks and
 *     an `exchange` table of inflected forms.
 *     https://github.com/skywind3000/ECDICT
 *   - ipa-dict by open-dict-data / dohliam — real IPA for en_US and en_GB
 *     (ECDICT's own `phonetic` column is an ASCII approximation, so it is not
 *     used for display). https://github.com/open-dict-data/ipa-dict
 *       * en_US is MIT, in turn derived from cmudict-ipa by Lingliang Zhang.
 *       * en_UK is GPL-3.0: ipa-dict credits "English (UK) IPA data derived
 *         from ipacards by @leoboiko (GPL 3.0)".
 *     Because the British data is GPL-3.0, the combined payload this script
 *     writes is GPL-3.0-only. The plugin code stays MIT; see
 *     THIRD-PARTY-NOTICES.md for the attribution and the corresponding source.
 *
 * Inputs are cached under tmp/, the trimmed artifact is written to
 * data/dictionary.json.gz as { v, built, sources, words, forms } where
 * `words` is [word, ipaUs, ipaUk, translation] tuples and `forms` maps an
 * inflected form to its base word.
 *
 * Usage: node scripts/build-dictionary.mjs [--entries 60000]
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, 'tmp')
const OUT_DIR = path.join(ROOT, 'data')
const ECDICT_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
const IPA_US_URL = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt'
const IPA_UK_URL = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt'

const ECDICT_CSV = path.join(TMP, 'ecdict.csv')
const IPA_US_TXT = path.join(TMP, 'ipa-en_US.txt')
const IPA_UK_TXT = path.join(TMP, 'ipa-en_UK.txt')

/** How many extra non-exam words to take by frequency rank. */
const DEFAULT_BUDGET = 60000
/** Lines of Chinese senses kept per word. */
const MAX_SENSE_LINES = 5
const MAX_SENSE_CHARS = 200

const WORD_SHAPE = /^[a-z][a-z'’.-]{0,38}$/i
/** Translation lines that carry no readable meaning for a learner. */
const USELESS_LINE = /^[（(]?\s*(网络|网络释义|人名|地名|公司名|商标)\s*[）)]?$/
/** A usable gloss has at least one CJK character; ECDICT has English-only rows. */
const CJK = /[\u3400-\u9fff]/
/** Irregular forms are listed as their own row, e.g. "was" -> "be的过去式". */
const INFLECTION_NOTE = /^([a-z][a-z'’-]{0,30})的(过去式|过去分词|现在式|现在分词|复数|第三人称单数|比较级|最高级)/

// ---- ipa-dict en_UK stress repair -----------------------------------------
//
// The BEEP-derived UK file marks stress *before the vowel nucleus* rather than
// at the syllable onset: state is "/stˈeɪt/" instead of "/ˈsteɪt/". That is
// wrong for a learner to read, so move each primary stress mark in front of
// the longest consonant run that is a legal English onset. Secondary stress
// marks are less reliable still (photography: "/fətˈɒɡɹəfˌi/"), so they are
// dropped from the shipped UK IPA.
const VOWEL = new Set([...'aeiouæɑɒɐɛəɪɨɔʊʌɜɞɵɘɤœøɶɯʉyɚɝ'])
const DIACRITIC = new Set([...'ːˑ̩̃'])
const ONSETS = new Set([
  ...'pbtdkgfvθðszʃʒhmnŋlrjwɹɫçxɡ'.split(''),
  ...['pɹ', 'bɹ', 'tɹ', 'dɹ', 'kɹ', 'ɡɹ', 'fɹ', 'θɹ', 'ʃɹ', 'tʃ', 'dʒ', 'pl', 'pr', 'pj', 'tw', 'tr', 'tj', 'kl', 'kr', 'kw', 'kj', 'bl', 'br', 'bj', 'dr', 'dj', 'dw', 'gl', 'gr', 'gw', 'fl', 'fr', 'fj', 'θw', 'sl', 'sw', 'sm', 'sn', 'sp', 'st', 'sk', 'sf', 'ʃr', 'ʃw', 'mj', 'nj', 'vj', 'hj', 'kw', 'spj', 'stj', 'skj', 'skl', 'skw'],
  ...['spl', 'spr', 'spɹ', 'str', 'stɹ', 'skr', 'skɹ'],
])
const isIpaConsonant = (ch) => Boolean(ch) && !VOWEL.has(ch) && !DIACRITIC.has(ch) && !'/ˈˌ. '.includes(ch)

function normalizeUkIpa(raw) {
  // Drop the unreliable secondary stress first, then move every primary mark
  // onto a legal onset. Moving a mark only reorders characters inside its own
  // onset, so the length is unchanged and later mark positions stay valid.
  let text = String(raw ?? '').replace(/ˌ/g, '')
  const marks = []
  for (let i = 0; i < text.length; i++) if (text[i] === 'ˈ') marks.push(i)
  for (const mark of marks) {
    let start = mark
    while (start > 0 && isIpaConsonant(text[start - 1])) start--
    const run = text.slice(start, mark)
    if (!run) continue
    for (let len = Math.min(3, run.length); len >= 1; len--) {
      if (!ONSETS.has(run.slice(run.length - len))) continue
      text = `${text.slice(0, mark - len)}ˈ${text.slice(mark - len, mark)}${text.slice(mark + 1)}`
      break
    }
  }
  // Some rows carry a primary mark on the stem *and* one on the stressed
  // syllable (angulation: "/ˈænɡjʊlˈeɪʃən/"); the last one is the real stress.
  const kept = []
  for (let i = 0; i < text.length; i++) if (text[i] === 'ˈ') kept.push(i)
  if (kept.length > 1) {
    const last = kept[kept.length - 1]
    text = [...text].filter((ch, i) => ch !== 'ˈ' || i === last).join('')
  }
  return text
}

function parseArgs(argv) {
  const options = { entries: DEFAULT_BUDGET }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--entries' && argv[i + 1]) options.entries = Math.max(1000, Number(argv[++i]) || DEFAULT_BUDGET)
  }
  return options
}

async function download(url, file) {
  if (existsSync(file) && readFileSync(file, 'utf8').length > 1000) return file
  mkdirSync(path.dirname(file), { recursive: true })
  process.stdout.write(`downloading ${url}\n`)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`GET ${url} -> ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file))
  process.stdout.write(`  saved ${file} (${(readFileSync(file).length / 1048576).toFixed(1)} MB)\n`)
  return file
}

/** One pass CSV parser that honours quoted fields and embedded newlines. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** ECDICT exchange syntax: s:states/p:stated/d:stated/3:states/i:stating */
function parseExchange(value) {
  const out = new Map()
  const text = String(value ?? '')
  if (!text) return out
  for (const part of text.split('/')) {
    const at = part.indexOf(':')
    if (at <= 0) continue
    out.set(part.slice(0, at), part.slice(at + 1).trim())
  }
  return out
}

/** ipa-dict lines: "word\t/ipa/, /ipa2/" -> first variant, with its slashes. */
function readIpa(file) {
  const map = new Map()
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return map }
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const word = line.slice(0, tab).trim().toLowerCase()
    const raw = line.slice(tab + 1).trim()
    // `/ðə, ði/` must stay one group: splitting on commas first would truncate
    // it to `/ðə` and drop the closing slash.
    const group = raw.match(/\/([^/]*)\//)
    const ipa = group ? `/${group[1].split(',')[0].trim()}/` : ''
    if (word && ipa !== '//') map.set(word, ipa)
  }
  return map
}

/**
 * ECDICT stores sense breaks as a literal `\n` in most rows and as a real
 * newline in others, so both must split here (a literal one would otherwise be
 * rendered as backslash-n inside a card).
 */
function cleanTranslation(raw) {
  const lines = []
  for (const piece of String(raw ?? '').split(/\\n|\r?\n/)) {
    const line = piece.replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (USELESS_LINE.test(line)) continue
    if (line.length > MAX_SENSE_CHARS) continue
    lines.push(line)
    if (lines.length >= MAX_SENSE_LINES) break
  }
  const text = lines.join('\n')
  return CJK.test(text) ? text : ''
}

/** The base word a row is an inflected form of, if ECDICT says so. */
function lemmaOfRow(row) {
  const lemma = parseExchange(row[10]).get('0')
  if (lemma) return lemma.toLowerCase().trim()
  const note = String(row[3] ?? '').match(INFLECTION_NOTE)
  return note ? note[1].toLowerCase() : ''
}

function frequencyRank(bnc, frq) {
  const b = Number(bnc) > 0 ? Number(bnc) : Infinity
  const f = Number(frq) > 0 ? Number(frq) : Infinity
  return Math.min(b, f)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await download(ECDICT_URL, ECDICT_CSV)
  await download(IPA_US_URL, IPA_US_TXT)
  await download(IPA_UK_URL, IPA_UK_TXT)

  const ipaUs = readIpa(IPA_US_TXT)
  const ipaUk = readIpa(IPA_UK_TXT)
  process.stdout.write(`ipa-dict: ${ipaUs.size} US / ${ipaUk.size} UK\n`)

  const text = readFileSync(ECDICT_CSV, 'utf8')
  const rows = parseCsv(text)
  const header = rows.shift()
  if (!header || header[0] !== 'word') throw new Error(`unexpected ECDICT header: ${header?.slice(0, 4)}`)
  process.stdout.write(`ecdict: ${rows.length} rows\n`)

  // ---- pass 1: index every row by lower-case word (first wins)
  const index = new Map()
  for (const row of rows) {
    const word = String(row[0] ?? '').trim()
    if (!word) continue
    const key = word.toLowerCase()
    if (!index.has(key)) index.set(key, row)
  }
  process.stdout.write(`ecdict index: ${index.size} unique lowercase words\n`)

  // Irregular forms ("was", "were", "is", "been", "gotten", …) are their own
  // ECDICT rows with a short Chinese note. They often lack a BNC/COCA rank, so
  // the frequency cut below never reaches them; pull in every row that ECDICT
  // marks as an inflection of a selected word instead.
  const lemmas = new Map()
  for (const [key, row] of index) {
    const lemma = lemmaOfRow(row)
    if (lemma && lemma !== key) lemmas.set(key, lemma)
  }

  // ---- selection
  const tagged = []
  const collins = []
  const frequent = []
  const ranks = []
  for (const [key, row] of index) {
    // Dotted abbreviations ("a.m.", "e.g.") can never reach the lookup table:
    // a query is a single letter/digit/apostrophe/hyphen token.
    if (key.includes('.')) continue
    if (!WORD_SHAPE.test(key)) continue
    if (!cleanTranslation(row[3])) continue
    if (String(row[7] ?? '').trim()) tagged.push(key)
    if (Number(row[5]) > 0 || String(row[6]).trim() === '1') collins.push(key)
    ranks.push([frequencyRank(row[8], row[9]), key])
  }
  ranks.sort((a, b) => a[0] - b[0])
  for (const [rank, key] of ranks) {
    // Rows without a BNC/COCA rank tie at Infinity; they are rare words that
    // must not fill the frequency budget (they are usually acronyms).
    if (!Number.isFinite(rank)) break
    if (frequent.length >= options.entries) break
    frequent.push(key)
  }

  const selected = new Set()
  for (const key of tagged) selected.add(key)
  for (const key of collins) selected.add(key)
  for (const key of frequent) selected.add(key)

  let inflections = 0
  for (const [key, lemma] of lemmas) {
    if (selected.has(key)) continue
    if (!selected.has(lemma)) continue
    if (!WORD_SHAPE.test(key)) continue
    // Only irregular rows get promoted to entries of their own ("was", "mice");
    // regular forms ("states", "invoked") stay in `forms` and fall back to the
    // base entry, which keeps the payload small.
    const row = index.get(key)
    if (!INFLECTION_NOTE.test(String(row[3] ?? ''))) continue
    if (!cleanTranslation(row[3])) continue
    selected.add(key)
    inflections++
  }

  const words = []
  let withIpa = 0
  let withUk = 0
  for (const key of selected) {
    const row = index.get(key)
    const translation = cleanTranslation(row[3])
    if (!translation) continue
    const us = ipaUs.get(key) ?? ''
    const uk = normalizeUkIpa(ipaUk.get(key) ?? '')
    if (us) withIpa++
    if (uk) withUk++
    words.push([key, us, uk, translation])
  }
  words.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  // ---- inflected form -> base word (only forms that are not their own entry)
  const wordSet = new Set(words.map((entry) => entry[0]))
  const forms = {}
  const addForm = (rawForm, base) => {
    const form = String(rawForm ?? '').trim().toLowerCase()
    if (!WORD_SHAPE.test(form) || form === base || wordSet.has(form)) return
    if (form in forms) return
    const row = index.get(form)
    if (!row || !cleanTranslation(row[3])) return
    forms[form] = base
  }
  for (const key of selected) {
    for (const form of parseExchange(index.get(key)[10]).values()) addForm(form, key)
  }
  for (const [form, lemma] of lemmas) {
    if (selected.has(lemma)) addForm(form, lemma)
  }
  // "am" is absent from ECDICT entirely; it is still worth mapping to "be".
  for (const [form, base] of Object.entries({ am: 'be' })) {
    if (!selected.has(base) || wordSet.has(form)) continue
    if (!(form in forms)) forms[form] = base
  }
  const formCount = Object.keys(forms).length

  const payload = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    sources: [
      {
        name: 'ECDICT',
        license: 'MIT',
        url: 'https://github.com/skywind3000/ECDICT',
        copyright: 'Copyright (c) 2025 Linwei',
      },
      {
        name: 'ipa-dict',
        license: 'MIT',
        url: 'https://github.com/open-dict-data/ipa-dict',
        copyright: 'Copyright (c) 2016 dohliam',
        note: 'en_US only; derived from cmudict-ipa (MIT, Copyright (c) 2016 Lingliang Zhang)',
      },
      {
        name: 'ipa-dict (en_UK)',
        license: 'GPL-3.0-only',
        url: 'https://github.com/open-dict-data/ipa-dict',
        copyright: 'ipacards by leoboiko, GPL-3.0',
        note: 'British IPA; this source is why the bundled data file as a whole is GPL-3.0-only',
      },
    ],
    words,
    forms,
  }
  const json = JSON.stringify(payload)
  const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 9 })
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path.join(OUT_DIR, 'dictionary.json.gz'), gz)
  writeFileSync(
    path.join(OUT_DIR, 'dictionary.meta.json'),
    `${JSON.stringify({ v: 1, built: payload.built, license: 'GPL-3.0-only', words: words.length, forms: formCount, ipa: withIpa, ipaUk: withUk, bytes: gz.length }, null, 2)}\n`,
  )

  process.stdout.write(
    `\nselected ${words.length} words (tagged ${tagged.length}, collins/oxford ${collins.length}, frequent ${frequent.length}, inflections +${inflections})\n` +
      `ipa coverage: ${withIpa} US / ${withUk} UK  (${((withIpa / words.length) * 100).toFixed(1)}%)\n` +
      `inverse forms: ${formCount}\n` +
      `json ${(json.length / 1048576).toFixed(2)} MB -> gz ${(gz.length / 1048576).toFixed(2)} MB\n`,
  )
}

main().catch((error) => {
  console.error('build-dictionary failed:', error)
  process.exitCode = 1
})
