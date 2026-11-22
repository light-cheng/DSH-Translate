/**
 * End-to-end component behavior tests for client.js using a recursive React
 * hook harness and stubbed DOM/Audio/fetch APIs.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

function createTreeHarness() {
  const instances = new Map()
  let active = null
  let pendingEffects = []

  const ReactStub = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const idx = active.stateCursor++
      if (!(idx in active.states)) active.states[idx] = typeof initial === 'function' ? initial() : initial
      const inst = active
      const setState = (next) => {
        inst.states[idx] = typeof next === 'function' ? next(inst.states[idx]) : next
      }
      return [active.states[idx], setState]
    },
    useRef(initial) {
      const idx = active.refCursor++
      if (!(idx in active.refs)) active.refs[idx] = { current: initial }
      return active.refs[idx]
    },
    useCallback(fn, deps) {
      const idx = active.cbCursor++
      const prev = active.callbacks[idx]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((v, i) => !Object.is(v, prev.deps[i]))
      if (changed) active.callbacks[idx] = { deps, fn }
      return active.callbacks[idx].fn
    },
    useMemo(fn, deps) {
      const idx = active.memoCursor++
      const prev = active.memos[idx]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((v, i) => !Object.is(v, prev.deps[i]))
      if (changed) active.memos[idx] = { deps, value: fn() }
      return active.memos[idx].value
    },
    useEffect(fn, deps) {
      const idx = active.effectCursor++
      const prev = active.effects[idx]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((v, i) => !Object.is(v, prev.deps[i]))
      if (changed) {
        pendingEffects.push({ inst: active, idx, deps, fn, prevCleanup: prev?.cleanup })
      }
    },
  }

  function renderNode(node, path) {
    if (node == null || typeof node !== 'object') return node
    if (Array.isArray(node)) {
      return node.map((child, i) => renderNode(child, `${path}[${child?.key ?? child?.props?.key ?? i}]`))
    }
    if (node.type === ReactStub.Fragment) {
      return { ...node, children: renderNode(node.children, `${path}.frag`) }
    }
    if (typeof node.type === 'function') {
      let inst = instances.get(path)
      if (!inst) {
        inst = { states: [], refs: [], callbacks: [], memos: [], effects: [] }
        instances.set(path, inst)
      }
      inst.stateCursor = 0
      inst.refCursor = 0
      inst.cbCursor = 0
      inst.memoCursor = 0
      inst.effectCursor = 0
      const prevActive = active
      active = inst
      let out
      try {
        out = node.type(node.props ?? {})
      } finally {
        active = prevActive
      }
      return renderNode(out, `${path}>${node.type.name || 'fn'}`)
    }
    return { ...node, children: renderNode(node.children, path) }
  }

  function render(Component, props = {}) {
    pendingEffects = []
    const tree = renderNode(ReactStub.createElement(Component, props), `root:${Component.name || 'anon'}`)
    for (const item of pendingEffects) {
      if (typeof item.prevCleanup === 'function') item.prevCleanup()
      item.inst.effects[item.idx] = { deps: item.deps, cleanup: item.fn() }
    }
    return tree
  }

  function cleanup() {
    for (const inst of instances.values()) {
      for (const entry of inst.effects) {
        if (entry && typeof entry.cleanup === 'function') entry.cleanup()
      }
    }
    instances.clear()
  }

  return { ReactStub, render, cleanup }
}

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const hit = findNode(item, predicate)
      if (hit) return hit
    }
    return null
  }
  if (predicate(tree)) return tree
  return findNode(tree.children, predicate)
}

function collectText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node === 'object') return collectText(node.children)
  return ''
}

async function mountPlugin({ fetchImpl, selectionText = 'Selected sample English text', audioFactory } = {}) {
  const harness = createTreeHarness()
  const listeners = new Map()
  const timers = new Map()
  let timerSeq = 0
  const clipboardWrites = []
  const synthCalls = { speak: [], cancel: 0 }

  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevFetch = globalThis.fetch
  const prevAudio = globalThis.Audio
  const prevNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  const fakeRange = {
    startContainer: { nodeType: 1, closest: () => null },
    commonAncestorContainer: { nodeType: 1, textContent: 'Context around selected sample text.' },
    getBoundingClientRect: () => ({ left: 100, top: 200, right: 300, bottom: 220, width: 200, height: 20 }),
    getClientRects: () => [{ left: 100, top: 200, right: 300, bottom: 220 }],
    cloneRange() {
      return fakeRange
    },
  }

  let exported = null
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    __ModuleLoader__: {
      load(def) {
        exported = def.factory((name) => {
          if (name === 'react') return harness.ReactStub
          throw new Error(`unexpected import: ${name}`)
        })
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    getSelection: () => ({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => selectionText,
      getRangeAt: () => fakeRange,
    }),
    setTimeout(fn, ms) {
      const id = ++timerSeq
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(fn) {
      fn()
      return 1
    },
    cancelAnimationFrame() {},
    speechSynthesis: {
      getVoices: () => [],
      cancel() {
        synthCalls.cancel += 1
      },
      speak(u) {
        synthCalls.speak.push(u.text)
      },
    },
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text
      }
    },
  }

  globalThis.document = {
    baseURI: 'http://127.0.0.1:3000/',
    documentElement: { hasAttribute: () => false, getAttribute: () => null, style: { getPropertyValue: () => '' } },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
  }

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value)
        },
      },
    },
    configurable: true,
    enumerable: true,
  })

  if (audioFactory) globalThis.Audio = audioFactory
  globalThis.fetch = fetchImpl

  const registrations = []
  try {
    await import(`../client.js?behavior-test=${Date.now()}-${Math.random()}`)
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
    await new Promise((resolve) => setImmediate(resolve))

    const getComponent = (slotName) => registrations.find((r) => r.options.name === slotName)?.component
    return {
      harness,
      listeners,
      timers,
      clipboardWrites,
      synthCalls,
      Overlay: getComponent('shell.overlay'),
      DraftBtn: getComponent('conversation.input.right'),
      Settings: getComponent('settings.section'),
      teardown() {
        harness.cleanup()
        globalThis.window = prevWindow
        globalThis.document = prevDocument
        globalThis.fetch = prevFetch
        globalThis.Audio = prevAudio
        if (prevNavDesc) Object.defineProperty(globalThis, 'navigator', prevNavDesc)
      },
    }
  } catch (err) {
    harness.cleanup()
    globalThis.window = prevWindow
    globalThis.document = prevDocument
    globalThis.fetch = prevFetch
    globalThis.Audio = prevAudio
    if (prevNavDesc) Object.defineProperty(globalThis, 'navigator', prevNavDesc)
    throw err
  }
}

test('WordCard renders data.meaning in plain-text fallback and when distinct from gloss', async () => {
  const explainReply = {
    ok: true,
    meaning: '在当前语境下表示幂等操作',
    usage: '用于接口重试说明',
    collocations: ['idempotent call'],
    example: 'An idempotent call is safe to retry.',
  }
  const env = await mountPlugin({
    fetchImpl: async (url) => {
      if (String(url).endsWith('/state')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, settings: { engine: 'cloud' }, engine: 'cloud', llmAvailable: true }) }
      }
      if (String(url).endsWith('/vocab')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            entries: [
              { id: 'idempotent', term: 'idempotent', pos: 'adj.', gloss: '', example: '', createdAt: Date.now() },
              { id: 'retry', term: 'retry', pos: 'v.', gloss: '重试', example: '', createdAt: Date.now() },
            ],
          }),
        }
      }
      if (String(url).endsWith('/explain')) {
        return { ok: true, status: 200, json: async () => explainReply }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) }
    },
  })

  try {
    env.harness.render(env.Settings)
    await new Promise((resolve) => setImmediate(resolve))
    let tree = env.harness.render(env.Settings)

    // Expand first row (empty gloss) -> meaning appears as primary translation.
    const row1 = findNode(tree, (n) => String(n.props?.className ?? '').includes('dsh-tr-vrow'))
    row1.props.onClick()
    env.harness.render(env.Settings)
    await new Promise((resolve) => setImmediate(resolve))
    tree = env.harness.render(env.Settings)
    assert.ok(collectText(tree).includes('在当前语境下表示幂等操作'), 'meaning must render even when entry.gloss is empty')

    // Expand second row (distinct gloss) -> meaning renders with word.meaning label.
    const rows = []
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (String(n.props?.className ?? '').includes('dsh-tr-vrow')) rows.push(n)
      walk(n.children)
    })(tree)
    rows[1].props.onClick()
    env.harness.render(env.Settings)
    await new Promise((resolve) => setImmediate(resolve))
    tree = env.harness.render(env.Settings)
    const text = collectText(tree)
    assert.ok(text.includes('word.meaning'), 'word.meaning row must render when meaning differs from saved gloss')
    assert.ok(text.includes('在当前语境下表示幂等操作'))
  } finally {
    env.teardown()
  }
})

test('Selection Retry sends force: true, partial selection is not memoized, and close aborts in-flight fetch', async () => {
  const translateCalls = []
  let abortCount = 0
  let mode = 'partial'
  let pendingResolve = null

  const env = await mountPlugin({
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/state')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, settings: { engine: 'cloud' }, engine: 'cloud', llmAvailable: true }) }
      }
      if (String(url).endsWith('/dictionary')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, available: true, entries: [] }) }
      }
      const body = JSON.parse(init.body)
      translateCalls.push(body)
      if (mode === 'hang') {
        return await new Promise((resolve, reject) => {
          pendingResolve = resolve
          init.signal?.addEventListener('abort', () => {
            abortCount += 1
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
          })
        })
      }
      if (mode === 'partial') {
        return { ok: true, status: 200, json: async () => ({ ok: true, translation: '部分译文', partial: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, translation: body.force ? '强制重译' : '完整译文', partial: false }) }
    },
  })

  try {
    env.harness.render(env.Overlay)
    for (const fn of env.listeners.get('mouseup') ?? []) fn()
    for (const timer of [...env.timers.values()]) timer.fn()
    env.timers.clear()
    await new Promise((resolve) => setImmediate(resolve))

    let tree = env.harness.render(env.Overlay)
    assert.equal(translateCalls.length, 1)
    assert.ok(collectText(tree).includes('部分译文'))

    // Re-triggering selection when partial was returned must NOT hit client memo.
    mode = 'done'
    const closeBtn = findNode(tree, (n) => n.props?.className === 'dsh-tr-close')
    closeBtn.props.onClick()
    env.harness.render(env.Overlay)

    // Clear lastAutoRef via empty selection then re-select, or just test Retry directly.
    for (const fn of env.listeners.get('mouseup') ?? []) fn()
    for (const timer of [...env.timers.values()]) timer.fn()
    env.timers.clear()
    // Re-open by simulating selection change -> Retry sends force: true.
    mode = 'done'
    const prevSel = globalThis.window.getSelection
    globalThis.window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, toString: () => '' })
    for (const fn of env.listeners.get('mouseup') ?? []) fn()
    for (const timer of [...env.timers.values()]) timer.fn()
    env.timers.clear()
    globalThis.window.getSelection = prevSel
    for (const fn of env.listeners.get('mouseup') ?? []) fn()
    for (const timer of [...env.timers.values()]) timer.fn()
    env.timers.clear()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(translateCalls.length, 2, 'partial selection result must not be served from client memo')
    tree = env.harness.render(env.Overlay)
    const retryBtn = findNode(tree, (n) => n.type === 'button' && collectText(n) === 'action.retry')
    assert.ok(retryBtn)
    retryBtn.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(translateCalls.length, 3)
    assert.equal(translateCalls[2].force, true, 'Retry must pass force: true')
    tree = env.harness.render(env.Overlay)
    assert.ok(collectText(tree).includes('强制重译'))

    // Now test closePanel aborting an in-flight request.
    mode = 'hang'
    const retryHang = findNode(tree, (n) => n.type === 'button' && collectText(n) === 'action.retry')
    retryHang.props.onClick()
    tree = env.harness.render(env.Overlay)
    const closeInFlight = findNode(tree, (n) => n.props?.className === 'dsh-tr-close')
    closeInFlight.props.onClick()
    assert.equal(abortCount, 1, 'closing the panel must abort the in-flight translation request')
    assert.equal(pendingResolve !== null, true)
  } finally {
    env.teardown()
  }
})

test('rapid SpeakButton clicks cancel the previous watchdog timer and prevent old fallback speech', async () => {
  const audios = []
  class FakeAudio {
    constructor(src) {
      this.src = src
      this.readyState = 0
      this.paused = false
      audios.push(this)
    }
    play() {
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
  }

  const env = await mountPlugin({
    audioFactory: FakeAudio,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/state')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, settings: { engine: 'cloud' }, engine: 'cloud', llmAvailable: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) }
    },
  })

  try {
    let tree = env.harness.render(env.Settings)
    await new Promise((resolve) => setImmediate(resolve))
    tree = env.harness.render(env.Settings)

    // Find the "hello" SpeakButton in Settings.
    const speakBtn = findNode(tree, (n) => n.type === 'button' && String(n.props?.className ?? '').includes('dsh-tr-speak'))
    assert.ok(speakBtn)

    // First click creates audio[0] and registers watchdog + max timers.
    speakBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
    assert.equal(audios.length, 1)
    assert.equal(env.timers.size, 2)

    // Second click stops audio[0], clears its timers, and starts audio[1].
    speakBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
    assert.equal(audios.length, 2)
    assert.equal(audios[0].onended, null, 'stopped audio must detach onended')
    assert.equal(audios[0].onerror, null, 'stopped audio must detach onerror')
    assert.equal(audios[0].onabort, null, 'stopped audio must detach onabort')
    assert.equal(env.timers.size, 2, 'only the active audio timers should remain')
    assert.equal(env.synthCalls.speak.length, 0)

    // Complete audio[1] cleanly.
    audios[1].onended()
    assert.equal(env.timers.size, 0, 'completing playback clears all timers')
    assert.equal(env.synthCalls.speak.length, 0)
  } finally {
    env.teardown()
  }
})

test('DraftToEnglishButton hides on empty text and copies instead of overwriting a modified draft', async () => {
  let snapshot = { text: '', placeholder: '请输入中文提示' }
  let appliedValues = []
  let resolveReq = null
  const env = await mountPlugin({
    fetchImpl: async (url) => {
      if (String(url).endsWith('/state')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, settings: { engine: 'cloud' }, engine: 'cloud', llmAvailable: true }) }
      }
      if (String(url).endsWith('/toenglish')) {
        return await new Promise((resolve) => {
          resolveReq = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true, english: 'Translated draft.', notes: [] }) })
        })
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    },
  })

  try {
    const props = {
      useInput: (sel) => sel(snapshot),
      inputActions: { setText: (val) => appliedValues.push(val) },
    }

    // Empty snapshot.text must hide the button even if another key holds Chinese.
    assert.equal(env.harness.render(env.DraftBtn, props), null)

    snapshot = { text: '请帮我写测试', placeholder: '请输入中文提示' }
    const btn = env.harness.render(env.DraftBtn, props)
    assert.ok(btn, 'button shows for Chinese draft')

    // Mount Overlay so openPanel receives the draft result.
    env.harness.render(env.Overlay)

    const clickPromise = btn.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 10, right: 40, bottom: 30, width: 30, height: 20 }) } })
    // User modifies the draft before /toenglish resolves.
    snapshot = { text: '请帮我写测试并补充边界用例' }
    env.harness.render(env.DraftBtn, props)
    resolveReq()
    await clickPromise

    assert.deepEqual(appliedValues, [], 'modified draft must not be overwritten')
    assert.deepEqual(env.clipboardWrites, ['Translated draft.'], 'result must be copied to clipboard instead')
    const overlayTree = env.harness.render(env.Overlay)
    assert.ok(collectText(overlayTree).includes('toEnglish.changed'))
  } finally {
    env.teardown()
  }
})

test('SettingsPage displays local model, clears memo on cache clear, and requires two clicks to clear vocab', async () => {
  const requests = []
  let statePayload = {
    ok: true,
    settings: { engine: 'local', localModel: 'qwen2.5:3b-instruct', localBaseUrl: 'http://127.0.0.1:11434' },
    engine: 'local',
    localModel: 'qwen2.5:3b-instruct',
    llmAvailable: true,
    model: { provider: 'p', model: 'm' },
    cacheSize: 3,
    vocabCount: 1,
    persist: true,
  }

  const env = await mountPlugin({
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
      if (String(url).endsWith('/state')) return { ok: true, status: 200, json: async () => statePayload }
      if (String(url).endsWith('/vocab')) {
        if (init?.body && JSON.parse(init.body).action === 'clear') {
          return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            entries: [{ id: 'state', term: 'state', pos: 'n.', gloss: '状态', createdAt: Date.now() }],
          }),
        }
      }
      if (String(url).endsWith('/local/models')) return { ok: true, status: 200, json: async () => ({ ok: true, models: [{ name: 'qwen2.5:3b-instruct' }] }) }
      if (String(url).endsWith('/cache/clear')) return { ok: true, status: 200, json: async () => ({ ok: true, cacheSize: 0 }) }
      if (String(url).endsWith('/translate')) return { ok: true, status: 200, json: async () => ({ ok: true, translation: '译文', partial: false }) }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    },
  })

  try {
    env.harness.render(env.Settings)
    await new Promise((resolve) => setImmediate(resolve))
    let tree = env.harness.render(env.Settings)

    assert.ok(collectText(tree).includes('local/qwen2.5:3b-instruct'), 'active model row must show local model')

    // First click on Clear vocabulary arms confirmation without clearing.
    const clearVocabBtn = findNode(tree, (n) => n.type === 'button' && collectText(n) === 'settings.vocabClear')
    assert.ok(clearVocabBtn)
    clearVocabBtn.props.onClick()
    tree = env.harness.render(env.Settings)
    assert.equal(requests.some((r) => r.url.endsWith('/vocab') && r.body?.action === 'clear'), false)

    const confirmBtn = findNode(tree, (n) => n.type === 'button' && collectText(n) === 'settings.vocabClearConfirm')
    assert.ok(confirmBtn)
    confirmBtn.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(requests.some((r) => r.url.endsWith('/vocab') && r.body?.action === 'clear'), true)

    // Populate selection memo, then clear cache and verify memo is invalidated.
    env.harness.render(env.Overlay)
    for (const fn of env.listeners.get('mouseup') ?? []) fn()
    for (const timer of [...env.timers.values()]) timer.fn()
    env.timers.clear()
    const pill = findNode(env.harness.render(env.Overlay), (n) => n.props?.className === 'dsh-tr-pill')
    assert.ok(pill, 'manual selection pill must appear in local engine')
    pill.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    const translateBefore = requests.filter((r) => r.url.endsWith('/translate')).length
    assert.equal(translateBefore, 1)

    const clearCacheBtn = findNode(tree, (n) => n.type === 'button' && collectText(n) === 'settings.cacheClear')
    assert.ok(clearCacheBtn)
    clearCacheBtn.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))

    const overlayAfter = env.harness.render(env.Overlay)
    const closeAfter = findNode(overlayAfter, (n) => n.props?.className === 'dsh-tr-close')
    closeAfter?.props.onClick()
    for (const fn of env.listeners.get('mouseup') ?? []) fn()
    for (const timer of [...env.timers.values()]) timer.fn()
    env.timers.clear()
    const pillAgain = findNode(env.harness.render(env.Overlay), (n) => n.props?.className === 'dsh-tr-pill')
    assert.ok(pillAgain)
    await pillAgain.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    const translateAfter = requests.filter((r) => r.url.endsWith('/translate')).length
    assert.equal(translateAfter, 2, 'clearing cache must invalidate client memo')
  } finally {
    env.teardown()
  }
})
