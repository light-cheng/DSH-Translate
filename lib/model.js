/**
 * Model requests for this plugin.
 *
 * Two routes answer the same question:
 *   local  — a model served by Ollama on this machine, through lib/local.js
 *   cloud  — the Harness `llm` service with the selected route
 *
 * `generate()` picks between them from the plugin settings. Translation is a
 * small, latency-sensitive task, so the cloud request asks for the cheapest
 * reasoning effort the chosen model declares (a default chat model may
 * otherwise answer at its highest effort and take half a minute); preparation
 * is best effort, and any refusal falls back to a plain stream.
 */

import { chatLocal } from './local.js'

const FAST_EFFORTS = ['off', 'none', 'minimal', 'low']

export function llmAvailable(services) {
  const llm = services?.llm
  return Boolean(llm && typeof llm.stream === 'function')
}

/** True when the settings ask for a local model and name one. */
export function localConfigured(settings) {
  const engine = settings?.engine
  if (engine !== 'local' && engine !== 'auto') return false
  return Boolean(String(settings?.localModel ?? '').trim())
}

/** The route to use: the plugin's own choice, else the Harness default. */
export function pickSelection(services, settings) {
  const override = settings?.model
  if (override?.provider && override?.model) return { provider: override.provider, model: override.model }
  try {
    const current = services?.agentDefaultModel?.currentSelection?.()
    if (current?.provider && current?.model) return { provider: current.provider, model: current.model }
  } catch {
    // A missing default model is a normal state: the UI offers a route choice.
  }
  return null
}

function preferredEffort(model) {
  const efforts = model?.reasoning?.efforts
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  for (const wanted of FAST_EFFORTS) {
    const match = efforts.find((effort) => String(effort?.id ?? '').toLowerCase() === wanted)
    if (match) return match.id
  }
  return undefined
}

async function openStream(llm, request, signal) {
  if (typeof llm.prepareCall === 'function') {
    try {
      const prepared = await llm.prepareCall(
        { provider: request.provider, model: request.model },
        signal,
        (controls, model) => {
          const effort = preferredEffort(model)
          return effort ? { ...controls, reasoningEffort: effort } : controls
        },
      )
      if (prepared && typeof prepared.stream === 'function') {
        const effort = prepared.config?.reasoningEffort
        return prepared.stream(effort ? { ...request, reasoningEffort: effort } : request)
      }
    } catch {
      // Preparation refuses for models without a reasoning catalog; a plain
      // stream is still valid.
    }
  }
  return llm.stream(request)
}

/**
 * Stream one completion and return its full text.
 * @param {object} options
 * @param {object} options.llm Harness LLM service.
 * @param {{provider: string, model: string}} options.selection Model route.
 * @param {string} options.system System prompt.
 * @param {string} options.user User prompt.
 * @param {AbortSignal} options.signal Caller cancellation.
 * @returns {Promise<string>}
 */
export async function complete({ llm, selection, system, user, signal }) {
  const request = {
    provider: selection.provider,
    model: selection.model,
    // A synthetic session id keeps this bookkeeping-only traffic out of every
    // real session's transcript; other profile plugins do the same.
    sessionId: 'dsh-translate',
    system,
    temperature: 0,
    signal,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: user }],
      },
    ],
  }
  const chunks = []
  const stream = await openStream(llm, request, signal)
  for await (const chunk of stream) {
    if ((chunk?.type === 'text-delta' || chunk?.type === 'text') && typeof chunk.text === 'string') chunks.push(chunk.text)
  }
  return chunks.join('')
}

function localFailure(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return new Error('连不上本地 Ollama（127.0.0.1:11434 是否在运行？）')
  }
  return new Error(`本地模型调用失败：${raw.slice(0, 200)}`)
}

/**
 * Answer one prompt through the route the settings ask for.
 *
 * `engine: 'local'` never touches the cloud; `'auto'` tries the local model and
 * falls back to the cloud route when Ollama is down or answers with an error.
 *
 * @returns {Promise<{text: string, route: 'local'|'cloud', model: string, fallbackFrom?: string} | null>}
 *   `null` when the cloud route is also unavailable (no model configured).
 */
export async function generate({ services, settings, system, user, signal }) {
  const engine = settings?.engine === 'local' || settings?.engine === 'auto' ? settings.engine : 'cloud'
  const localModel = String(settings?.localModel ?? '').trim()
  let localError = null

  if (engine !== 'cloud' && localModel) {
    try {
      const text = await chatLocal({
        baseUrl: settings?.localBaseUrl,
        model: localModel,
        system,
        user,
        signal,
      })
      return { text, route: 'local', model: localModel }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      localError = localFailure(error)
      if (engine === 'local') throw localError
    }
  }

  const selection = pickSelection(services, settings)
  if (!llmAvailable(services) || !selection) {
    if (localError) throw localError
    return null
  }
  const text = await complete({ llm: services.llm, selection, system, user, signal })
  return {
    text,
    route: 'cloud',
    model: `${selection.provider}/${selection.model}`,
    ...(localError ? { fallbackFrom: localError.message } : {}),
  }
}
