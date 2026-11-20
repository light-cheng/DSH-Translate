/**
 * The selection translation card (`.dsh-tr-float`) floats inside DSH's
 * `shell.overlay` layer. On Desktop (Electron), the window's top strip carries
 * `-webkit-app-region: drag` (Windows' 40 px caption bar and macOS chrome rows)
 * plus the Windows caption menubar (`z-index: 1100`). Because Electron composes
 * app-regions by geometry rather than hit-testing, an overlay that overlaps the
 * top strip without `-webkit-app-region: no-drag` loses pointer events inside
 * the drag band — slicing straight across the close (`×`) button and leaving a
 * dead zone at its center while only its bottom edge stays clickable.
 *
 * Regression for #3: pin both the CSS contract (no-drag on floating surfaces
 * and a fixed 24x24 centered hit box for `.dsh-tr-close`) and live viewport
 * placement so cards never climb into the desktop titlebar.
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

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (predicate(tree)) return tree
  for (const child of tree.children ?? []) {
    if (Array.isArray(child)) {
      for (const nested of child) {
        const hit = findNode(nested, predicate)
        if (hit) return hit
      }
      continue
    }
    const hit = findNode(child, predicate)
    if (hit) return hit
  }
  return null
}

/** Minimal React hook runner so LearningOverlay can render and react to state. */
function createReactHarness() {
  const states = []
  const refs = []
  const effects = []
  let cursor = 0
  let refCursor = 0
  let effectCursor = 0

  const ReactStub = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }
      return [states[index], setState]
    },
    useRef(initial) {
      const index = refCursor++
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index]
    },
    useCallback(fn) {
      return fn
    },
    useMemo(fn) {
      return fn()
    },
    useEffect(fn, deps) {
      const index = effectCursor++
      const prev = effects[index]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((v, i) => !Object.is(v, prev.deps[i]))
      if (changed) {
        if (prev && typeof prev.cleanup === 'function') prev.cleanup()
        effects[index] = { deps, cleanup: fn() }
      }
    },
  }

  function render(Component, props = {}) {
    cursor = 0
    refCursor = 0
    effectCursor = 0
    return Component(props)
  }

  function cleanup() {
    for (const entry of effects) {
      if (entry && typeof entry.cleanup === 'function') entry.cleanup()
    }
  }

  return { ReactStub, render, cleanup }
}

async function mountOverlay({ attributes = {}, inlineStyles = {}, computedStyles = {}, innerWidth = 1280, innerHeight = 800, rect }) {
  const harness = createReactHarness()
  const listeners = new Map()
  const timers = []

  const rootElement = {
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attributes, name),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attributes, name) ? String(attributes[name]) : null),
    style: {
      getPropertyValue: (name) => inlineStyles[name] ?? '',
    },
  }

  const fakeRange = {
    startContainer: { nodeType: 1, closest: () => null },
    commonAncestorContainer: { nodeType: 1, textContent: 'Selected sample English text for testing.' },
    getBoundingClientRect: () => rect,
    cloneRange() {
      return fakeRange
    },
  }

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevFetch = globalThis.fetch

  let exported = null
  globalThis.window = {
    innerWidth,
    innerHeight,
    __ModuleLoader__: {
      load(definition) {
        exported = definition.factory((name) => {
          if (name === 'react') return harness.ReactStub
          throw new Error(`unexpected import: ${name}`)
        })
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    getComputedStyle: (el) => ({
      getPropertyValue: (name) => (el === rootElement ? computedStyles[name] ?? inlineStyles[name] ?? '' : ''),
    }),
    getSelection: () => ({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => 'Selected sample English text',
      getRangeAt: () => fakeRange,
    }),
    setTimeout: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (fn) => {
      fn()
      return 1
    },
    cancelAnimationFrame: () => {},
  }

  globalThis.document = {
    baseURI: 'http://127.0.0.1:3000/',
    documentElement: rootElement,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn)
    },
  }

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/state')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, settings: {}, engine: 'cloud', llmAvailable: true }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, translation: '示例译文', contextNote: '', terms: [] }),
    }
  }

  try {
    await import(`../client.js?overlay-test=${Date.now()}-${Math.random()}`)
    const registrations = []
    exported.apply({
      get(name) {
        if (name === 'locale') return { register: () => () => {}, bind: () => (key) => key }
        if (name === 'slots') {
          return {
            inject: (_slot, cb) => cb(),
            register: (options, component) => {
              registrations.push({ options, component })
              return () => {}
            },
          }
        }
        return undefined
      },
      effect() {},
    })

    const overlayEntry = registrations.find((entry) => entry.options.name === 'shell.overlay')
    assert.ok(overlayEntry, 'shell.overlay must be registered')
    const Overlay = overlayEntry.component

    // Wait for initial /state fetch to settle, then render and trigger selection.
    await new Promise((resolve) => setImmediate(resolve))
    harness.render(Overlay)
    for (const fn of listeners.get('mouseup') ?? []) fn()
    while (timers.length) timers.shift()()
    await new Promise((resolve) => setImmediate(resolve))

    const tree = harness.render(Overlay)
    return {
      tree,
      rerender: () => harness.render(Overlay),
      teardown: () => {
        harness.cleanup()
        globalThis.window = prevWindow
        globalThis.document = prevDocument
        globalThis.fetch = prevFetch
      },
    }
  } catch (error) {
    harness.cleanup()
    globalThis.window = prevWindow
    globalThis.document = prevDocument
    globalThis.fetch = prevFetch
    throw error
  }
}

