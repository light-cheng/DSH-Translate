/**
 * Settings rows are the only place a long label sits next to a wide control
 * group. This pins the CSS contract that keeps the label column readable in a
 * narrow settings pane: the row wraps, the label column keeps a real flex
 * basis, and the control group may shrink below its max-content width.
 *
 * Regression: `.dsh-tr-row` was a nowrap flex row and `.dsh-tr-row-main` used
 * `flex:1` (zero basis), so a `provider`/`model` row next to its two inputs and
 * two buttons squeezed the hint to one character per line.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Declarations of one exact `selector{...}` rule in the shipped stylesheet. */
function declarationsFor(selector) {
  const start = source.indexOf(`${selector}{`)
  assert.ok(start >= 0, `client.js must carry a ${selector} rule`)
  const end = source.indexOf('}', start)
  assert.ok(end > start, `the ${selector} rule must terminate`)
  const declarations = new Map()
  for (const piece of source.slice(start + selector.length + 1, end).split(';')) {
    const colon = piece.indexOf(':')
    if (colon < 0) continue
    declarations.set(piece.slice(0, colon).trim(), piece.slice(colon + 1).trim())
  }
  return declarations
}

test('settings rows wrap instead of crushing the label column', () => {
  const row = declarationsFor('.dsh-tr-row')
  assert.equal(row.get('flex-wrap'), 'wrap', 'a narrow row stacks its control group under the label')

  const main = declarationsFor('.dsh-tr-row-main')
  const flex = (main.get('flex') ?? '').split(/\s+/)
  assert.notEqual(flex.length, 1, '.dsh-tr-row-main needs a grow/shrink/basis shorthand')
  assert.match(flex[2] ?? '', /^\d+px$/, 'the label column keeps a non-zero flex basis')
  assert.notEqual(flex[2], '0px', 'the label column must not start from a zero basis')

  const inline = declarationsFor('.dsh-tr-inline')
  assert.equal(inline.get('min-width'), '0', 'the control group may shrink below its max-content width')
})
