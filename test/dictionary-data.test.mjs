/**
 * Verifier tests for the bundled data/dictionary.json.gz artifact.
 *
 * These read the real shipped artifact (no synthetic fixture) and assert the
 * contract documented in data/README.md:
 *   { v, built, sources, words: [[word, ipaUs, ipaUk, translation], ...], forms: {inflected -> base} }
 *
 * Sources and licences: ECDICT (https://github.com/skywind3000/ECDICT, MIT,
 * Copyright (c) 2025 Linwei) for Chinese senses + inflections; ipa-dict
 * en_US (https://github.com/open-dict-data/ipa-dict, MIT, derived from
 * cmudict-ipa) and en_UK (GPL-3.0, derived from ipacards) for the IPA. The
 * combined payload therefore ships as GPL-3.0-only; see THIRD-PARTY-NOTICES.md.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GZ_PATH = path.join(ROOT, 'data', 'dictionary.json.gz')
const META_PATH = path.join(ROOT, 'data', 'dictionary.meta.json')
const README_PATH = path.join(ROOT, 'data', 'README.md')

const WORD_SHAPE = /^[a-z][a-z'’.-]{0,38}$/
const IPA_SHAPE = /^\/[^/]+\/$/
const CJK = /[\u3400-\u9fff]/
const BAD_TEXT = /[\u0000\uFFFD]/

let cache = null
function load() {
  if (cache) return cache
  const gz = readFileSync(GZ_PATH)
  const json = gunzipSync(gz).toString('utf8')
  const payload = JSON.parse(json)
  cache = {
    gz,
    payload,
    words: payload.words,
    forms: payload.forms,
    byWord: new Map(payload.words.map((entry) => [entry[0], entry])),
    meta: JSON.parse(readFileSync(META_PATH, 'utf8')),
  }
  return cache
}

const SAMPLE_WORDS = ['state', 'apple', 'oriented', 'invoke', 'privilege', 'furious', 'concrete', 'syntax']

// ipa-dict en_UK marks primary stress *before the vowel nucleus* (state is
// "/stˈeɪt/"). The build moves every mark in front of the longest legal onset,
// so no shipped UK IPA may keep a mark after a legal onset that is followed by
// a vowel. Extracted here so the assertion is independent of the build code.
const VOWELS = new Set([...'aeiouæɑɒɐɛəɪɨɔʊʌɜɞɵɘɤœøɶɯʉyɚɝ'])
const DIACRITICS = new Set([...'ːˑ̩̃'])
const ONSETS = new Set([
  ...'pbtdkgfvθðszʃʒhmnŋlrjwɹɫçxɡ',
  ...['pɹ', 'bɹ', 'tɹ', 'dɹ', 'kɹ', 'ɡɹ', 'fɹ', 'θɹ', 'ʃɹ', 'tʃ', 'dʒ', 'pl', 'pr', 'pj', 'tw', 'tr', 'tj', 'kl', 'kr', 'kw', 'kj', 'bl', 'br', 'bj', 'dr', 'dj', 'dw', 'gl', 'gr', 'gw', 'fl', 'fr', 'fj', 'θw', 'sl', 'sw', 'sm', 'sn', 'sp', 'st', 'sk', 'sf', 'mj', 'nj', 'vj', 'hj', 'spj', 'stj', 'skj', 'skl', 'skw', 'spl', 'spr', 'str', 'skr', 'spɹ', 'stɹ', 'skɹ'],
])

function misplacedUkStress(uk) {
  for (let mark = 1; mark < uk.length; mark++) {
    if (uk[mark] !== 'ˈ') continue
    let start = mark
    while (start > 0) {
      const previous = uk[start - 1]
      if (VOWELS.has(previous) || DIACRITICS.has(previous) || previous === '/' || previous === '.') break
      start--
    }
    const run = uk.slice(start, mark)
    const next = uk[mark + 1]
    if (!run || !next || !VOWELS.has(next)) continue
    for (let length = Math.min(3, run.length); length >= 1; length--) {
      if (ONSETS.has(run.slice(run.length - length))) return run.slice(run.length - length)
    }
  }
  return null
}

test('产物可解压、可解析，且体积在 8 MB 预算内', () => {
  assert.ok(existsSync(GZ_PATH), `missing artifact: ${GZ_PATH}`)
  const { gz, payload } = load()
  assert.ok(gz.length > 0, 'dictionary.json.gz is empty')
  assert.ok(gz.length < 8 * 1024 * 1024, `dictionary.json.gz is ${(gz.length / 1048576).toFixed(2)} MB, budget is 8 MB`)
  assert.equal(typeof payload, 'object')
  assert.deepEqual(Object.keys(payload).sort(), ['built', 'forms', 'sources', 'v', 'words'])
})

test('顶层版本与来源声明正确（ECDICT MIT / en_US MIT / en_UK GPL-3.0）', () => {
  const { payload } = load()
  assert.equal(payload.v, 1, 'format version must be 1')
  assert.match(payload.built, /^\d{4}-\d{2}-\d{2}$/, 'built must be a YYYY-MM-DD date')

  assert.ok(Array.isArray(payload.sources) && payload.sources.length >= 3, 'sources must list every upstream data set')
  const allowed = new Set(['MIT', 'GPL-3.0-only'])
  for (const source of payload.sources) {
    assert.equal(typeof source.name, 'string')
    assert.ok(allowed.has(source.license), `${source.name} must declare MIT or GPL-3.0-only, got ${source.license}`)
    assert.match(source.url, /^https:\/\//, `${source.name} url must be an https link`)
    assert.equal(typeof source.copyright, 'string', `${source.name} must carry a copyright line`)
  }
  const names = payload.sources.map((source) => source.name)
  assert.ok(names.includes('ECDICT'), 'sources must name ECDICT')
  assert.ok(names.includes('ipa-dict'), 'sources must name ipa-dict')
  assert.ok(names.includes('ipa-dict (en_UK)'), 'sources must name the en_UK data separately')

  const ecdict = payload.sources.find((source) => source.name === 'ECDICT')
  assert.equal(ecdict.license, 'MIT')
  assert.match(ecdict.copyright ?? '', /Linwei/, 'ECDICT copyright holder must be named')
  const british = payload.sources.find((source) => source.name === 'ipa-dict (en_UK)')
  assert.equal(british.license, 'GPL-3.0-only', 'British IPA is GPL-3.0, so the payload as a whole is GPL-3.0-only')
  assert.match(british.copyright ?? '', /ipacards/)

  const urls = payload.sources.map((source) => source.url).join(' ')
  assert.match(urls, /github\.com\/skywind3000\/ECDICT/)
  assert.match(urls, /github\.com\/open-dict-data\/ipa-dict/)
})

test('words 每条都是 [word, ipaUs, ipaUk, translation] 四元组字符串', () => {
  const { words, forms } = load()
  assert.ok(Array.isArray(words))
  for (const entry of words) {
    assert.ok(Array.isArray(entry) && entry.length === 4, `bad tuple: ${JSON.stringify(entry)?.slice(0, 120)}`)
    for (const field of entry) assert.equal(typeof field, 'string', `non-string field in ${entry[0]}`)
  }
  assert.equal(typeof forms, 'object', 'forms must be an object')
  assert.equal(Array.isArray(forms), false, 'forms must be a plain object, not an array')
})

test('规模满足契约：words > 50000，forms > 20000', () => {
  const { words, forms } = load()
  assert.ok(words.length > 50000, `words has ${words.length}, expected > 50000`)
  const formKeys = Object.keys(forms)
  assert.ok(formKeys.length > 20000, `forms has ${formKeys.length}, expected > 20000`)
})

test('words 全部小写、无空白/点号、词形合法、严格升序且无重复', () => {
  const { words } = load()
  const offenders = []
  let sorted = true
  let previous = ''
  for (const [word] of words) {
    if (!WORD_SHAPE.test(word)) offenders.push(`shape:${JSON.stringify(word)}`)
    if (word !== word.toLowerCase()) offenders.push(`case:${word}`)
    if (/\s/.test(word)) offenders.push(`space:${word}`)
    // Dotted abbreviations (a.m./e.g.) can never be produced by the client's
    // tokenizer, so the build drops them; none may sneak back in.
    if (word.includes('.')) offenders.push(`dot:${word}`)
    if (word <= previous) sorted = false
    previous = word
    if (offenders.length > 10) break
  }
  assert.deepEqual(offenders, [], `invalid words: ${offenders.slice(0, 10).join(', ')}`)
  assert.equal(sorted, true, 'words must be sorted ascending with no duplicates')
})

test('释义全部是中文、非空、无 U+FFFD / NUL 等乱码字符', () => {
  const { words } = load()
  const bad = []
  for (const [word, , , translation] of words) {
    if (!translation) { bad.push(`empty:${word}`); continue }
    if (BAD_TEXT.test(translation)) bad.push(`badchar:${word}`)
    if (translation !== translation.trim()) bad.push(`spaces:${word}`)
    if (!CJK.test(translation)) bad.push(`no-cjk:${word}`)
    if (bad.length > 10) break
  }
  assert.deepEqual(bad, [], `bad translations: ${bad.join(', ')}`)
})

test('多行释义使用真实换行符，且不超出行数/行长上限', () => {
  const { words } = load()
  const literal = words.filter((entry) => entry[3].includes('\\n'))
  assert.deepEqual(literal.slice(0, 10).map((entry) => entry[0]), [], `${literal.length} translations still carry a literal backslash-n`)
  const blank = words.filter((entry) => entry[3].includes('\n\n'))
  assert.deepEqual(blank.slice(0, 10).map((entry) => entry[0]), [], `${blank.length} translations contain a blank line`)
  for (const [word, , , translation] of words) {
    const lines = translation.split('\n')
    assert.ok(lines.length <= 5, `${word} has ${lines.length} sense lines (build caps at 5)`)
    for (const sense of lines) assert.ok(sense.length <= 200, `${word} has a ${sense.length}-char sense line`)
  }
  const multi = words.filter((entry) => entry[3].includes('\n'))
  assert.ok(multi.length > 1000, `expected many multi-sense entries, found ${multi.length}`)
  const state = load().byWord.get('state')
  assert.ok(state, 'missing sample word: state')
  assert.ok(state[3].includes('\n'), 'state should carry several newline-separated senses')
})

test('抽样常用词存在，释义为非空中文', () => {
  const { byWord } = load()
  for (const word of SAMPLE_WORDS) {
    const entry = byWord.get(word)
    assert.ok(entry, `missing sample word: ${word}`)
    assert.ok(entry[3].trim().length > 0, `${word} has an empty translation`)
    assert.match(entry[3], CJK, `${word} translation is not Chinese: ${entry[3].slice(0, 60)}`)
  }
})

test('不规则形式已作为独立词条收录（were/gotten/went 等）', () => {
  const { byWord } = load()
  const expected = {
    were: 'be',
    got: 'get',
    gotten: 'get',
    went: 'go',
    ran: 'run',
    been: 'be',
    was: 'be',
    is: 'be',
    am: 'be',
    children: 'child',
    better: 'good',
  }
  for (const [word] of Object.entries(expected)) {
    const entry = byWord.get(word)
    assert.ok(entry, `missing irregular headword: ${word}`)
    assert.match(entry[3], CJK, `${word} must carry a Chinese gloss`)
  }
  for (const word of ['were', 'gotten', 'been', 'went', 'ran']) {
    assert.match(byWord.get(word)[3], /的过去(式|分词)|的现在式/, `${word} gloss should name the inflection`)
  }
})

test('抽样词条 US / UK 音标均为 /.../ 形态', () => {
  const { byWord } = load()
  for (const word of SAMPLE_WORDS) {
    const entry = byWord.get(word)
    assert.ok(entry, `missing sample word: ${word}`)
    assert.match(entry[1], IPA_SHAPE, `${word} US IPA is malformed: ${JSON.stringify(entry[1])}`)
    assert.match(entry[2], IPA_SHAPE, `${word} UK IPA is malformed: ${JSON.stringify(entry[2])}`)
  }
})

test('全部 US / UK 音标闭合为 /.../，UK 无多主重音、无残留错位重音', () => {
  const { words } = load()
  const badUs = words.filter((entry) => entry[1] && !IPA_SHAPE.test(entry[1]))
  const badUk = words.filter((entry) => entry[2] && !IPA_SHAPE.test(entry[2]))
  assert.deepEqual(badUs.slice(0, 10).map((entry) => `${entry[0]}:${entry[1]}`), [], `${badUs.length} malformed US IPA entries`)
  assert.deepEqual(badUk.slice(0, 10).map((entry) => `${entry[0]}:${entry[2]}`), [], `${badUk.length} malformed UK IPA entries`)

  const multiMark = words.filter((entry) => (entry[2].match(/ˈ/g) || []).length > 1)
  assert.deepEqual(multiMark.slice(0, 10).map((entry) => `${entry[0]}:${entry[2]}`), [], `${multiMark.length} UK entries keep more than one primary stress`)

  const offenders = []
  for (const [word, , uk] of words) {
    if (!uk) continue
    const run = misplacedUkStress(uk)
    if (run) offenders.push(`${word}:${uk} (before ${run})`)
  }
  assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} UK entries keep the source's misplaced stress, e.g. ${offenders.slice(0, 10).join(', ')}`)

  const the = load().byWord.get('the')
  assert.ok(the, 'missing word: the')
  assert.equal(the[2], '/ðə/', 'the UK IPA must be the first complete variant (/ðə/), not an unclosed /ðə')
  assert.ok(the[2].endsWith('/'), 'the UK IPA must end with a slash')
})

test('UK 重音已从源数据的「元音核前」修正到音节起始（抽查 16 个常用词）', () => {
  const expected = {
    state: '/ˈsteɪt/',
    chocolate: '/ˈtʃɒklət/',
    vegetable: '/ˈvɛdʒɪtəbəl/',
    temperature: '/ˈtɛmpɹɪtʃɐ/',
    restaurant: '/ˈɹɛstɹɒnt/',
    notebook: '/ˈnəʊtbʊk/',
    homesick: '/ˈhəʊmsɪk/',
    birthday: '/ˈbɜːθdeɪ/',
    football: '/ˈfʊtbɔːl/',
    blackboard: '/ˈblækbɔːd/',
    comfortable: '/ˈkʌmftəbəl/',
    photography: '/fəˈtɒɡɹəfi/',
    extraordinary: '/ɛkˈstɹɔːdɪnəɹi/',
    angulation: '/ænɡjʊˈleɪʃən/',
    anticipation: '/æntɪsɪˈpeɪʃən/',
    congratulation: '/kənɡɹætʃʊˈleɪʃən/',
  }
  const { byWord } = load()
  for (const [word, ipa] of Object.entries(expected)) {
    const entry = byWord.get(word)
    assert.ok(entry, `missing UK-IPA sample word: ${word}`)
    assert.equal(entry[2], ipa, `UK IPA for "${word}" is not the corrected form`)
  }
})

test('forms 每条是 纯小写屈折形式 -> words 内原形，不自映射、不含点号', () => {
  const { forms, byWord } = load()
  const bad = []
  for (const [form, base] of Object.entries(forms)) {
    if (!WORD_SHAPE.test(form)) bad.push(`shape:${form}`)
    if (form.includes('.')) bad.push(`dot:${form}`)
    if (/\s/.test(form)) bad.push(`space:${form}`)
    if (form !== form.toLowerCase() || base !== base.toLowerCase()) bad.push(`case:${form}`)
    if (form === base) bad.push(`self:${form}`)
    if (!byWord.has(base)) bad.push(`missing-base:${form}->${base}`)
    // A form that also exists as its own headword is unreachable (exact match wins).
    if (byWord.has(form)) bad.push(`shadowed:${form}`)
    if (bad.length > 10) break
  }
  assert.deepEqual(bad, [], `invalid forms: ${bad.slice(0, 10).join(', ')}`)
})

test('forms 屈折反查抽查正确（独立词条走精确路径）', () => {
  const { forms, byWord } = load()
  const expected = {
    mice: 'mouse',
    invoked: 'invoke',
    boxes: 'box',
    happier: 'happy',
    happiest: 'happy',
    bought: 'buy',
    wolves: 'wolf',
    tomatoes: 'tomato',
    asked: 'ask',
  }
  for (const [form, base] of Object.entries(expected)) {
    assert.equal(forms[form], base, `forms["${form}"] should be "${base}"`)
  }
  // These irregulars are shipped as real headwords now, which is the better
  // path (exact lookup returns their own gloss); they must not be in forms.
  for (const word of ['ran', 'went', 'were', 'gotten', 'children', 'better', 'made', 'running', 'states', 'studies', 'played']) {
    assert.ok(byWord.has(word), `${word} must exist as its own entry`)
    assert.equal(forms[word], undefined, `${word} must not also sit in forms (unreachable)`)
  }
})

test('随机 30 条词条：释义非空、无乱码', () => {
  const { words } = load()
  // Seeded LCG so the sample is random but reproducible.
  let seed = 42
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const picked = new Set()
  while (picked.size < 30) picked.add(Math.floor(random() * words.length))
  for (const index of picked) {
    const [word, , , translation] = words[index]
    assert.ok(translation.trim().length > 0, `empty translation at ${index}: ${word}`)
    assert.doesNotMatch(translation, BAD_TEXT, `garbled translation at ${index}: ${word}`)
  }
})

test('dictionary.meta.json 与产物逐字段一致', () => {
  const { payload, words, forms, gz, meta } = load()
  assert.equal(meta.v, payload.v)
  assert.equal(meta.built, payload.built)
  assert.equal(meta.license, 'GPL-3.0-only', 'meta.json must state the data licence, not the code licence')
  assert.equal(meta.words, words.length)
  assert.equal(meta.forms, Object.keys(forms).length)
  assert.equal(meta.ipa, words.filter((entry) => entry[1]).length)
  assert.equal(meta.ipaUk, words.filter((entry) => entry[2]).length)
  assert.equal(meta.bytes, gz.length)
  assert.match(meta.built, /^\d{4}-\d{2}-\d{2}$/)
})

test('IPA 覆盖率没有明显回退（US >= 65%，UK >= 60%，至少一档 >= 78%）', () => {
  const { words } = load()
  const us = words.filter((entry) => entry[1]).length / words.length
  const uk = words.filter((entry) => entry[2]).length / words.length
  const any = words.filter((entry) => entry[1] || entry[2]).length / words.length
  assert.ok(us >= 0.65, `US IPA coverage dropped to ${(us * 100).toFixed(1)}%`)
  assert.ok(uk >= 0.6, `UK IPA coverage dropped to ${(uk * 100).toFixed(1)}%`)
  assert.ok(any >= 0.78, `overall IPA coverage dropped to ${(any * 100).toFixed(1)}%`)
})

test('data/README.md 记录来源、许可、文件说明与当前规模', () => {
  assert.ok(existsSync(README_PATH), 'data/README.md is missing')
  const readme = readFileSync(README_PATH, 'utf8')
  for (const needle of ['dictionary.json.gz', 'dictionary.meta.json', 'ECDICT', 'ipa-dict', 'MIT', 'GPL-3.0', 'THIRD-PARTY-NOTICES']) {
    assert.ok(readme.includes(needle), `data/README.md does not mention ${needle}`)
  }
  assert.match(readme, /github\.com\/skywind3000\/ECDICT/)
  assert.match(readme, /github\.com\/open-dict-data\/ipa-dict/)
  const { words, forms } = load()
  const wordCount = String(words.length)
  const formCount = String(Object.keys(forms).length)
  assert.ok(readme.includes(wordCount) || readme.includes(Number(wordCount).toLocaleString('en-US')), `data/README.md must quote the current word count (${wordCount})`)
  assert.ok(readme.includes(formCount) || readme.includes(Number(formCount).toLocaleString('en-US')), `data/README.md must quote the current forms count (${formCount})`)
})
