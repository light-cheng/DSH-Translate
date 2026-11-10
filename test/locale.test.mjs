/**
 * The browser half carries its own zh/en locale tables in client.js, separate
 * from the locale/*.json files the Plugin Manager reads. Both tables must hold
 * exactly the same keys, and every key the UI asks for must be present in both
 * (AGENTS.md invariant). A key that exists in only one table shows the raw key
 * to users of the other language, which no test used to catch.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(ROOT, 'client.js'), 'utf8')
const lines = source.split(/\r?\n/)

/** Collect the flat `'key': 'value'` entries of one `const <name> = {` table. */
function tableKeys(name) {
    const start = lines.findIndex((line) => line.trim() === `const ${name} = {`)
    assert.notEqual(start, -1, `client.js must define \`const ${name} = {\``)
    const keys = []
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() === '') continue
        const entry = line.match(/^ {6}'([^']+)':/)
        if (entry) {
            keys.push(entry[1])
            continue
        }
        if (line.trim() === '}') return keys
        assert.fail(`unexpected line inside the ${name} locale table at client.js:${index + 1}: ${line.trim()}`)
    }
    assert.fail(`the ${name} locale table is never closed`)
}

test('zh and en locale tables define the same keys', () => {
    const zh = tableKeys('zh')
    const en = tableKeys('en')
    assert.ok(zh.length > 100, `expected a populated zh table, got ${zh.length} keys`)
    assert.equal(new Set(zh).size, zh.length, 'the zh table must not repeat a key')
    assert.equal(new Set(en).size, en.length, 'the en table must not repeat a key')
    assert.deepEqual([...zh].sort(), [...en].sort(), 'zh and en tables must define identical key sets')
    assert.deepEqual(zh, en, 'the two tables are kept in the same order; a reorder is a merge hazard')
})

test('every locale key the client asks for is defined in both tables', () => {
    const defined = new Set([...tableKeys('zh'), ...tableKeys('en')])
    const used = new Set([...source.matchAll(/\b(?:t|translate)\('([^']+)'\)/g)].map((match) => match[1]))
    assert.ok(used.size > 50, `expected many translated keys, found ${used.size}`)
    const missing = [...used].filter((key) => !defined.has(key))
    assert.deepEqual(missing, [], `client.js asks for keys no table defines: ${missing.join(', ')}`)
})

test('long-chain progress keys keep their placeholders', () => {
    for (const [key, placeholders] of Object.entries({
        'state.progress': ['{done}', '{count}'],
        'state.partialHint': ['{done}', '{count}'],
    })) {
        const line = lines.find((candidate) => candidate.includes(`'${key}':`))
        assert.ok(line, `${key} must exist`)
        for (const placeholder of placeholders) {
            assert.ok(source.includes(`'${key}':`) && source.match(new RegExp(`'${key}':\\s*'[^']*${placeholder.replace(/[{}]/g, '\\$&')}`)), `${key} lost ${placeholder}`)
        }
    }
})

test('the Host/client wire fields exist on both halves', () => {
    const host = readFileSync(path.join(ROOT, 'lib', 'routes.js'), 'utf8')
    for (const field of ['part', 'next', 'partial', 'failed', 'truncated']) {
        const pattern = new RegExp(`\\b${field}\\b`)
        assert.match(host, pattern, `lib/routes.js must speak "${field}"`)
        assert.match(source, pattern, `client.js must speak "${field}"`)
    }
})

test('locale/*.json carry a Plugin Manager title and description', () => {
    for (const lang of ['en', 'zh']) {
        const json = JSON.parse(readFileSync(path.join(ROOT, 'locale', `${lang}.json`), 'utf8'))
        assert.equal(typeof json.meta?.title, 'string')
        assert.ok(json.meta.title.length > 0, `${lang}.json title must not be empty`)
        assert.equal(typeof json.meta?.description, 'string')
        assert.ok(json.meta.description.length > 20, `${lang}.json description is too short`)
    }
})
