import assert from 'node:assert/strict'
import http from 'node:http'
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

test('engine local with an empty localModel never touches the cloud route', async () => {
  let cloudCalls = 0
  const services = {
    llm: {
      async *stream() {
        cloudCalls += 1
        yield { type: 'text-delta', text: 'SHOULD NOT CALL CLOUD' }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'mod' }) },
  }
  const result = await generate({
    services,
    settings: { engine: 'local', localModel: '   ' },
    system: 's',
    user: 'u',
    signal: AbortSignal.timeout(3000),
  })
  assert.equal(result, null)
  assert.equal(cloudCalls, 0)
})

test('local failure reports the configured localBaseUrl', async () => {
  await assert.rejects(
    () =>
      generate({
        services: cloudServices('nope'),
        settings: { engine: 'local', localBaseUrl: 'http://127.0.0.1:9876/', localModel: 'qwen2.5:3b' },
        system: 's',
        user: 'u',
        signal: AbortSignal.timeout(8000),
      }),
    /127\.0\.0\.1:9876|本地模型调用失败/,
  )
})

test('auto falls back to cloud when the local model times out on its own timer', async (t) => {
  const sockets = new Set()
  const server = http.createServer((_req, _res) => {
    // Intentionally hang to trigger localTimeoutMs.
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  const { port } = server.address()

  const result = await generate({
    services: cloudServices('超时回退译文'),
    settings: { engine: 'auto', localBaseUrl: `http://127.0.0.1:${port}`, localModel: 'qwen2.5:3b' },
    system: 's',
    user: 'u',
    signal: AbortSignal.timeout(5000),
    localTimeoutMs: 40,
  })
  assert.equal(result.route, 'cloud')
  assert.equal(result.text, '超时回退译文')
  assert.match(result.fallbackFrom, /本地模型超时/)
})

test('auto does not fall back to cloud when the caller cancels the signal', async (t) => {
  const sockets = new Set()
  const server = http.createServer((_req, _res) => {})
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  const { port } = server.address()

  let cloudCalls = 0
  const services = {
    llm: {
      async *stream() {
        cloudCalls += 1
        yield { type: 'text-delta', text: 'SHOULD NOT CALL' }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'mod' }) },
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('client-closed')), 30)
  await assert.rejects(() =>
    generate({
      services,
      settings: { engine: 'auto', localBaseUrl: `http://127.0.0.1:${port}`, localModel: 'qwen2.5:3b' },
      system: 's',
      user: 'u',
      signal: controller.signal,
      localTimeoutMs: 5000,
    }),
  )
  assert.equal(cloudCalls, 0)
})

test('cloud engine selects the cheapest declared reasoning effort via prepareCall', async () => {
  const seen = []
  const services = {
    llm: {
      async prepareCall(_sel, _sig, customize) {
        const cfg = customize({ temperature: 0 }, { reasoning: { efforts: [{ id: 'high' }, { id: 'minimal' }, { id: 'low' }] } })
        return {
          config: cfg,
          stream(req) {
            seen.push(req.reasoningEffort)
            return (async function* () {
              yield { type: 'text-delta', text: 'fast' }
            })()
          },
        }
      },
      stream() {
        throw new Error('should use prepared.stream')
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'mod' }) },
  }
  const result = await generate({
    services,
    settings: { engine: 'cloud' },
    system: 's',
    user: 'u',
    signal: AbortSignal.timeout(3000),
  })
  assert.equal(result.text, 'fast')
  assert.deepEqual(seen, ['minimal'])
})
