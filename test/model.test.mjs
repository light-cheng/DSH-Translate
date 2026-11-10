import assert from 'node:assert/strict'
import test from 'node:test'

import { generate, localConfigured } from '../lib/model.js'

function fakeLlm(text) {
  return {
    stream() {
      return (async function* chunks() {
        yield { type: 'text-delta', text }
      })()
    },
    async prepareCall() {
      throw new Error('this fake has no reasoning catalog')
    },
  }
}

function cloudServices(text) {
  return {
    llm: fakeLlm(text),
    agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'mod' }) },
  }
}

test('localConfigured only accepts local engines with a model name', () => {
  assert.equal(localConfigured({ engine: 'local', localModel: 'qwen2.5:3b-instruct' }), true)
  assert.equal(localConfigured({ engine: 'auto', localModel: 'x' }), true)
  assert.equal(localConfigured({ engine: 'cloud', localModel: 'x' }), false)
  assert.equal(localConfigured({ engine: 'local', localModel: '  ' }), false)
  assert.equal(localConfigured(undefined), false)
})

test('the cloud engine streams through the Harness llm service', async () => {
  const result = await generate({
    services: cloudServices('你好'),
    settings: { engine: 'cloud' },
    system: 's',
    user: 'u',
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(result.route, 'cloud')
  assert.equal(result.text, '你好')
  assert.equal(result.model, 'prov/mod')
  assert.equal(result.fallbackFrom, undefined)
})

test('auto falls back to the cloud when the local model is unreachable', async () => {
  const result = await generate({
    services: cloudServices('回退结果'),
    settings: { engine: 'auto', localBaseUrl: 'http://127.0.0.1:9', localModel: 'nope:latest' },
    system: 's',
    user: 'u',
    signal: AbortSignal.timeout(8000),
  })
  assert.equal(result.route, 'cloud')
  assert.equal(result.text, '回退结果')
  assert.match(result.fallbackFrom, /连不上本地 Ollama|本地模型调用失败/)
})

test('a broken local engine reports the failure instead of silently using the cloud', async () => {
  await assert.rejects(
    () =>
      generate({
        services: cloudServices('不应使用'),
        settings: { engine: 'local', localBaseUrl: 'http://127.0.0.1:9', localModel: 'nope:latest' },
        system: 's',
        user: 'u',
        signal: AbortSignal.timeout(8000),
      }),
    /连不上本地 Ollama|本地模型调用失败/,
  )
})

test('no route at all resolves to null', async () => {
  const result = await generate({
    services: {},
    settings: { engine: 'cloud' },
    system: 's',
    user: 'u',
    signal: AbortSignal.timeout(3000),
  })
  assert.equal(result, null)
})
