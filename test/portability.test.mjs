/**
 * Platform neutrality is a promise in the README (Windows, macOS, Linux) and a
 * CI matrix, not an accident. These guards fail the build if the plugin grows a
 * native dependency, a shell call, a Windows-only path or a platform branch —
 * the four ways this kind of plugin usually stops being portable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const SOURCES = [
    'index.js',
    'client.js',
    'scripts/build-dictionary.mjs',
    ...readdirSync(path.join(ROOT, 'lib')).filter((name) => name.endsWith('.js')).map((name) => `lib/${name}`),
]

test('the package declares no platform restriction and no dependencies', () => {
    assert.equal(pkg.os, undefined, 'package.json must not restrict the operating system')
    assert.equal(pkg.cpu, undefined, 'package.json must not restrict the CPU')
    assert.equal(pkg.bin, undefined, 'a web plugin must not install a CLI binary')
    const dependencies = Object.keys(pkg.dependencies ?? {})
    const optional = Object.keys(pkg.optionalDependencies ?? {})
    assert.deepEqual(dependencies, [], `runtime dependencies would need review on every platform: ${dependencies.join(', ')}`)
    assert.deepEqual(optional, [], `optional native dependencies break portability: ${optional.join(', ')}`)
})

test('no source file shells out or branches on the platform', () => {
    const forbidden = [
        [/child_process/, 'child_process'],
        [/\bexecSync\b/, 'execSync'],
        [/\bspawnSync\b/, 'spawnSync'],
        [/process\.platform/, 'process.platform'],
        [/\.exe\b/, 'a Windows executable name'],
    ]
    const offenders = []
    for (const relative of SOURCES) {
        const text = readFileSync(path.join(ROOT, relative), 'utf8')
        for (const [pattern, label] of forbidden) {
            if (pattern.test(text)) offenders.push(`${relative}: ${label}`)
        }
    }
    assert.deepEqual(offenders, [], `portability regressions: ${offenders.join(', ')}`)
})

test('no source file hardcodes an absolute Windows path', () => {
    const offenders = []
    for (const relative of SOURCES) {
        const text = readFileSync(path.join(ROOT, relative), 'utf8')
        // Drive-letter paths (C:\... or C:/...) have no business in portable code.
        // The leading boundary keeps URL schemes such as https:// or http:// out.
        const match = text.match(/(?:^|[\s'"`(=,])[A-Za-z]:[\\/][^\s'"]*/m)
        if (match) offenders.push(`${relative}: ${match[0]}`)
    }
    assert.deepEqual(offenders, [], `absolute Windows paths: ${offenders.join(', ')}`)
})

test('CI pins the suite on Windows, macOS and Linux', () => {
    const workflow = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    for (const runner of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
        assert.ok(workflow.includes(runner), `CI must run on ${runner}`)
    }
    assert.ok(workflow.includes('npm test'), 'CI must run the test suite')
    assert.ok(workflow.includes('npm run check'), 'CI must run the syntax check')
})