test('floating overlay surfaces opt out of Electron window drag and give × a fixed 24x24 hit box', () => {
  for (const selector of ['.dsh-tr-pill', '.dsh-tr-menu', '.dsh-tr-float', '.dsh-tr-close']) {
    const rules = declarationsFor(selector)
    assert.equal(rules.get('-webkit-app-region'), 'no-drag', `${selector} must subtract itself from desktop titlebar drag regions`)
  }

  const head = declarationsFor('.dsh-tr-float-head')
  assert.equal(head.get('flex'), '0 0 auto', '.dsh-tr-float-head must not shrink when the card scrolls')

  const close = declarationsFor('.dsh-tr-close')
  assert.equal(close.get('display'), 'inline-flex', '.dsh-tr-close must be an inline-flex box so the glyph sits centered')
  assert.equal(close.get('align-items'), 'center')
  assert.equal(close.get('justify-content'), 'center')
  assert.equal(close.get('flex'), '0 0 auto')
  assert.equal(close.get('width'), '24px')
  assert.equal(close.get('height'), '24px')
  assert.equal(close.get('padding'), '0')
})

test('selection card stays below the 40px Windows desktop titlebar and its × button closes it', async () => {
  const session = await mountOverlay({
    attributes: { 'data-windows-titlebar': '' },
    inlineStyles: { '--dsh-windows-titlebar-height': '40px' },
    rect: { left: 140, top: 420, right: 360, bottom: 440, width: 220, height: 20 },
  })
  try {
    const card = findNode(session.tree, (node) => node.props?.className === 'dsh-tr-float')
    assert.ok(card, 'selection translation card should render')
    const top = Number.parseFloat(card.props.style?.top)
    assert.ok(top >= 52, `card top (${top}px) must clear the 40px Windows titlebar plus 12px padding`)

    const closeBtn = findNode(card, (node) => node.type === 'button' && node.props?.className === 'dsh-tr-close')
    assert.ok(closeBtn, 'card must render the × close button')
    assert.equal(closeBtn.props['aria-label'], 'action.close')
    assert.equal(typeof closeBtn.props.onClick, 'function')

    closeBtn.props.onClick()
    const afterClose = session.rerender()
    assert.equal(findNode(afterClose, (node) => node.props?.className === 'dsh-tr-float'), null, 'clicking × must close the card')
  } finally {
    session.teardown()
  }
})

test('selection card clears macOS top chrome and relaxes when fullscreen or in a browser', async () => {
  const mac = await mountOverlay({
    attributes: { 'data-platform': 'darwin' },
    computedStyles: { '--dsh-frame-top-clearance': '48px' },
    rect: { left: 140, top: 420, right: 360, bottom: 440, width: 220, height: 20 },
  })
  try {
    const card = findNode(mac.tree, (node) => node.props?.className === 'dsh-tr-float')
    assert.ok(card)
    assert.ok(Number.parseFloat(card.props.style?.top) >= 60, 'macOS card must clear the 48px top chrome plus 12px padding')
  } finally {
    mac.teardown()
  }

  const fullscreen = await mountOverlay({
    attributes: { 'data-windows-titlebar': '', 'data-fullscreen': '' },
    inlineStyles: { '--dsh-windows-titlebar-height': '40px' },
    rect: { left: 140, top: 420, right: 360, bottom: 440, width: 220, height: 20 },
  })
  try {
    const card = findNode(fullscreen.tree, (node) => node.props?.className === 'dsh-tr-float')
    assert.ok(card)
    assert.equal(Number.parseFloat(card.props.style?.top), 12, 'fullscreen drops the titlebar inset back to 12px')
  } finally {
    fullscreen.teardown()
  }

  const browser = await mountOverlay({
    rect: { left: 140, top: 420, right: 360, bottom: 440, width: 220, height: 20 },
  })
  try {
    const card = findNode(browser.tree, (node) => node.props?.className === 'dsh-tr-float')
    assert.ok(card)
    assert.equal(Number.parseFloat(card.props.style?.top), 12, 'plain browser keeps the 12px top padding')
  } finally {
    browser.teardown()
  }
})

test('short Windows desktop viewport keeps the card below the titlebar and inside the viewport', async () => {
  const session = await mountOverlay({
    attributes: { 'data-windows-titlebar': '' },
    inlineStyles: { '--dsh-windows-titlebar-height': '40px' },
    innerHeight: 360,
    rect: { left: 140, top: 240, right: 360, bottom: 260, width: 220, height: 20 },
  })
  try {
    const card = findNode(session.tree, (node) => node.props?.className === 'dsh-tr-float')
    assert.ok(card)
    const top = Number.parseFloat(card.props.style?.top)
    const maxHeight = Number.parseFloat(card.props.style?.maxHeight)
    assert.ok(top >= 52, `card top (${top}px) must stay below the 40px Windows titlebar`)
    assert.ok(top + maxHeight <= 348, `card bottom (${top + maxHeight}px) must stay inside the 360px viewport`)
  } finally {
    session.teardown()
  }
})
