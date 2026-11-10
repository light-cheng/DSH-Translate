/**
 * Documentation links are part of the product: both READMEs are rendered on
 * GitHub and on the package page, and the dictionary documentation carries the
 * licence attribution. A relative link that points at a missing file looks fine
 * in an editor and breaks in public, so pin every one of them here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCUMENTS = ['README.md', 'README_zh.md', 'CHANGELOG.md', 'THIRD-PARTY-NOTICES.md', 'AGENTS.md', 'data/README.md']

const PATTERNS = [
    /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    /<a\s[^>]*href="([^"]+)"/g,
    /<img\s[^>]*src="([^"]+)"/g,
]

function targets(text) {
    const found = new Set()
    for (const pattern of PATTERNS) {
        for (const match of text.matchAll(pattern)) found.add(match[1])
    }
    return [...found]
}

for (const document of DOCUMENTS) {
    test(`${document}: every relative link and image resolves`, () => {
        const file = path.join(ROOT, document)
        assert.ok(existsSync(file), `${document} is missing`)
        const missing = []
        for (const target of targets(readFileSync(file, 'utf8'))) {
            if (/^(?:https?:|mailto:|#)/.test(target)) continue
            const clean = decodeURIComponent(target.split('#')[0])
            if (!clean) continue
            const resolved = path.resolve(path.dirname(file), clean)
            if (!resolved.startsWith(ROOT)) missing.push(`${target} (escapes the repository)`)
            else if (!existsSync(resolved)) missing.push(target)
        }
        assert.deepEqual(missing, [], `${document} points at missing files: ${missing.join(', ')}`)
    })
}

test('the plugin icon is a square RGBA PNG and every manifest points at it', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.equal(pkg.icon, 'assets/icon.png', 'package.json icon must name the shipped PNG')
    assert.equal(pkg.exports['./icon'], './assets/icon.png', 'the ./icon export must resolve to the same file')
    assert.ok(pkg.files.includes('assets/icon.png'), 'the icon must be in package.json files')
    const iconPath = path.join(ROOT, 'assets/icon.png')
    assert.ok(existsSync(iconPath), 'assets/icon.png is missing')
    const png = readFileSync(iconPath)
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the icon must be a PNG')
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    assert.equal(width, height, `the icon must be square, got ${width}x${height}`)
    assert.ok(width >= 256, `the icon must be at least 256px, got ${width}`)
    // PNG colour type 6 is RGBA: the transparent corners are what keep the tile
    // clean on light and dark surfaces alike.
    assert.equal(png[25], 6, 'the icon must be RGBA so its rounded corners stay transparent')
    for (const document of ['README.md', 'README_zh.md']) {
        assert.match(readFileSync(path.join(ROOT, document), 'utf8'), /assets\/icon\.png/, `${document} must show the icon`)
    }
})

test('the two READMEs mirror each other and share the same images', () => {
    const english = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    const chinese = readFileSync(path.join(ROOT, 'README_zh.md'), 'utf8')
    assert.match(english, /README_zh\.md/, 'README.md must link the Chinese edition')
    assert.match(chinese, /README\.md/, 'README_zh.md must link the English edition')
    for (const image of ['docs/images/settings-en.png', 'docs/images/settings-zh.png']) {
        assert.ok(existsSync(path.join(ROOT, image)), `${image} is missing`)
    }
    // Both editions must send readers to the licence facts a public release needs.
    for (const needle of ['THIRD-PARTY-NOTICES.md', 'GPL-3.0']) {
        assert.ok(english.includes(needle), `README.md must mention ${needle}`)
        assert.ok(chinese.includes(needle), `README_zh.md must mention ${needle}`)
    }
})
