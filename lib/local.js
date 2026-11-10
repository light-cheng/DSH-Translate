/**
 * Local model routing through Ollama.
 *
 * Ollama runs as a local server, so the translation plugin can use a local chat
 * model instead of a cloud model: `/api/tags` lists what is installed,
 * `/api/chat` answers one request.
 *
 * Nothing here is required: an unreachable or uninstalled local model just
 * reports why, and the caller decides whether to fall back to the cloud route.
 */

const MAX_REPLY_TOKENS = 1500
// Short residency: a local model left loaded holds gigabytes of RAM, which is
// exactly what makes the rest of the machine sluggish between translations.
const KEEP_ALIVE = '30s'

/** Trim a base URL and drop one trailing slash so paths concatenate cleanly. */
export function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 'http://127.0.0.1:11434'
  return raw.replace(/\/+$/, '')
}

async function failure(response) {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 200)
  } catch {
    // A body-less error still reports its status.
  }
  return new Error(`Ollama HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
}

/**
 * Every model installed in the local Ollama store.
 * @returns {Promise<Array<{name: string, sizeBytes: number, parameters: string, quantization: string}>>}
 */
export async function listLocalModels(baseUrl, signal) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`, { signal })
  if (!response.ok) throw await failure(response)
  const payload = await response.json()
  const models = Array.isArray(payload?.models) ? payload.models : []
  return models
    .map((model) => ({
      name: String(model?.name ?? model?.model ?? ''),
      sizeBytes: Number(model?.size ?? 0),
      parameters: String(model?.details?.parameter_size ?? ''),
      quantization: String(model?.details?.quantization_level ?? ''),
      family: String(model?.details?.family ?? ''),
    }))
    .filter((model) => model.name)
}

/**
 * One non-streaming chat completion from the local model.
 * @returns {Promise<string>} the assistant text
 */
export async function chatLocal({ baseUrl, model, system, user, signal }) {
  const name = String(model ?? '').trim()
  if (!name) throw new Error('没有配置本地模型')
  const messages = []
  if (system) messages.push({ role: 'system', content: String(system) })
  messages.push({ role: 'user', content: String(user) })
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: name,
      stream: false,
      // Keeping the model resident between translations removes the cold
      // start from the second selection onward.
      keep_alive: KEEP_ALIVE,
      options: { temperature: 0, num_predict: MAX_REPLY_TOKENS },
      messages,
    }),
    signal,
  })
  if (!response.ok) throw await failure(response)
  const payload = await response.json()
  return String(payload?.message?.content ?? '')
}
