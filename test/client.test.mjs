/**
 * The browser half cannot be opened from Node, but its module envelope and its
 * slot registrations can be checked: this loads client.js under a stubbed
 * module loader and asserts that `apply` claims the four seats it is supposed
 * to claim.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

const REACT_STUB = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
}

async function loadClient() {
  let exported = null
  const registrations = []
  const effects = []

  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        exported = definition.factory((name) => {
          if (name === 'react') return REACT_STUB
          throw new Error(`unexpected import: ${name}`)
        })
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  await import(`../client.js?test=${Date.now()}`)
  assert.ok(exported, 'the module registered a factory')
  return { exported, registrations, effects }
}

test('client half registers the reasoning body, overlay, 中→英 button and settings page', async () => {
  const { exported, registrations, effects } = await loadClient()

  const ctx = {
    get(name) {
      if (name === 'locale') {
        return {
          register: () => () => {},
          bind: () => (key) => key,
        }
      }
      if (name === 'slots') {
        return {
          inject(slotName, callback) {
            const disposer = callback()
            assert.equal(typeof disposer, 'function', `${slotName} must return a disposer`)
          },
          register(options, component) {
            registrations.push({ options, component })
            return () => {}
          },
        }
      }
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') effects.push(disposer)
    },
  }

  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(exported.inject, ['slots', 'locale'])
  exported.apply(ctx)

  const names = registrations.map((entry) => entry.options.name)
  assert.deepEqual(names, [
    'conversation.chat.reasoning.body',
    'shell.overlay',
    'conversation.input.right',
    'settings.section',
  ])

  const reasoning = registrations[0].options
  assert.equal(reasoning.priority, 0, 'the reasoning body replaces the priority-100 entry')
  assert.equal(registrations[1].options.id, 'dsh-translate-selection')
  assert.equal(registrations[2].options.id, 'dsh-translate-toenglish')
  assert.equal(registrations[3].options.id, 'dsh-translate')
  assert.equal(typeof registrations[3].options.label, 'function', 'the settings nav row carries the vocabulary count')

  for (const entry of registrations) {
    assert.equal(typeof entry.component, 'function', `${entry.options.name} needs a component`)
  }
  // Nothing is parked in the composer dock any more.
  assert.ok(!names.includes('conversation.composer.dock'))
  assert.ok(!names.includes('conversation.chat.text-interaction'))
})

test('the client module survives a missing host backend', async () => {
  const { exported } = await loadClient()
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'locale') return undefined
      if (name === 'slots') {
        return {
          inject(slotName, callback) {
            calls.push(slotName)
            callback()
          },
          register() {
            return () => {}
          },
        }
      }
      return undefined
    },
    effect() {},
  }
  // No locale service: the plugin still registers, with key-based fallbacks.
  exported.apply(ctx)
  assert.equal(calls.length, 4)
})
