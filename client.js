/**
 * dsh-translate — browser half.
 *
 * Seats:
 *   conversation.chat.reasoning.body   bilingual reasoning body: the original is
 *                                      re-rendered through the official content
 *                                      factory, the translation sits under it
 *   shell.overlay                      selection: a "译" pill appears beside the
 *                                      selection, the card opens anchored to it
 *   conversation.input.right           中→英: the Chinese draft becomes English
 *   settings.section                   preferences, model route, vocabulary
 *
 * Results are shown where the text is; nothing is parked in a composer bar.
 */

window.__ModuleLoader__.load({
  id: 'dsh-translate',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-translate'
    const API = '/dsh-translate/api'
    const MEMO_LIMIT = 300
    const SURFACE = 'data-dsh-translate-surface'
    const DICT_MEMO_LIMIT = 500
    const DICT_BATCH_LIMIT = 24
    const DICT_TOKEN_LIMIT = 4
    const SPEAK_CACHE_LIMIT = 60
    const SPEAK_WATCHDOG_MS = 4500

    let t = (key) => key

    // ---------------------------------------------------------------- locale

    const zh = {
      'action.translate': '译成中文',
      'action.retry': '重试',
      'action.continue': '继续翻译',
      'action.copy': '复制译文',
      'action.copied': '已复制',
      'action.close': '关闭',
      'pill.label': '译',
      'pill.title': '翻译选中的英文',
      'state.busy': '翻译中…',
      'state.running': '思考中，结束后可翻译',
      'state.skipped': '这段内容不需要翻译',
      'state.cached': '缓存',
      'state.truncated': '原文较长，只翻译了前面部分',
      'state.progress': '已译 {done}/{count} 段…',
      'state.stop': '停止',
      'state.stopped': '已停止，可继续翻译',
      'state.partial': '部分翻译',
      'state.partialHint': '已译 {done}/{count} 段，可重试继续',
      'context.title': '语境',
      'terms.title': '关键词汇',
      'terms.hint': '点任意词汇收藏到生词本',
      'terms.save': '收藏到生词本',
      'terms.saved': '已收藏',
      'dict.local': '本地词典',
      'dict.entry': '词库释义',
      'phonetic.us': '美',
      'phonetic.uk': '英',
      'speak.us': '播放美式发音',
      'speak.uk': '播放英式发音',
      'toEnglish.buttonTitle': '把输入框里的中文改写成英文',
      'toEnglish.label': '中→英',
      'toEnglish.busy': '…',
      'toEnglish.title': '已换成英文',
      'toEnglish.copied': '输入框不支持程序写入，英文已复制到剪贴板',
      'toEnglish.undo': '撤销',
      'toEnglish.notes': '改写说明',
      'settings.title': 'DSH-Translate',
      'settings.intro': '在对话里读懂英文：思考链中英对照、选中英文即时翻译与语境讲解、输入框中文一键变英文，学到的词可以收藏进生词本。',
      'settings.groupBehaviour': '行为',
      'settings.enabled': '启用翻译',
      'settings.enabledHint': '关闭后思考链、划词、中译英都不再调用模型',
      'settings.auto': '展开思考链时自动翻译',
      'settings.autoHint': '关闭时每段思考链末尾显示「译成中文」，只在你点击时调用模型',
      'settings.autoSelection': '选中英文立即翻译',
      'settings.autoSelectionHint': '选好一段英文就弹出译文；关闭后改为在选区旁点「译」',
      'menu.translate': '翻译选中',
      'menu.copy': '复制选中',
      'settings.terms': '显示关键词汇卡',
      'settings.termsHint': '译文下方列出值得学的英文术语，可点击收藏',
      'settings.context': '显示语境说明',
      'settings.contextHint': '一句话说明这段英文在当前语境里的意思',
      'settings.groupDict': '词典与发音',
      'settings.showDict': '本地词典快速释义',
      'settings.showDictHint': '划词卡与生词卡先显示本机词典的释义和音标，模型随后补充当前语境下的说明与例句。',
      'settings.accent': '发音口音',
      'settings.accentHint': '音标与朗读都用这一口音；另一种口音的音标会用 · 接在后面。',
      'settings.accentUs': '美式',
      'settings.accentUk': '英式',
      'settings.accentTry': '试听 hello',
      'settings.dictReady': '本地词典：{n} 词条 · 已就绪',
      'settings.dictMissing': '本地词典：未安装',
      'settings.dictCredit': '词条来自 ECDICT 与 ipa-dict；英式音标部分为 GPL-3.0，其余 MIT。随插件离线保存。',
      'settings.groupModel': '翻译引擎',
      'settings.engineCloud': '云端（DSH 模型）',
      'settings.engineLocal': '本地 Ollama',
      'settings.engineAuto': '本地优先，失败回落云端',
      'settings.engineHint': '本地模型不联网、不花钱，但只有 CPU 时一段话要等约一分钟：切到本地后，划词改为先点「译」再等结果。',
      'settings.localBaseUrl': 'Ollama 地址',
      'settings.localModel': '本地模型',
      'settings.localRefresh': '刷新模型',
      'settings.localTest': '测试',
      'settings.localTesting': '测试中…',
      'settings.localTestOk': '{model}：{ms} ms',
      'settings.localNone': '没有读取到本地模型，先在 Ollama 里 ollama pull 一个',
      'settings.localUnavailable': '连不上 Ollama：{msg}',
      'settings.localHint': '建议 3B–4B（如 qwen2.5:3b-instruct）；7B 更准但会明显更慢。',
      'settings.language': '目标语言',
      'settings.current': '当前生效',
      'settings.noModel': '没有可用的模型路由',
      'settings.modelHint': '留空则跟随 DSH 当前默认模型；填写后固定用这一路',
      'settings.provider': 'provider',
      'settings.modelId': 'model',
      'settings.modelSave': '保存',
      'settings.modelClear': '恢复默认',
      'settings.saved': '已保存',
      'word.title': '生词卡',
      'word.usage': '用法',
      'word.collocations': '搭配',
      'word.example': '例句',
      'word.explain': '讲解这个词',
      'settings.vocabOpen': '点开单词卡',
      'settings.groupVocab': '生词本',
      'settings.vocabCount': '共 {n} 条',
      'settings.vocabEmpty': '生词本还是空的：在译文卡片里点任意词汇即可收藏。',
      'settings.vocabSearch': '搜索单词、词性或释义',
      'settings.vocabRangeAll': '全部时间',
      'settings.vocabRangeToday': '今天',
      'settings.vocabRangeWeek': '近 7 天',
      'settings.vocabRangeMonth': '近 30 天',
      'settings.vocabSortNew': '最新在前',
      'settings.vocabSortOld': '最早在前',
      'settings.vocabSortAz': '按字母',
      'settings.vocabColTerm': '单词',
      'settings.vocabColPos': '词性',
      'settings.vocabColGloss': '释义',
      'settings.vocabColExample': '例句',
      'settings.vocabColTime': '收藏时间',
      'settings.vocabFiltered': '筛出 {m} / 共 {n} 条',
      'settings.vocabNoMatch': '没有匹配的词条，换个关键词试试',
      'settings.vocabToday': '今天',
      'settings.vocabYesterday': '昨天',
      'settings.vocabDaysAgo': '{n} 天前',
      'settings.vocabCopy': '复制为 JSON',
      'settings.vocabClear': '清空生词本',
      'settings.vocabRemove': '删除',
      'settings.groupCache': '缓存',
      'settings.cacheHint': '共 {n} 条译文缓存，命中时不会调用模型',
      'settings.cacheClear': '清空缓存',
      'settings.privacy': '只有你点击「译」或「Aa」时，选中或草稿里的文本才会发送给上面这一路模型；译文与设置保存在本机 profile 目录。',
      'settings.persistOff': '无法写入 profile 目录，设置只在本次运行有效。',
      'error.generic': '请求失败，请重试',
      'error.network': '连不上插件后端，刷新页面后再试',
      'error.emptySelection': '没有选中文字',
    }

    const en = {
      'action.translate': 'Translate',
      'action.retry': 'Retry',
      'action.continue': 'Continue',
      'action.copy': 'Copy translation',
      'action.copied': 'Copied',
      'action.close': 'Close',
      'pill.label': 'EN',
      'pill.title': 'Translate the selected English',
      'state.busy': 'Translating…',
      'state.running': 'Still thinking; translate when it settles',
      'state.skipped': 'This text needs no translation',
      'state.cached': 'Cached',
      'state.truncated': 'Long text: only the beginning was translated',
      'state.progress': 'Translating {done}/{count}…',
      'state.stop': 'Stop',
      'state.stopped': 'Stopped; you can continue',
      'state.partial': 'Partial translation',
      'state.partialHint': '{done}/{count} segments translated; retry to continue',
      'context.title': 'Context',
      'terms.title': 'Key vocabulary',
      'terms.hint': 'click a term to save it',
      'terms.save': 'Save to vocabulary',
      'terms.saved': 'Saved',
      'dict.local': 'Local dictionary',
      'dict.entry': 'Dictionary',
      'phonetic.us': 'US',
      'phonetic.uk': 'UK',
      'speak.us': 'Play the US pronunciation',
      'speak.uk': 'Play the UK pronunciation',
      'toEnglish.buttonTitle': 'Rewrite the Chinese draft in English',
      'toEnglish.label': '中→EN',
      'toEnglish.busy': '…',
      'toEnglish.title': 'Rewritten in English',
      'toEnglish.copied': 'The composer cannot be written from here; the English was copied',
      'toEnglish.undo': 'Undo',
      'toEnglish.notes': 'Why',
      'settings.title': 'DSH-Translate',
      'settings.intro': 'Read English while you work: bilingual reasoning, translate any selection with a context note, turn a Chinese draft into English in one click, and keep a vocabulary notebook.',
      'settings.groupBehaviour': 'Behaviour',
      'settings.enabled': 'Enable translation',
      'settings.enabledHint': 'When off, reasoning, selection translation and 中→EN never call a model',
      'settings.auto': 'Translate reasoning when expanded',
      'settings.autoHint': 'When off, each block ends with a Translate button and only your click calls a model',
      'settings.autoSelection': 'Translate a selection immediately',
      'settings.autoSelectionHint': 'The translation opens as soon as English is selected; when off, a Translate pill appears beside the selection',
      'menu.translate': 'Translate selection',
      'menu.copy': 'Copy selection',
      'settings.terms': 'Show key vocabulary',
      'settings.termsHint': 'Lists useful English terms under the translation; click one to save it',
      'settings.context': 'Show context note',
      'settings.contextHint': 'One sentence about what the English means right here',
      'settings.groupDict': 'Dictionary & pronunciation',
      'settings.showDict': 'Instant local dictionary gloss',
      'settings.showDictHint': 'Selection cards and word cards show the offline gloss and phonetic first; the model then adds the meaning in this context and an example.',
      'settings.accent': 'Pronunciation accent',
      'settings.accentHint': 'Phonetics and playback use this accent; the other accent follows after a · when available.',
      'settings.accentUs': 'US',
      'settings.accentUk': 'UK',
      'settings.accentTry': 'Preview hello',
      'settings.dictReady': 'Local dictionary: {n} entries · ready',
      'settings.dictMissing': 'Local dictionary: not installed',
      'settings.dictCredit': 'Entries from ECDICT and ipa-dict: UK IPA is GPL-3.0, the rest MIT. Stored offline with the plugin.',
      'settings.groupModel': 'Model',
      'settings.engineCloud': 'Cloud (Harness model)',
      'settings.engineLocal': 'Local Ollama',
      'settings.engineAuto': 'Local first, cloud on failure',
      'settings.engineHint': 'A local model stays offline and free, but on CPU one paragraph takes about a minute: on the local route, selecting shows a Translate pill instead of translating immediately.',
      'settings.localBaseUrl': 'Ollama address',
      'settings.localModel': 'Local model',
      'settings.localRefresh': 'Refresh models',
      'settings.localTest': 'Test',
      'settings.localTesting': 'Testing…',
      'settings.localTestOk': '{model}: {ms} ms',
      'settings.localNone': 'No local model found; pull one with ollama pull first',
      'settings.localUnavailable': 'Cannot reach Ollama: {msg}',
      'settings.localHint': 'Prefer 3B–4B (for example qwen2.5:3b-instruct); 7B is more accurate but clearly slower.',
      'settings.language': 'Target language',
      'settings.current': 'In use',
      'settings.noModel': 'No model route available',
      'settings.modelHint': 'Leave empty to follow the Harness default model',
      'settings.provider': 'provider',
      'settings.modelId': 'model',
      'settings.modelSave': 'Save',
      'settings.modelClear': 'Use default',
      'settings.saved': 'Saved',
      'word.title': 'Word card',
      'word.usage': 'Usage',
      'word.collocations': 'Collocations',
      'word.example': 'Example',
      'word.explain': 'Explain this word',
      'settings.vocabOpen': 'Open the word card',
      'settings.groupVocab': 'Vocabulary',
      'settings.vocabCount': '{n} saved',
      'settings.vocabEmpty': 'Nothing saved yet: click a term in any translation card.',
      'settings.vocabSearch': 'Search term, meaning or example',
      'settings.vocabRangeAll': 'All time',
      'settings.vocabRangeToday': 'Today',
      'settings.vocabRangeWeek': 'Last 7 days',
      'settings.vocabRangeMonth': 'Last 30 days',
      'settings.vocabSortNew': 'Newest first',
      'settings.vocabSortOld': 'Oldest first',
      'settings.vocabSortAz': 'A → Z',
      'settings.vocabColTerm': 'Term',
      'settings.vocabColPos': 'Pos',
      'settings.vocabColGloss': 'Meaning',
      'settings.vocabColExample': 'Example',
      'settings.vocabColTime': 'Saved',
      'settings.vocabFiltered': '{m} of {n}',
      'settings.vocabNoMatch': 'No matching entry; try another keyword',
      'settings.vocabToday': 'Today',
      'settings.vocabYesterday': 'Yesterday',
      'settings.vocabDaysAgo': '{n} days ago',
      'settings.vocabCopy': 'Copy as JSON',
      'settings.vocabClear': 'Clear vocabulary',
      'settings.vocabRemove': 'Remove',
      'settings.groupCache': 'Cache',
      'settings.cacheHint': '{n} cached translations; a hit does not call a model',
      'settings.cacheClear': 'Clear cache',
      'settings.privacy': 'Text is sent to the model above only when you click Translate or Aa. Translations and settings stay in this profile directory.',
      'settings.persistOff': 'The profile directory is not writable; settings live for this run only.',
      'error.generic': 'Request failed, try again',
      'error.network': 'Cannot reach the plugin backend; refresh the page',
      'error.emptySelection': 'Nothing is selected',
    }

    // ------------------------------------------------------------------ util

    function interpolate(value, vars) {
      if (!vars) return value
      return String(value).replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
    }

    function hasLatin(value) {
      return /[A-Za-z]{2}/.test(String(value ?? ''))
    }

    function hasChinese(value) {
      return /[\u3400-\u9fff]/.test(String(value ?? ''))
    }

    function truncate(value, limit) {
      const text = String(value ?? '')
      return text.length > limit ? `${text.slice(0, limit)}…` : text
    }

    function startOfDay(timestamp) {
      const date = new Date(Number(timestamp) || Date.now())
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    /** A saved-at label that reads well in a table: today, yesterday, or MM-DD. */
    function formatSavedAt(timestamp, translate) {
      const value = Number(timestamp)
      if (!Number.isFinite(value) || value <= 0) return ''
      const days = Math.round((startOfDay(Date.now()) - startOfDay(value)) / 86400000)
      if (days <= 0) return translate('settings.vocabToday')
      if (days === 1) return translate('settings.vocabYesterday')
      if (days < 7) return interpolate(translate('settings.vocabDaysAgo'), { n: days })
      const date = new Date(value)
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    /** Wrap every case-insensitive occurrence of the query in a highlight. */
    function highlightText(value, query) {
      const text = String(value ?? '')
      const needle = String(query ?? '').trim()
      if (!needle) return text
      const haystack = text.toLowerCase()
      const target = needle.toLowerCase()
      let index = 0
      let found = haystack.indexOf(target, index)
      if (found < 0) return text
      const parts = []
      let key = 0
      while (found >= 0) {
        if (found > index) parts.push(text.slice(index, found))
        parts.push(h('mark', { key: `hit-${key}`, className: 'dsh-tr-hit' }, text.slice(found, found + target.length)))
        key += 1
        index = found + target.length
        found = haystack.indexOf(target, index)
      }
      if (index < text.length) parts.push(text.slice(index))
      return parts
    }

    function logError(message, error) {
      if (typeof console === 'undefined' || typeof console.error !== 'function') return
      console.error(`dsh-translate: ${message}`, error)
    }

    function objectKeys(value) {
      try {
        return Object.keys(value ?? {})
      } catch {
        return []
      }
    }

    function apiUrl(suffix) {
      try {
        return new URL(`${API}${suffix}`, document.baseURI).toString()
      } catch {
        return `${API}${suffix}`
      }
    }

    async function requestJson(suffix, body, signal) {
      const options = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } }
      if (body !== undefined) {
        options.headers['content-type'] = 'application/json'
        options.body = JSON.stringify(body)
      }
      if (signal) options.signal = signal
      const response = await fetch(apiUrl(suffix), options)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    // ------------------------------------------------------------ host state

    let hostState = {
      ready: false,
      ok: false,
      settings: {},
      llmAvailable: false,
      model: null,
      cacheSize: 0,
      vocabCount: 0,
      dict: null,
      maxChars: 8000,
      persist: true,
      error: '',
    }
    let hostStateRequest = null
    const hostListeners = new Set()

    function publishHostState(patch) {
      hostState = { ...hostState, ...patch }
      for (const listener of [...hostListeners]) {
        try {
          listener()
        } catch (error) {
          logError('a state listener failed', error)
        }
      }
    }

    function loadHostState({ force = false } = {}) {
      if (!force && hostState.ready) return Promise.resolve(hostState)
      if (hostStateRequest) return hostStateRequest
      hostStateRequest = requestJson('/state')
        .then((payload) => {
          publishHostState({ ...payload, ready: true, error: '' })
          return hostState
        })
        .catch((error) => {
          publishHostState({ ready: true, ok: false, error: String(error?.message ?? error) })
          return hostState
        })
        .finally(() => {
          hostStateRequest = null
        })
      return hostStateRequest
    }

    function useHostState() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        hostListeners.add(listener)
        void loadHostState()
        return () => {
          hostListeners.delete(listener)
        }
      }, [])
      return hostState
    }

    function hostEnabled(host) {
      return (host.settings ?? {}).enabled !== false && host.ok !== false
    }

    // ------------------------------------------------------ browser prefs

    // Selection behaviour is a per-browser reading preference, so it lives in
    // localStorage: it applies instantly and never waits for a Host round trip.
    const PREF_KEY = 'dsh-translate:prefs'
    let prefs = { autoSelection: true }
    try {
      const stored = window.localStorage?.getItem(PREF_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') prefs = { ...prefs, autoSelection: parsed.autoSelection !== false }
      }
    } catch {
      // Private mode or a blocked storage area: defaults apply.
    }
    const prefListeners = new Set()

    function setPref(key, value) {
      prefs = { ...prefs, [key]: value }
      try {
        window.localStorage?.setItem(PREF_KEY, JSON.stringify(prefs))
      } catch {
        // Not persisting is acceptable; this run still uses the value.
      }
      for (const listener of [...prefListeners]) {
        try {
          listener()
        } catch (error) {
          logError('a preference listener failed', error)
        }
      }
    }

    function usePrefs() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        prefListeners.add(listener)
        return () => {
          prefListeners.delete(listener)
        }
      }, [])
      return prefs
    }

    async function saveSettings(patch) {
      const settings = { ...(hostState.settings ?? {}), ...patch }
      const payload = await requestJson('/settings', { settings })
      if (payload?.ok) publishHostState({ ...payload, ready: true })
      return payload
    }

    // ---------------------------------------------------------- result memo

    const memo = new Map()

    function memoGet(mode, text) {
      const key = `${mode}\u0000${text}`
      const hit = memo.get(key)
      if (hit) {
        memo.delete(key)
        memo.set(key, hit)
      }
      return hit
    }

    function memoSet(mode, text, data) {
      const key = `${mode}\u0000${text}`
      if (memo.has(key)) memo.delete(key)
      memo.set(key, data)
      while (memo.size > MEMO_LIMIT) {
        const oldest = memo.keys().next().value
        if (oldest === undefined) break
        memo.delete(oldest)
      }
    }

    // ------------------------------------------------------ local dictionary

    // The offline dictionary answers in milliseconds, so its entries live for
    // the whole session: a word looked up once is never requested again.
    const dictMemo = new Map()
    const dictInFlight = new Map()

    /** The first few gloss lines of a dictionary entry, one per source line. */
    function translationLines(value, limit) {
      const lines = []
      for (const raw of String(value ?? '').split('\n')) {
        const line = raw.trim()
        if (!line) continue
        lines.push(truncate(line, 120))
        if (lines.length >= limit) break
      }
      return lines
    }

    /**
     * One key for one word. The Host folds curly quotes before it looks a word
     * up, so the client must fold them too: otherwise don't and don’t would be
     * asked for twice and only one answer would land in the memo.
     */
    function dictKey(value) {
      return String(value ?? '').trim().toLowerCase().replace(/[’‘]/g, "'")
    }

    /** English words in a selection; more than four is model territory. */
    function tokensOf(text) {
      const matches = String(text ?? '').match(/[A-Za-z][A-Za-z'’-]*/g) ?? []
      const tokens = []
      const seen = new Set()
      for (const match of matches) {
        const token = dictKey(match.replace(/[-'’]+$/, ''))
        if (!token || /^\d+$/.test(token)) continue
        if (seen.has(token)) continue
        seen.add(token)
        tokens.push(token)
        if (tokens.length > DICT_TOKEN_LIMIT) return []
      }
      return tokens
    }

    /** Lower-cased, de-duplicated words for one Host request. */
    function normalizeDictWords(words) {
      const list = []
      const seen = new Set()
      for (const word of Array.isArray(words) ? words : [words]) {
        const text = dictKey(word)
        if (!text || seen.has(text)) continue
        seen.add(text)
        list.push(text)
        if (list.length >= DICT_BATCH_LIMIT) break
      }
      return list
    }

    function dictMemoGet(word) {
      const key = dictKey(word)
      if (!key) return undefined
      const hit = dictMemo.get(key)
      if (!hit) return undefined
      dictMemo.delete(key)
      dictMemo.set(key, hit)
      return hit
    }

    function dictMemoSet(word, entry) {
      const key = dictKey(word)
      if (!key || !entry) return
      if (dictMemo.has(key)) dictMemo.delete(key)
      dictMemo.set(key, entry)
      while (dictMemo.size > DICT_MEMO_LIMIT) {
        const oldest = dictMemo.keys().next().value
        if (oldest === undefined) break
        dictMemo.delete(oldest)
      }
    }

    /**
     * POST /dictionary for up to 24 words. A failure stays silent: the model
     * result is still on its way and the card simply shows no local gloss.
     */
    async function requestDictionary(words) {
      const list = normalizeDictWords(words)
      if (!list.length) return []
      const batchKey = list.join('\u0000')
      const pending = dictInFlight.get(batchKey)
      if (pending) return await pending
      const request = (async () => {
        const payload = await requestJson('/dictionary', { words: list })
        if (!payload || payload.ok === false) return []
        const available = payload.available !== false
        const entries = Array.isArray(payload.entries) ? payload.entries : []
        const found = []
        entries.forEach((raw, index) => {
          if (!raw || typeof raw !== 'object') return
          const entry = {
            query: String(raw.query ?? list[index] ?? ''),
            found: available && raw.found === true,
            available,
            word: String(raw.word ?? ''),
            ipa: String(raw.ipa ?? ''),
            ipaUk: String(raw.ipaUk ?? ''),
            translation: String(raw.translation ?? ''),
            matched: String(raw.matched ?? ''),
          }
          dictMemoSet(entry.query, entry)
          if (list[index]) dictMemoSet(list[index], entry)
          if (entry.found) found.push(entry)
        })
        // A word the Host skipped still counts as seen, so the card does not
        // ask again on every render.
        for (const word of list) {
          if (dictMemoGet(word) === undefined) dictMemoSet(word, { query: word, found: false, available, word: '', ipa: '', ipaUk: '', translation: '', matched: '' })
        }
        return found
      })()
        .catch((error) => {
          logError('could not look words up in the local dictionary', error)
          return []
        })
        .finally(() => {
          dictInFlight.delete(batchKey)
        })
      dictInFlight.set(batchKey, request)
      return await request
    }

    /** What the memo already knows: found entries in token order plus a status. */
    function dictStateFor(words) {
      const entries = []
      let unknown = 0
      let available = true
      for (const word of words) {
        const entry = dictMemoGet(word)
        if (entry === undefined) {
          unknown += 1
          continue
        }
        if (entry.available === false) available = false
        if (entry.found) entries.push(entry)
      }
      const status = !words.length || unknown === 0 ? 'done' : unknown === words.length ? 'idle' : 'loading'
      return { status, available, entries }
    }

    /** Entries for a token list: memo first, one Host request per unseen batch. */
    function useDictionary(texts) {
      const host = useHostState()
      const enabled = (host.settings ?? {}).showDict !== false
      const words = React.useMemo(() => normalizeDictWords(texts), [texts])
      const key = words.join('\u0000')
      const [state, setState] = React.useState(() => dictStateFor(words))
      const askedRef = React.useRef('')

      React.useEffect(() => {
        if (!enabled) {
          setState({ status: 'done', available: true, entries: [] })
          return undefined
        }
        const wanted = key ? key.split('\u0000') : []
        const next = dictStateFor(wanted)
        setState(next)
        if (next.status === 'done' || askedRef.current === key) return undefined
        const missing = wanted.filter((word) => dictMemoGet(word) === undefined)
        if (!missing.length) return undefined
        askedRef.current = key
        let cancelled = false
        void requestDictionary(missing).then(() => {
          if (cancelled) return
          askedRef.current = ''
          setState(dictStateFor(wanted))
        })
        return () => {
          cancelled = true
          if (askedRef.current === key) askedRef.current = ''
        }
      }, [key, enabled])

      return state
    }

    // ------------------------------------------------------- pronunciation

    // 有道 dictvoice serves one word directly; nothing is proxied by the Host.
    const speakCache = new Map()
    let speakCurrent = null
    let speakToken = 0

    function accentOf(value) {
      return value === 'uk' ? 'uk' : 'us'
    }

    function speakUrl(text, accent) {
      const type = accentOf(accent) === 'uk' ? 1 : 2
      return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(String(text ?? '').trim())}&type=${type}`
    }

    /** Hover prefetch: the browser cache turns a click into instant playback. */
    function prefetchSpeech(url) {
      if (!url || typeof Audio !== 'function') return
      try {
        if (speakCache.has(url)) {
          const hit = speakCache.get(url)
          speakCache.delete(url)
          speakCache.set(url, hit)
          return
        }
        const audio = new Audio()
        audio.preload = 'auto'
        audio.src = url
        speakCache.set(url, audio)
        while (speakCache.size > SPEAK_CACHE_LIMIT) {
          const oldest = speakCache.keys().next().value
          if (oldest === undefined) break
          speakCache.delete(oldest)
        }
      } catch {
        // Prefetching is a nicety; playback still works without it.
      }
    }

    function stopSpeech() {
      // A fallback clip owns no audio element and clears speakCurrent, so the
      // platform voice has to be cancelled here: otherwise the previous word
      // keeps reading while the next one starts.
      try {
        window.speechSynthesis?.cancel?.()
      } catch {
        // A platform without a voice engine has nothing to cancel.
      }
      const current = speakCurrent
      speakCurrent = null
      if (!current) return
      try {
        current.stop()
      } catch {
        // A detached element cannot be stopped.
      }
      // The button that started the clip must leave its playing state, even
      // though this clip will never end on its own now.
      if (typeof current.finish === 'function') {
        try {
          current.finish()
        } catch {
          // The card that asked for the sound may already be gone.
        }
      }
    }

    /** speechSynthesis takes over when the audio never arrives. */
    function speakWithVoice(text, accent) {
      try {
        const synth = window.speechSynthesis
        if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return
        const utterance = new window.SpeechSynthesisUtterance(String(text ?? ''))
        utterance.lang = accent === 'uk' ? 'en-GB' : 'en-US'
        utterance.rate = 0.92
        try {
          const voices = typeof synth.getVoices === 'function' ? synth.getVoices() ?? [] : []
          const english = voices.filter((voice) => /^en([-_]|$)/i.test(String(voice?.lang ?? '')))
          const exact = english.find((voice) => String(voice.lang).toLowerCase() === utterance.lang.toLowerCase())
          const chosen = exact || english[0]
          if (chosen) utterance.voice = chosen
        } catch {
          // A platform without voices keeps its default voice.
        }
        if (typeof synth.cancel === 'function') synth.cancel()
        synth.speak(utterance)
      } catch {
        // Speaking is optional; silence is an acceptable outcome.
      }
    }

    /**
     * Play one word. The previous clip stops first; a 4.5 s watchdog or an
     * error hands over to speechSynthesis, which needs no network.
     */
    function playSpeech(text, accent, onEnd) {
      const value = String(text ?? '').trim()
      if (!value) return
      stopSpeech()
      speakToken += 1
      const token = speakToken
      let settled = false
      let timer = null
      let audio = null

      const finish = () => {
        if (typeof onEnd !== 'function') return
        try {
          onEnd()
        } catch {
          // The card that asked for the sound may already be gone.
        }
      }

      const settle = (useVoice) => {
        if (settled) return
        settled = true
        if (timer !== null) {
          try {
            window.clearTimeout(timer)
          } catch {
            // A missing timer host leaves nothing to clear.
          }
          timer = null
        }
        if (speakCurrent && speakCurrent.token === token) speakCurrent = null
        if (useVoice) speakWithVoice(value, accent)
        finish()
      }

      try {
        if (typeof Audio === 'function') {
          audio = new Audio(speakUrl(value, accent))
          audio.preload = 'auto'
          audio.onended = () => settle(false)
          audio.onerror = () => settle(true)
          speakCurrent = {
            token,
            finish,
            stop: () => {
              try {
                audio.pause()
                audio.currentTime = 0
              } catch {
                // A detached element cannot be paused.
              }
            },
          }
          timer = window.setTimeout(() => {
            // A clip that is only slow, not broken, keeps playing: the watchdog
            // exists to catch a clip that never starts, not to cut a long one
            // (a phrase may take more than 4.5 s). onended clears the state.
            const stalled = !audio || audio.readyState < 3
            timer = null
            if (!stalled) return
            try {
              audio.pause()
            } catch {
              // Nothing was playing.
            }
            settle(true)
          }, SPEAK_WATCHDOG_MS)
          const playback = audio.play()
          if (playback && typeof playback.catch === 'function') playback.catch(() => settle(true))
          return
        }
      } catch {
        // Autoplay policy or a broken codec: the voice fallback takes over.
      }
      settle(true)
    }

    // ------------------------------------------------------------ panel bus

    const panelListeners = new Set()

    /** Ask the overlay to show a panel (used by the composer polish button). */
    function openPanel(request) {
      for (const listener of [...panelListeners]) {
        try {
          listener(request)
        } catch (error) {
          logError('a panel listener failed', error)
        }
      }
    }

    function subscribePanel(listener) {
      panelListeners.add(listener)
      return () => {
        panelListeners.delete(listener)
      }
    }

    // --------------------------------------------------- geometry & selection

    function rectToPlain(rect) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }

    function placePill(rect) {
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      const width = 44
      const height = 28
      let left = rect.left + rect.width / 2 - width / 2
      left = Math.max(8, Math.min(left, vw - width - 8))
      let top = rect.bottom + 10
      if (top + height > vh - 8) top = Math.max(8, rect.top - height - 10)
      return { left, top, width }
    }

    function placeCard(rect) {
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      const pad = 12
      const width = Math.min(440, vw - pad * 2)
      const maxHeight = Math.max(180, Math.min(Math.round(vh * 0.58), 460))
      let left = rect ? rect.left : vw / 2 - width / 2
      left = Math.max(pad, Math.min(left, vw - width - pad))
      let top
      if (rect) {
        top = rect.bottom + 40
        if (top + maxHeight > vh - pad) top = Math.max(pad, rect.top - maxHeight - 40)
        if (top < pad) top = Math.max(pad, vh - maxHeight - pad)
      } else {
        top = Math.round(vh / 2 - maxHeight / 2)
      }
      return { left, top, width, maxHeight }
    }

    function placeMenu(x, y, itemCount) {
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      const width = 150
      const height = itemCount * 30 + 12
      return {
        left: Math.max(8, Math.min(x, vw - width - 8)),
        top: Math.max(8, Math.min(y, vh - height - 8)),
        width,
      }
    }

    async function copyText(value) {
      try {
        await navigator.clipboard.writeText(String(value ?? ''))
      } catch (error) {
        logError('could not write to the clipboard', error)
      }
    }

    function selectionContextOf(range) {
      try {
        let node = range.commonAncestorContainer
        let element = node && node.nodeType === 3 ? node.parentElement : node
        let best = ''
        for (let depth = 0; depth < 6 && element; depth += 1, element = element.parentElement) {
          const text = String(element.textContent ?? '').trim()
          if (text.length > best.length) best = text
          if (text.length >= 400) break
        }
        return best.slice(0, 1500)
      } catch {
        return ''
      }
    }

    /** The current non-empty English selection, with its viewport rectangle. */
    function readSelection() {
      try {
        const selection = window.getSelection?.()
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
        const text = String(selection.toString() ?? '').trim()
        if (!text || text.length > 8000 || !hasLatin(text)) return null
        const range = selection.getRangeAt(0)
        const start = range.startContainer
        const startElement = start && start.nodeType === 3 ? start.parentElement : start
        if (startElement && typeof startElement.closest === 'function') {
          if (startElement.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return null
          if (startElement.closest(`[${SURFACE}]`)) return null
        }
        const rect = range.getBoundingClientRect()
        if (!rect || (!rect.width && !rect.height)) return null
        return { text, rect: rectToPlain(rect), range: range.cloneRange(), context: selectionContextOf(range) }
      } catch {
        return null
      }
    }

    // -------------------------------------------------------------- requests

    // A long reasoning block is translated part by part: the Host plans the
    // chunks deterministically and answers one `part` per request, so the
    // reader sees the translation grow, can stop midway and resume at the part
    // that failed. A selection still travels as one request.
    const CHUNK_TERMS_LIMIT = 8

    /** The resumable part of a result: `next` names the chunk still missing. */
    function normalizePartial(value) {
      if (!value || typeof value !== 'object') return null
      const next = Number.isInteger(value.next) && value.next >= 0 ? value.next : null
      if (next === null) return null
      const part = value.part && typeof value.part === 'object' ? value.part : null
      return {
        translation: String(value.translation ?? ''),
        contextNote: String(value.contextNote ?? ''),
        terms: Array.isArray(value.terms) ? value.terms : [],
        cached: Boolean(value.cached),
        truncated: Boolean(value.truncated),
        part: {
          done: Math.max(0, Math.floor(Number(part?.done)) || 0),
          count: Math.max(0, Math.floor(Number(part?.count)) || 0),
        },
        next,
      }
    }

    function emptyPartial() {
      return { translation: '', contextNote: '', terms: [], cached: true, truncated: false, part: { done: 0, count: 0 }, next: 0 }
    }

    /** One blank line between parts, and none around an empty part. */
    function appendTranslation(previous, addition) {
      const left = String(previous ?? '')
      const right = String(addition ?? '')
      if (!right) return left
      if (!left) return right
      return `${left}\n\n${right}`
    }

    /** Chunk terms merged by their term text and capped for the vocabulary card. */
    function mergeTerms(previous, incoming) {
      const merged = []
      const seen = new Set()
      for (const term of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]) {
        if (!term || typeof term !== 'object') continue
        const key = String(term.term ?? '').trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        merged.push(term)
        if (merged.length >= CHUNK_TERMS_LIMIT) break
      }
      return merged
    }

    function progressLabel(data) {
      const count = Math.max(0, Math.floor(Number(data?.part?.count)) || 0)
      if (count <= 1) return ''
      const done = Math.min(count, Math.max(0, Math.floor(Number(data?.part?.done)) || 0))
      return interpolate(t('state.progress'), { done, count })
    }

    function partialHintLabel(data) {
      const count = Math.max(0, Math.floor(Number(data?.part?.count)) || 0)
      if (count <= 1) return ''
      const done = Math.min(count, Math.max(0, Math.floor(Number(data?.part?.done)) || 0))
      return interpolate(t('state.partialHint'), { done, count })
    }

    /** True when a payload carries the chunk position of the chunked protocol. */
    function hasPart(payload) {
      return Boolean(payload && payload.part && typeof payload.part === 'object')
    }

    function useTranslationRun(mode) {
      const [state, setState] = React.useState({ status: 'idle' })
      const abortRef = React.useRef(null)
      const mountedRef = React.useRef(true)

      const run = React.useCallback(
        async (rawText, context, resume) => {
          const text = String(rawText ?? '').trim()
          if (!text) {
            setState({ status: 'error', message: t('error.emptySelection') })
            return
          }

          // Selection: one request and one result, exactly as before.
          if (mode !== 'reasoning') {
            const hit = memoGet(mode, text)
            if (hit) {
              setState({ status: 'done', data: hit })
              return
            }
            try {
              abortRef.current?.abort?.()
            } catch {
              // A settled request is not an error.
            }
            const controller = new AbortController()
            abortRef.current = controller
            setState({ status: 'busy' })
            try {
              const payload = await requestJson('/translate', { text, context: String(context ?? ''), mode }, controller.signal)
              if (abortRef.current !== controller) return
              if (!payload?.ok) {
                setState({ status: 'error', message: payload?.message || t('error.generic'), code: payload?.code })
                return
              }
              if (payload.skipped) {
                setState({ status: 'skip' })
                return
              }
              const data = {
                translation: String(payload.translation ?? ''),
                contextNote: String(payload.contextNote ?? ''),
                terms: Array.isArray(payload.terms) ? payload.terms : [],
                cached: Boolean(payload.cached),
                truncated: Boolean(payload.truncated),
                // A selection larger than one chunk can come back incomplete
                // when a later chunk fails; the card says so instead of
                // looking like a finished translation.
                partial: Boolean(payload.partial),
              }
              memoSet(mode, text, data)
              setState({ status: 'done', data })
            } catch (error) {
              if (error?.name === 'AbortError' || abortRef.current !== controller || !mountedRef.current) return
              setState({ status: 'error', message: t('error.network') })
            } finally {
              if (abortRef.current === controller) abortRef.current = null
            }
            return
          }

          // Reasoning: continue a saved partial result, replay a memo hit, or
          // ask for chunk 0 and follow `next` until it is null.
          let data = normalizePartial(resume)
          if (!data) {
            const hit = memoGet(mode, text)
            if (hit) {
              setState(hit.next != null ? { status: 'stopped', data: hit } : { status: 'done', data: hit })
              return
            }
            data = emptyPartial()
          }
          try {
            abortRef.current?.abort?.()
          } catch {
            // A settled request is not an error.
          }
          const controller = new AbortController()
          abortRef.current = controller
          setState({ status: 'busy', data })
          try {
            let index = data.next
            while (true) {
              const payload = await requestJson('/translate', { text, context: String(context ?? ''), mode, index }, controller.signal)
              // A newer run, a Stop click or an unmount owns the state now.
              if (!mountedRef.current || abortRef.current !== controller || controller.signal.aborted) return
              if (!payload?.ok) {
                const part = hasPart(payload) ? payload.part : null
                const failedIndex = part && Number.isFinite(Number(part.index)) ? Math.max(0, Math.floor(Number(part.index))) : index
                const count = part ? Math.max(1, Math.floor(Number(part.count)) || 1) : Math.max(0, Math.floor(Number(data.part?.count)) || 0)
                const next = Number.isInteger(payload?.next) && payload.next >= 0 ? payload.next : failedIndex
                const partial = {
                  translation: data.translation,
                  contextNote: data.contextNote,
                  terms: data.terms,
                  cached: data.cached,
                  truncated: data.truncated,
                  part: { done: Math.min(failedIndex, count), count },
                  next,
                }
                if (partial.translation) memoSet(mode, text, partial)
                setState({
                  status: 'error',
                  data: partial.translation ? partial : undefined,
                  message: payload?.message || t('error.generic'),
                  code: payload?.code,
                })
                return
              }
              if (payload.skipped) {
                if (!data.translation) {
                  setState({ status: 'skip' })
                  return
                }
                data = { ...data, next: null }
                memoSet(mode, text, data)
                setState({ status: 'done', data })
                return
              }
              const part = hasPart(payload) ? payload.part : null
              const count = part ? Math.max(1, Math.floor(Number(part.count)) || 1) : Math.max(1, Number(data.part?.count) || 1)
              const partIndex = part && Number.isFinite(Number(part.index)) ? Math.max(0, Math.floor(Number(part.index))) : index
              const done = part ? Math.min(count, partIndex + 1) : 1
              // An old Host answers one whole translation and carries no `next`.
              const requestedNext = part ? payload.next : null
              const next = Number.isInteger(requestedNext) && requestedNext > partIndex ? requestedNext : null
              data = {
                translation: appendTranslation(data.translation, payload.translation),
                contextNote: data.contextNote || String(payload.contextNote ?? ''),
                terms: mergeTerms(data.terms, payload.terms),
                cached: data.cached && Boolean(payload.cached),
                truncated: data.truncated || Boolean(payload.truncated),
                part: { done, count },
                next,
              }
              memoSet(mode, text, data)
              setState({ status: 'busy', data })
              if (next == null) {
                setState({ status: 'done', data })
                return
              }
              index = next
            }
          } catch (error) {
            if (error?.name === 'AbortError' || controller.signal.aborted || abortRef.current !== controller) return
            if (!mountedRef.current) return
            setState({ status: 'error', data: data.translation ? data : undefined, message: t('error.network') })
          } finally {
            if (abortRef.current === controller) abortRef.current = null
          }
        },
        [mode],
      )

      const reset = React.useCallback(() => setState({ status: 'idle' }), [])

      /** Bring back one memo result: a complete one, or a stopped partial one. */
      const restore = React.useCallback((data) => {
        if (abortRef.current) return
        if (!data) {
          setState({ status: 'idle' })
          return
        }
        setState(data.next != null ? { status: 'stopped', data } : { status: 'done', data })
      }, [])

      /** Stop the chunk in flight, keep every translated part and the resume point. */
      const stop = React.useCallback(() => {
        const controller = abortRef.current
        abortRef.current = null
        try {
          controller?.abort?.()
        } catch {
          // Nothing was in flight.
        }
        setState((previous) => {
          if (!previous || previous.status !== 'busy') return previous
          return previous.data ? { status: 'stopped', data: previous.data } : { status: 'stopped' }
        })
      }, [])

      React.useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          const controller = abortRef.current
          abortRef.current = null
          try {
            controller?.abort?.()
          } catch {
            // Unmount cancels quietly.
          }
        }
      }, [])

      return { state, run, reset, restore, stop }
    }


    async function saveTerm(term, source) {
      try {
        const payload = await requestJson('/vocab', {
          action: 'add',
          entry: { term: term.term, pos: term.pos, gloss: term.gloss, example: term.example, source },
        })
        if (payload?.ok) publishHostState({ vocabCount: (payload.entries ?? []).length })
      } catch (error) {
        logError('could not save a term', error)
      }
    }

    // ------------------------------------------------------------- composer

    const WRITE_METHODS = ['setText', 'replaceText', 'setDraftText', 'setValue', 'updateText', 'insertText']

    function extractDraftText(snapshot, depth = 0) {
      try {
        if (!snapshot || typeof snapshot !== 'object' || depth > 3) return ''
        const candidates = [
          snapshot.text,
          snapshot.value,
          snapshot.content,
          snapshot.plainText,
          snapshot.draft && snapshot.draft.text,
          snapshot.editor && snapshot.editor.text,
        ]
        for (const candidate of candidates) {
          if (typeof candidate === 'string' && candidate.trim()) return candidate
        }
        let best = ''
        let visited = 0
        for (const key of objectKeys(snapshot)) {
          const child = snapshot[key]
          if (!child || typeof child !== 'object') continue
          visited += 1
          if (visited > 24) break
          const nested = extractDraftText(child, depth + 1)
          if (nested.length > best.length) best = nested
        }
        for (const key of objectKeys(snapshot)) {
          const child = snapshot[key]
          if (typeof child !== 'string' || child.length <= best.length) continue
          if (child.length > 20000) continue
          best = child
        }
        return best
      } catch (error) {
        logError('could not read the composer state', error)
        return ''
      }
    }

    function applyDraftValue(actions, value) {
      if (!actions || typeof actions !== 'object') return false
      for (const name of WRITE_METHODS) {
        const method = actions[name]
        if (typeof method !== 'function') continue
        try {
          method.call(actions, value)
          return true
        } catch (error) {
          logError(`inputActions.${name} failed`, error)
        }
      }
      return false
    }

    // ------------------------------------------------------------ components

    const CSS = `
.dsh-tr-overlay{pointer-events:none}
.dsh-tr-pill{position:fixed;z-index:60;pointer-events:auto;appearance:none;display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:44px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:1;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:color .12s,border-color .12s}
.dsh-tr-pill:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-tr-menu{position:fixed;z-index:62;pointer-events:auto;display:flex;flex-direction:column;min-width:132px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 28px rgba(0,0,0,.24)}
.dsh-tr-menu-item{appearance:none;border:0;background:transparent;border-radius:6px;padding:6px 10px;text-align:left;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-tr-menu-item:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.dsh-tr-menu-sep{height:1px;margin:3px 6px;background:var(--dsw-alias-border-l1)}
.dsh-tr-float{position:fixed;z-index:61;pointer-events:auto;display:flex;flex-direction:column;gap:8px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 36px rgba(0,0,0,.26);padding:12px 14px}
.dsh-tr-float-head{display:flex;align-items:center;gap:8px}
.dsh-tr-float-title{flex:1;font-size:12px;font-weight:600;letter-spacing:.03em;color:var(--dsw-alias-label-secondary)}
.dsh-tr-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;padding:2px 4px;cursor:pointer;border-radius:6px}
.dsh-tr-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-src{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-idle-primary);border-top:1px solid var(--dsw-alias-border-l1);padding-top:6px;overflow-wrap:anywhere}
.dsh-tr-root{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-tr-pre{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dsh-tr-panel{display:flex;flex-direction:column;gap:6px}
.dsh-tr-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 10px;font-size:12px;line-height:18px;cursor:pointer;transition:color .12s,border-color .12s,background .12s}
.dsh-tr-chip:hover:not(:disabled){color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-tr-chip:disabled{opacity:.55;cursor:default}
.dsh-tr-chip.is-ghost{border-color:transparent;background:transparent}
.dsh-tr-tool{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;cursor:pointer}
.dsh-tr-tool:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-tool.is-wide{width:auto;padding:0 7px;font-size:11px}
.dsh-tr-tool:disabled{opacity:.6;cursor:default}
.dsh-tr-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.dsh-tr-float .dsh-tr-card,.dsh-tr-root .dsh-tr-card{border:0;background:transparent;padding:0}
.dsh-tr-card-head{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600;letter-spacing:.02em}
.dsh-tr-translation{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:13.5px;line-height:1.75}
.dsh-tr-context{display:flex;gap:6px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsh-tr-context-label{flex:0 0 auto;color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-tr-terms{display:flex;flex-wrap:wrap;gap:6px}
.dsh-tr-terms-block{display:flex;flex-direction:column;gap:5px}
.dsh-tr-terms-head{font-size:11.5px;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-term{display:inline-flex;align-items:center;gap:2px;max-width:100%;border:1px dashed var(--dsw-alias-border-l2);background:transparent;border-radius:8px;padding:3px 5px 3px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-tr-term:hover,.dsh-tr-term:focus-within{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.dsh-tr-term.is-saved{border-style:solid;border-color:var(--dsw-alias-brand-primary)}
.dsh-tr-term-save{appearance:none;display:inline-flex;align-items:baseline;gap:5px;max-width:100%;min-width:0;border:0;background:transparent;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;text-align:left;border-radius:4px}
.dsh-tr-term-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-tr-term .dsh-tr-ipa-wrap{max-width:110px;overflow:hidden;white-space:nowrap;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-term-speak{width:18px;height:18px;font-size:11px}
.dsh-tr-term-word{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-tr-term-pos{color:var(--dsw-alias-state-idle-primary);font-style:italic}
.dsh-tr-term-gloss{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.dsh-tr-term-star{color:var(--dsw-alias-brand-primary)}
.dsh-tr-speak{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:22px;height:22px;padding:0;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;transition:color .12s,border-color .12s,background .12s}
.dsh-tr-speak:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-speak:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-tr-speak.is-playing{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-tr-speak-icon{font-size:11px;line-height:1}
.dsh-tr-ipa-wrap{display:inline-flex;align-items:baseline;gap:4px;min-width:0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dsh-tr-ipa{white-space:nowrap}
.dsh-tr-ipa-tag{font-size:10.5px;letter-spacing:.04em;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-ipa-alt{white-space:nowrap;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-quick{display:flex;flex-direction:column;gap:6px;min-width:0;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:8px 10px}
.dsh-tr-quick-head{font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-quick-row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}
.dsh-tr-quick-word{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-tr-quick-lines{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-tr-quick-line{font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-tr-dict-block{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}
.dsh-tr-dict-lines{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-tr-dict-line{font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-tr-dict-rows{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-tr-dict-row{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:12.5px;line-height:1.5}
.dsh-tr-dict-row-word{flex:0 0 auto;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-tr-dict-row .dsh-tr-ipa-wrap{flex:0 1 auto;overflow:hidden}
.dsh-tr-dict-row-gloss{flex:1 1 60px;min-width:0;color:var(--dsw-alias-state-idle-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-tr-card-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-tr-link{appearance:none;border:0;background:transparent;padding:0;font-size:12px;color:var(--dsw-alias-brand-primary);cursor:pointer}
.dsh-tr-link:hover{text-decoration:underline}
.dsh-tr-badge{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.dsh-tr-muted{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dsh-tr-error{font-size:12.5px;color:var(--dsw-alias-state-error-primary)}
.dsh-tr-notes{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsh-tr-note-original{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}
.dsh-tr-note-suggestion{color:var(--dsw-alias-state-success-primary)}
.dsh-tr-note-reason{display:block;color:var(--dsw-alias-label-secondary)}
.dsh-tr-page{display:flex;flex-direction:column;gap:18px;padding:4px 2px 24px;max-width:760px}
.dsh-tr-page-intro{margin:0;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.dsh-tr-group{display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:4px 14px}
.dsh-tr-group-title{font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);padding:10px 0 6px}
.dsh-tr-row{display:flex;align-items:center;gap:14px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-tr-row:first-of-type{border-top:0}
.dsh-tr-row-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dsh-tr-row-label{font-size:13px;color:var(--dsw-alias-label-primary)}
.dsh-tr-row-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-tr-switch{appearance:none;flex:0 0 auto;width:38px;height:22px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:2px;cursor:pointer;display:flex;align-items:center;transition:background .15s,border-color .15s}
.dsh-tr-switch.is-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-tr-knob{width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s}
.dsh-tr-switch.is-on .dsh-tr-knob{transform:translateX(16px)}
.dsh-tr-select,.dsh-tr-input{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 8px;font-size:12.5px;line-height:20px;min-width:0}
.dsh-tr-input{min-width:150px}
.dsh-tr-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-tr-vocab-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0 10px}
.dsh-tr-vocab-search{flex:1 1 200px;min-width:170px}
.dsh-tr-vocab-count{font-size:11.5px;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-vocab-empty{padding:8px 0 14px}
.dsh-tr-vtable{display:flex;flex-direction:column;padding-bottom:4px}
.dsh-tr-vhead,.dsh-tr-vrow{display:grid;grid-template-columns:minmax(84px,1fr) 50px minmax(150px,2.4fr) 62px 20px;gap:10px;align-items:baseline;padding:6px 4px}
.dsh-tr-vrow.is-clickable{cursor:pointer}
.dsh-tr-vrow.is-clickable:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-vrow.is-open{background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-vdetail{display:flex;flex-direction:column;gap:8px;padding:10px 12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsh-tr-vdetail:last-child{border-bottom:0}
.dsh-tr-vrow:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-tr-word-head{display:flex;align-items:baseline;gap:8px}
.dsh-tr-word-term{font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-tr-word-pos{font-size:12px;font-style:italic;color:var(--dsw-alias-state-idle-primary)}
.dsh-tr-colloc{display:flex;flex-wrap:wrap;gap:6px}
.dsh-tr-colloc-item{font-size:12px;padding:2px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.dsh-tr-word-example{display:flex;flex-direction:column;gap:3px}
.dsh-tr-word-sentence{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:7px 10px;overflow-wrap:anywhere}
.dsh-tr-vhead{font-size:11px;letter-spacing:.04em;color:var(--dsw-alias-state-idle-primary);border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:6px}
.dsh-tr-vrow{border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);border-radius:4px}
.dsh-tr-vrow:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-vrow:last-child{border-bottom:0}
.dsh-tr-vterm{font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-tr-vpos{color:var(--dsw-alias-state-idle-primary);font-style:italic}
.dsh-tr-vgloss{overflow-wrap:anywhere}
.dsh-tr-vexample{color:var(--dsw-alias-state-idle-primary);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-tr-vtime{color:var(--dsw-alias-state-idle-primary);font-size:11.5px;white-space:nowrap}
.dsh-tr-vremove{appearance:none;border:0;background:transparent;color:var(--dsw-alias-state-idle-primary);font-size:14px;line-height:1;padding:0 2px;cursor:pointer;border-radius:4px}
.dsh-tr-vremove:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-tr-vocab-actions{display:flex;align-items:center;gap:12px;padding:10px 0 12px}
mark.dsh-tr-hit{background:transparent;color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-tr-foot{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsh-tr-warn{font-size:12px;line-height:1.6;color:var(--dsw-alias-state-warn-primary)}
`

    function Styles() {
      return h('style', { key: 'dsh-translate-styles' }, CSS)
    }

    function CopyButton({ value, label }) {
      const [copied, setCopied] = React.useState(false)
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-tr-link',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(String(value ?? ''))
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            } catch {
              setCopied(false)
            }
          },
        },
        copied ? t('action.copied') : label,
      )
    }

    /** The IPA for the chosen accent first, the other accent after a dot. */
    function Phonetic({ ipa, ipaUk, accent }) {
      const us = String(ipa ?? '').trim()
      const uk = String(ipaUk ?? '').trim()
      if (!us && !uk) return null
      const preferUk = accentOf(accent) === 'uk'
      const primary = preferUk ? uk || us : us || uk
      const primaryUk = preferUk ? Boolean(uk) : !us
      const other = primaryUk ? us : uk
      const extra = other && other !== primary ? other : ''
      return h(
        'span',
        { className: 'dsh-tr-ipa-wrap', lang: 'en' },
        h(
          'span',
          { className: 'dsh-tr-ipa' },
          h('span', { className: 'dsh-tr-ipa-tag' }, primaryUk ? t('phonetic.uk') : t('phonetic.us')),
          ' ',
          truncate(primary, 40),
        ),
        extra
          ? h(
            'span',
            { className: 'dsh-tr-ipa-alt' },
            '· ',
            h('span', { className: 'dsh-tr-ipa-tag' }, primaryUk ? t('phonetic.us') : t('phonetic.uk')),
            ' ',
            truncate(extra, 40),
          )
          : null,
      )
    }

    /** One word, one pronunciation, whichever card asked for it. */
    function SpeakButton({ text, accent, className, title }) {
      const [playing, setPlaying] = React.useState(false)
      const tone = accentOf(accent)
      const label = title || t(tone === 'uk' ? 'speak.uk' : 'speak.us')
      const value = String(text ?? '').trim()
      const prefetch = () => prefetchSpeech(speakUrl(value, tone))
      return h(
        'button',
        {
          type: 'button',
          className: `dsh-tr-speak${playing ? ' is-playing' : ''}${className ? ` ${className}` : ''}`,
          title: label,
          'aria-label': label,
          disabled: !value,
          onMouseEnter: prefetch,
          onFocus: prefetch,
          onClick: (event) => {
            event.preventDefault()
            // A chip may sit inside a clickable row: the sound is its own action.
            event.stopPropagation()
            setPlaying(true)
            playSpeech(value, tone, () => setPlaying(false))
          },
        },
        h('span', { className: 'dsh-tr-speak-icon', 'aria-hidden': 'true' }, playing ? '🔊' : '🔈'),
      )
    }

    /** 2–4 words: one compact line per word the dictionary knows. */
    function DictTokenRows({ entries, accent }) {
      if (!entries || !entries.length) return null
      return h(
        'div',
        { className: 'dsh-tr-dict-rows' },
        entries.map((entry) => {
          const word = entry.word || entry.query
          const gloss = translationLines(entry.translation, 1)[0] || ''
          return h(
            'div',
            { key: String(entry.query || word), className: 'dsh-tr-dict-row' },
            h('span', { className: 'dsh-tr-dict-row-word', lang: 'en' }, word),
            h(Phonetic, { ipa: entry.ipa, ipaUk: entry.ipaUk, accent }),
            h(SpeakButton, { text: word, accent }),
            gloss ? h('span', { className: 'dsh-tr-dict-row-gloss' }, gloss) : null,
          )
        }),
      )
    }

    /**
     * The offline gloss for a selection, above the model result: it shows up
     * while the translation is still running, so the reader never waits for it.
     */
    function QuickGloss({ text }) {
      const host = useHostState()
      const accent = accentOf((host.settings ?? {}).accent)
      const words = React.useMemo(() => tokensOf(text), [text])
      const dict = useDictionary(words)
      if (!words.length || !dict.entries.length) return null
      if (words.length === 1) {
        const entry = dict.entries[0]
        const word = entry.word || entry.query
        const lines = translationLines(entry.translation, 3)
        return h(
          'div',
          { className: 'dsh-tr-quick' },
          h('div', { className: 'dsh-tr-quick-head' }, t('dict.local')),
          h(
            'div',
            { className: 'dsh-tr-quick-row' },
            h('span', { className: 'dsh-tr-quick-word', lang: 'en' }, word),
            h(Phonetic, { ipa: entry.ipa, ipaUk: entry.ipaUk, accent }),
            h(SpeakButton, { text: word, accent }),
          ),
          lines.length
            ? h(
              'div',
              { className: 'dsh-tr-quick-lines' },
              lines.map((line, index) => h('div', { key: `line-${index}`, className: 'dsh-tr-quick-line' }, line)),
            )
            : null,
        )
      }
      return h(
        'div',
        { className: 'dsh-tr-quick' },
        h('div', { className: 'dsh-tr-quick-head' }, t('dict.local')),
        h(DictTokenRows, { entries: dict.entries, accent }),
      )
    }

    function Terms({ terms, source }) {
      const host = useHostState()
      const [saved, setSaved] = React.useState(() => new Set())
      const accent = accentOf((host.settings ?? {}).accent)
      // Only single-word chips carry a phonetic: a phrase has no one entry.
      const words = React.useMemo(() => {
        const singles = []
        for (const term of Array.isArray(terms) ? terms : []) {
          const tokens = tokensOf(String(term?.term ?? ''))
          if (tokens.length === 1) singles.push(tokens[0])
        }
        return normalizeDictWords(singles)
      }, [terms])
      useDictionary(words)
      if (!terms || !terms.length) return null
      return h(
        'div',
        { className: 'dsh-tr-terms' },
        terms.map((term) => {
          const key = String(term.term ?? '')
          const isSaved = saved.has(key)
          const known = dictMemoGet(key)
          const entry = known && known.found ? known : null
          return h(
            'div',
            { key, className: `dsh-tr-term${isSaved ? ' is-saved' : ''}` },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-tr-term-save',
                title: isSaved ? t('terms.saved') : t('terms.save'),
                'aria-label': `${isSaved ? t('terms.saved') : t('terms.save')} ${key}`,
                onClick: () => {
                  if (isSaved) return
                  setSaved((previous) => {
                    const next = new Set(previous)
                    next.add(key)
                    return next
                  })
                  void saveTerm(term, source)
                },
              },
              h('span', { className: 'dsh-tr-term-word' }, key),
              term.pos ? h('span', { className: 'dsh-tr-term-pos' }, term.pos) : null,
              entry ? h(Phonetic, { ipa: entry.ipa, ipaUk: entry.ipaUk, accent }) : null,
              term.gloss ? h('span', { className: 'dsh-tr-term-gloss' }, term.gloss) : null,
              h('span', { className: 'dsh-tr-term-star' }, isSaved ? '★' : '☆'),
            ),
            key ? h(SpeakButton, { text: key, accent, className: 'dsh-tr-term-speak' }) : null,
          )
        }),
      )
    }

    /** The result itself: translation, context note and the term chips. */
    function TranslationBody({ data, showTerms, showContext, source }) {
      return h(
        React.Fragment,
        null,
        h('div', { className: 'dsh-tr-translation', lang: 'zh-CN' }, data.translation || ''),
        showContext && data.contextNote
          ? h('div', { className: 'dsh-tr-context' }, h('span', { className: 'dsh-tr-context-label' }, t('context.title')), h('span', null, data.contextNote))
          : null,
        showTerms && data.terms && data.terms.length
          ? h(
            'div',
            { className: 'dsh-tr-terms-block' },
            h('div', { className: 'dsh-tr-terms-head' }, t('terms.title'), ' · ', t('terms.hint')),
            h(Terms, { terms: data.terms, source }),
          )
          : null,
      )
    }

    /**
     * The result of one translation run. A long reasoning block arrives part by
     * part, so the card grows while it runs, keeps every translated part when a
     * part fails or the reader stops, and offers the action that fits.
     */
    function ResultCard({ state, onRetry, onStop, onContinue, showTerms, showContext, source }) {
      if (!state || state.status === 'idle') return null
      if (state.status === 'skip') return h('div', { className: 'dsh-tr-muted' }, t('state.skipped'))
      const data = state.data ?? null
      const progress = progressLabel(data)
      const partialBadge = data && data.part && Number(data.part.count) > 1
        ? h('span', { className: 'dsh-tr-badge' }, t('state.partial'))
        : null
      const body = data && (String(data.translation ?? '') || (showContext && data.contextNote) || (showTerms && data.terms && data.terms.length))
        ? h(TranslationBody, { data, showTerms, showContext, source })
        : null

      if (state.status === 'busy') {
        if (!body) {
          // Nothing has arrived yet. A selection keeps its plain "translating…"
          // line; the chunked reasoning run also offers Stop from the first part.
          if (!onStop) return h('div', { className: 'dsh-tr-muted' }, t('state.busy'))
          return h(
            'div',
            { className: 'dsh-tr-card' },
            h('span', { className: 'dsh-tr-muted' }, t('state.busy')),
            h(
              'div',
              { className: 'dsh-tr-card-actions' },
              progress ? h('span', { className: 'dsh-tr-badge' }, progress) : null,
              h('button', { type: 'button', className: 'dsh-tr-link', onClick: onStop }, t('state.stop')),
            ),
          )
        }
        return h(
          'div',
          { className: 'dsh-tr-card' },
          body,
          h(
            'div',
            { className: 'dsh-tr-card-actions' },
            progress ? h('span', { className: 'dsh-tr-badge' }, progress) : null,
            data.truncated ? h('span', { className: 'dsh-tr-badge' }, t('state.truncated')) : null,
            h(CopyButton, { value: data.translation, label: t('action.copy') }),
            h('button', { type: 'button', className: 'dsh-tr-link', onClick: onStop }, t('state.stop')),
          ),
        )
      }

      if (state.status === 'stopped') {
        return h(
          'div',
          { className: 'dsh-tr-card' },
          body,
          h('div', { className: 'dsh-tr-muted' }, t('state.stopped')),
          h(
            'div',
            { className: 'dsh-tr-card-actions' },
            partialBadge,
            data ? h(CopyButton, { value: data.translation, label: t('action.copy') }) : null,
            onContinue ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: onContinue }, t('action.continue')) : null,
          ),
        )
      }

      if (state.status === 'error') {
        if (!body) {
          // Nothing usable: the same compact error card a selection failure uses.
          return h(
            'div',
            { className: 'dsh-tr-card' },
            h('span', { className: 'dsh-tr-error' }, state.message || t('error.generic')),
            onRetry ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: onRetry }, t('action.retry')) : null,
          )
        }
        return h(
          'div',
          { className: 'dsh-tr-card' },
          body,
          h(
            'div',
            { className: 'dsh-tr-card-actions' },
            partialBadge,
            h('span', { className: 'dsh-tr-error' }, state.message || t('error.generic')),
            partialHintLabel(data) ? h('span', { className: 'dsh-tr-muted' }, partialHintLabel(data)) : null,
          ),
          h(
            'div',
            { className: 'dsh-tr-card-actions' },
            h(CopyButton, { value: data.translation, label: t('action.copy') }),
            onRetry ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: onRetry }, t('action.retry')) : null,
          ),
        )
      }

      // Done keeps the layout it has always had, including the truncated badge
      // an old Host still sends for the text it sliced.
      return h(
        'div',
        { className: 'dsh-tr-card' },
        body,
        h(
          'div',
          { className: 'dsh-tr-card-actions' },
          data && data.cached ? h('span', { className: 'dsh-tr-badge' }, t('state.cached')) : null,
          data && data.truncated ? h('span', { className: 'dsh-tr-badge' }, t('state.truncated')) : null,
          data && data.partial ? h('span', { className: 'dsh-tr-badge' }, t('state.partial')) : null,
          h(CopyButton, { value: data ? data.translation : '', label: t('action.copy') }),
          onRetry ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: onRetry }, t('action.retry')) : null,
        ),
      )
    }

    function renderOfficialReasoning(props, text) {
      if (typeof props.renderFactorySlot === 'function') {
        try {
          const node = props.renderFactorySlot('conversation.chat.reasoning.content', {
            rawText: props.rawText,
            text: props.text,
            running: props.running,
          })
          if (node !== null && node !== undefined && node !== false) return node
        } catch (error) {
          logError('the reasoning content factory is unavailable; rendering plain text', error)
        }
      }
      return h('div', { className: 'dsh-tr-pre' }, text)
    }

    /** conversation.chat.reasoning.body — original text plus its translation. */
    function ReasoningBody(props) {
      const host = useHostState()
      const settings = host.settings ?? {}
      const text = String(props.text ?? props.rawText ?? '')
      const running = Boolean(props.running)
      const { state, run, restore, stop } = useTranslationRun('reasoning')
      const enabled = hostEnabled(host)
      const translatable = enabled && hasLatin(text)
      const status = state.status

      React.useEffect(() => {
        // A cached result survives collapse/expand without a new request; a
        // partly translated block comes back stopped and never refetches itself.
        // The memo is keyed by the trimmed text the request sends.
        restore(memoGet('reasoning', text.trim()))
      }, [text, restore])

      React.useEffect(() => {
        if (!translatable || running) return
        if (!settings.autoTranslate) return
        if (status !== 'idle') return
        void run(text, '')
      }, [translatable, running, settings.autoTranslate, status, text, run])

      return h(
        'div',
        { className: 'dsh-tr-root' },
        h(Styles),
        renderOfficialReasoning(props, text),
        translatable
          ? h(
            'div',
            { className: 'dsh-tr-panel' },
            status === 'idle'
              ? h(
                'div',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-tr-chip',
                    disabled: running,
                    title: running ? t('state.running') : t('action.translate'),
                    onClick: () => {
                      void run(text, '')
                    },
                  },
                  running ? t('state.running') : t('action.translate'),
                ),
              )
              : h(ResultCard, {
                state,
                showTerms: settings.showTerms !== false,
                showContext: settings.showContext !== false,
                source: 'reasoning',
                onStop: () => stop(),
                onContinue: () => {
                  void run(text, '', state.data)
                },
                onRetry: () => {
                  void run(text, '', state.data)
                },
              }),
          )
          : null,
      )
    }

    /** shell.overlay — the selection pill and its anchored card. */
    function LearningOverlay() {
      const host = useHostState()
      const settings = host.settings ?? {}
      const localPrefs = usePrefs()
      const enabled = hostEnabled(host)
      // Translating on selection only makes sense when the route is fast: a
      // local CPU model takes about a minute per paragraph, so it waits for a
      // click instead of firing on every drag.
      const routeIsFast = (host.engine ?? 'cloud') === 'cloud'
      const autoSelection = localPrefs.autoSelection !== false && routeIsFast
      const { state: translateState, run: translateRun, reset: translateReset } = useTranslationRun('selection')
      const [anchor, setAnchor] = React.useState(null)
      const [panel, setPanel] = React.useState(null)
      const [menu, setMenu] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      const cardRef = React.useRef(null)
      const lastAutoRef = React.useRef('')

      const closePanel = React.useCallback(() => {
        setPanel(null)
        setNotice('')
        translateReset()
      }, [translateReset])

      const openTranslation = React.useCallback(
        (selection) => {
          if (!selection || !selection.text) return
          setNotice('')
          setMenu(null)
          setAnchor(null)
          setPanel({ kind: 'translate', text: selection.text, context: selection.context, rect: selection.rect, range: selection.range })
          void translateRun(selection.text, selection.context)
        },
        [translateRun],
      )

      // Watch the document selection: translate as soon as English is selected
      // (default), or offer a pill beside the text when the reader prefers an
      // explicit click.
      React.useEffect(() => {
        if (!enabled) {
          setAnchor(null)
          return undefined
        }
        let timer = null
        const measure = () => {
          timer = null
          const selection = readSelection()
          if (!selection) {
            lastAutoRef.current = ''
            setAnchor(null)
            return
          }
          if (!autoSelection) {
            setAnchor(selection)
            return
          }
          if (lastAutoRef.current === selection.text) return
          lastAutoRef.current = selection.text
          openTranslation(selection)
        }
        const schedule = () => {
          if (timer) window.clearTimeout(timer)
          timer = window.setTimeout(measure, 220)
        }
        document.addEventListener('selectionchange', schedule)
        document.addEventListener('mouseup', schedule, true)
        document.addEventListener('keyup', schedule, true)
        return () => {
          document.removeEventListener('selectionchange', schedule)
          document.removeEventListener('mouseup', schedule, true)
          document.removeEventListener('keyup', schedule, true)
          if (timer) window.clearTimeout(timer)
        }
      }, [enabled, autoSelection, openTranslation])

      // Panels requested by the composer's 中→英 button. The draft conversion
      // already happened there; the overlay only shows the result and the undo.
      React.useEffect(
        () =>
          subscribePanel((request) => {
            if (!request) return
            setNotice('')
            setMenu(null)
            setPanel(request)
            if (request.kind === 'translate') void translateRun(request.text, request.context)
          }),
        [translateRun],
      )

      // Right-click on selected English offers the same action in a menu.
      React.useEffect(() => {
        if (!enabled) return undefined
        const onContextMenu = (event) => {
          const target = event.target
          if (target instanceof Element && typeof target.closest === 'function') {
            if (target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return
            if (target.closest(`[${SURFACE}]`)) return
          }
          const selection = readSelection()
          if (!selection) return
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY, selection })
        }
        const onScroll = () => setMenu(null)
        document.addEventListener('contextmenu', onContextMenu, true)
        document.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('contextmenu', onContextMenu, true)
          document.removeEventListener('scroll', onScroll, true)
        }
      }, [enabled])

      // Dismiss the card on Escape and on a pointer press outside it.
      React.useEffect(() => {
        if (!panel) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') closePanel()
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (target instanceof Element && typeof target.closest === 'function' && target.closest(`[${SURFACE}]`)) return
          const card = cardRef.current
          if (card && target instanceof Node && card.contains(target)) return
          closePanel()
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [panel, closePanel])

      // Dismiss the menu the same way.
      React.useEffect(() => {
        if (!menu) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setMenu(null)
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (target instanceof Element && typeof target.closest === 'function' && target.closest(`[${SURFACE}]`)) return
          setMenu(null)
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [menu])

      // Keep the card glued to its range while the conversation scrolls.
      const range = panel && panel.range
      React.useEffect(() => {
        if (!range) return undefined
        let frame = 0
        const reposition = () => {
          if (frame) return
          frame = window.requestAnimationFrame(() => {
            frame = 0
            try {
              const rect = range.getBoundingClientRect()
              if (!rect || (!rect.width && !rect.height)) return
              setPanel((current) => (current && current.range === range ? { ...current, rect: rectToPlain(rect) } : current))
            } catch {
              // A detached range keeps its last position.
            }
          })
        }
        document.addEventListener('scroll', reposition, true)
        window.addEventListener('resize', reposition)
        return () => {
          document.removeEventListener('scroll', reposition, true)
          window.removeEventListener('resize', reposition)
          if (frame) window.cancelAnimationFrame(frame)
        }
      }, [range])

      if (!enabled) return null

      const pill = !autoSelection && anchor ? placePill(anchor.rect) : null
      const card = panel ? placeCard(panel.rect) : null
      const menuPlacement = menu ? placeMenu(menu.x, menu.y, 2) : null

      const undoDraft = () => {
        const ok = panel && typeof panel.restore === 'function' ? panel.restore() : false
        if (ok) closePanel()
        return ok
      }

      return h(
        'div',
        { className: 'dsh-tr-overlay' },
        h(Styles),
        pill
          ? h(
            'button',
            {
              key: 'pill',
              type: 'button',
              className: 'dsh-tr-pill',
              [SURFACE]: '1',
              style: { left: `${pill.left}px`, top: `${pill.top}px`, width: `${pill.width}px` },
              title: t('pill.title'),
              // Keeping the selection alive on mousedown is what makes the
              // click read the text the user just selected.
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => openTranslation(anchor),
            },
            t('pill.label'),
          )
          : null,
        menuPlacement
          ? h(
            'div',
            {
              key: 'menu',
              className: 'dsh-tr-menu',
              [SURFACE]: '1',
              style: { left: `${menuPlacement.left}px`, top: `${menuPlacement.top}px`, width: `${menuPlacement.width}px` },
              onContextMenu: (event) => event.preventDefault(),
            },
            h('button', { type: 'button', className: 'dsh-tr-menu-item', onClick: () => openTranslation(menu.selection) }, t('menu.translate')),
            h('div', { className: 'dsh-tr-menu-sep' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-tr-menu-item',
                onClick: () => {
                  void copyText(menu.selection.text)
                  setMenu(null)
                },
              },
              t('menu.copy'),
            ),
          )
          : null,
        panel
          ? h(
            'div',
            {
              key: 'card',
              ref: cardRef,
              className: 'dsh-tr-float',
              [SURFACE]: '1',
              style: { left: `${card.left}px`, top: `${card.top}px`, width: `${card.width}px`, maxHeight: `${card.maxHeight}px` },
            },
            h(
              'div',
              { className: 'dsh-tr-float-head' },
              h('span', { className: 'dsh-tr-float-title' }, panel.kind === 'draft' ? t('toEnglish.title') : t('action.translate')),
              h('button', { type: 'button', className: 'dsh-tr-close', title: t('action.close'), onClick: closePanel }, '×'),
            ),
            panel.kind === 'draft'
              ? h(DraftResult, { panel, onUndo: undoDraft })
              : h(
                React.Fragment,
                null,
                h(QuickGloss, { text: panel.text }),
                h(ResultCard, {
                  state: translateState,
                  showTerms: settings.showTerms !== false,
                  showContext: settings.showContext !== false,
                  source: 'selection',
                  onRetry: () => void translateRun(panel.text, panel.context),
                }),
              ),
            notice ? h('div', { className: 'dsh-tr-muted' }, notice) : null,
            panel.kind === 'translate' ? h('div', { className: 'dsh-tr-src' }, truncate(panel.text, 260)) : null,
          )
          : null,
      )
    }

    /** A saved term opened from the notebook: the reading card, for one word. */
    function WordDetail({ entry }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
      }, [])
      return h('div', { className: 'dsh-tr-vdetail', ref }, h(WordCard, { entry }))
    }

    function WordCard({ entry }) {
      const host = useHostState()
      const memoId = String(entry?.id ?? entry?.term ?? '')
      const [state, setState] = React.useState(() => {
        const hit = memoGet('explain', memoId)
        return hit ? { status: 'done', data: hit } : { status: 'idle' }
      })
      // A local CPU model takes too long to fire on a plain click; there the
      // reader asks for the explanation explicitly.
      const autoExplain = (host.engine ?? 'cloud') === 'cloud'
      const term = String(entry?.term ?? '')
      const accent = accentOf((host.settings ?? {}).accent)
      const dictWords = React.useMemo(() => tokensOf(term), [term])
      const dict = useDictionary(dictWords)

      const run = React.useCallback(async () => {
        const hit = memoGet('explain', memoId)
        if (hit) {
          setState({ status: 'done', data: hit })
          return
        }
        setState({ status: 'busy' })
        try {
          const payload = await requestJson('/explain', {
            term,
            pos: entry?.pos ?? '',
            gloss: entry?.gloss ?? '',
            example: entry?.example ?? '',
          })
          if (!payload?.ok) {
            setState({ status: 'error', message: payload?.message || t('error.generic') })
            return
          }
          const data = {
            meaning: String(payload.meaning ?? ''),
            usage: String(payload.usage ?? ''),
            collocations: Array.isArray(payload.collocations) ? payload.collocations.map(String) : [],
            example: String(payload.example ?? ''),
          }
          memoSet('explain', memoId, data)
          setState({ status: 'done', data })
        } catch {
          setState({ status: 'error', message: t('error.network') })
        }
      }, [memoId, term, entry?.pos, entry?.gloss, entry?.example])

      React.useEffect(() => {
        if (!autoExplain) return
        if (state.status !== 'idle') return
        void run()
      }, [autoExplain, state.status, run])

      const data = state.status === 'done' ? state.data : null
      const example = (data && data.example) || entry?.example || ''
      const copyValue = [term, entry?.pos, entry?.gloss, example].filter(Boolean).join('\n')
      // A single word gets a phonetic and its gloss lines; a phrase is read
      // token by token, because no one entry covers it.
      const dictEntry = dictWords.length === 1 ? dict.entries[0] ?? null : null
      const dictLines = dictEntry ? translationLines(dictEntry.translation, 4) : []
      const dictRows = dictWords.length > 1 ? dict.entries : []
      const dictBlock = dictLines.length
        ? h(
          'div',
          { className: 'dsh-tr-dict-block' },
          h('div', { className: 'dsh-tr-terms-head' }, t('dict.entry')),
          h(
            'div',
            { className: 'dsh-tr-dict-lines' },
            dictLines.map((line, index) => h('div', { key: `dict-${index}`, className: 'dsh-tr-dict-line' }, line)),
          ),
        )
        : dictRows.length
          ? h(
            'div',
            { className: 'dsh-tr-dict-block' },
            h('div', { className: 'dsh-tr-terms-head' }, t('dict.entry')),
            h(DictTokenRows, { entries: dictRows, accent }),
          )
          : null

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dsh-tr-word-head' },
          h('span', { className: 'dsh-tr-word-term', lang: 'en' }, term),
          entry?.pos ? h('span', { className: 'dsh-tr-word-pos' }, entry.pos) : null,
          dictEntry ? h(Phonetic, { ipa: dictEntry.ipa, ipaUk: dictEntry.ipaUk, accent }) : null,
          term ? h(SpeakButton, { text: term, accent }) : null,
        ),
        entry?.gloss ? h('div', { className: 'dsh-tr-translation' }, entry.gloss) : null,
        dictBlock,
        state.status === 'busy' ? h('div', { className: 'dsh-tr-muted' }, t('state.busy')) : null,
        state.status === 'error'
          ? h(
            'div',
            { className: 'dsh-tr-card' },
            h('span', { className: 'dsh-tr-error' }, state.message || t('error.generic')),
            h('button', { type: 'button', className: 'dsh-tr-link', onClick: () => void run() }, t('action.retry')),
          )
          : null,
        data && data.usage
          ? h('div', { className: 'dsh-tr-context' }, h('span', { className: 'dsh-tr-context-label' }, t('word.usage')), h('span', null, data.usage))
          : null,
        data && data.collocations.length
          ? h(
            'div',
            { className: 'dsh-tr-terms-block' },
            h('div', { className: 'dsh-tr-terms-head' }, t('word.collocations')),
            h('div', { className: 'dsh-tr-colloc' }, data.collocations.map((item) => h('code', { key: item, className: 'dsh-tr-colloc-item' }, item))),
          )
          : null,
        example
          ? h(
            'div',
            { className: 'dsh-tr-word-example' },
            h('div', { className: 'dsh-tr-terms-head' }, t('word.example')),
            h('div', { className: 'dsh-tr-word-sentence' }, example),
          )
          : null,
        h(
          'div',
          { className: 'dsh-tr-card-actions' },
          h(CopyButton, { value: copyValue, label: t('action.copy') }),
          state.status !== 'busy' && !autoExplain && state.status === 'idle'
            ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: () => void run() }, t('word.explain'))
            : null,
        ),
      )
    }

    /** The 中→英 result: the English already sits in the composer, with undo. */
    function DraftResult({ panel, onUndo }) {
      if (panel.error) return h('div', { className: 'dsh-tr-error' }, panel.error)
      return h(
        React.Fragment,
        null,
        panel.applied === false ? h('div', { className: 'dsh-tr-muted' }, t('toEnglish.copied')) : null,
        h('div', { className: 'dsh-tr-translation' }, panel.text || ''),
        panel.notes && panel.notes.length
          ? h(
            'ul',
            { className: 'dsh-tr-notes' },
            panel.notes.map((note, index) =>
              h(
                'li',
                { key: String(index) },
                note.original ? h('code', { className: 'dsh-tr-note-original' }, note.original) : null,
                note.suggestion ? h('span', { className: 'dsh-tr-note-suggestion' }, ` → ${note.suggestion}`) : null,
                note.reason ? h('span', { className: 'dsh-tr-note-reason' }, note.reason) : null,
              ),
            ),
          )
          : null,
        h(
          'div',
          { className: 'dsh-tr-card-actions' },
          panel.applied !== false && typeof panel.restore === 'function'
            ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: onUndo }, t('toEnglish.undo'))
            : null,
          h(CopyButton, { value: panel.text, label: t('action.copy') }),
        ),
      )
    }

    /** conversation.input.right — rewrite a Chinese draft in English in place. */
    function DraftToEnglishButton(props) {
      const host = useHostState()
      const enabled = hostEnabled(host)
      const [busy, setBusy] = React.useState(false)
      const inputSnapshot = (() => {
        if (typeof props.useInput !== 'function') return undefined
        try {
          return props.useInput((snapshot) => snapshot)
        } catch (error) {
          logError('the composer input hook failed', error)
          return undefined
        }
      })()
      const draft = extractDraftText(inputSnapshot).trim()
      if (!enabled) return null
      // Only offered while the draft contains Chinese: the one case where the
      // button has something to do.
      if (!hasChinese(draft) || draft.length < 2) return null
      const actions = props.inputActions
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-tr-tool is-wide',
          title: t('toEnglish.buttonTitle'),
          'aria-label': t('toEnglish.buttonTitle'),
          disabled: busy,
          onClick: async (event) => {
            const element = event && event.currentTarget
            const rect = element && typeof element.getBoundingClientRect === 'function' ? rectToPlain(element.getBoundingClientRect()) : null
            setBusy(true)
            try {
              const payload = await requestJson('/toenglish', { text: draft })
              if (!payload?.ok) {
                openPanel({ kind: 'draft', rect, error: payload?.message || t('error.generic') })
                return
              }
              const english = String(payload.english ?? '')
              const applied = applyDraftValue(actions, english)
              if (!applied) await copyText(english)
              openPanel({
                kind: 'draft',
                rect,
                text: english,
                original: draft,
                applied,
                notes: Array.isArray(payload.notes) ? payload.notes : [],
                restore: () => applyDraftValue(actions, draft),
              })
            } catch {
              openPanel({ kind: 'draft', rect, error: t('error.network') })
            } finally {
              setBusy(false)
            }
          },
        },
        busy ? t('toEnglish.busy') : t('toEnglish.label'),
      )
    }

    function Switch({ checked, onChange, label, hint }) {
      return h(
        'div',
        { className: 'dsh-tr-row' },
        h('div', { className: 'dsh-tr-row-main' }, h('span', { className: 'dsh-tr-row-label' }, label), hint ? h('span', { className: 'dsh-tr-row-hint' }, hint) : null),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': label,
            className: `dsh-tr-switch${checked ? ' is-on' : ''}`,
            onClick: () => onChange(!checked),
          },
          h('span', { className: 'dsh-tr-knob' }),
        ),
      )
    }

    /** settings.section — preferences, model route and the vocabulary notebook. */
    function SettingsPage() {
      const host = useHostState()
      const settings = host.settings ?? {}
      const localPrefs = usePrefs()
      const [vocab, setVocab] = React.useState([])
      const [vocabError, setVocabError] = React.useState('')
      const [vocabQuery, setVocabQuery] = React.useState('')
      const [vocabRange, setVocabRange] = React.useState('all')
      const [vocabSort, setVocabSort] = React.useState('new')
      const [savedAt, setSavedAt] = React.useState(0)
      const [provider, setProvider] = React.useState(settings.model?.provider ?? '')
      const [modelId, setModelId] = React.useState(settings.model?.model ?? '')
      const [baseUrlDraft, setBaseUrlDraft] = React.useState(settings.localBaseUrl ?? '')
      const [localModels, setLocalModels] = React.useState([])
      const [localBusy, setLocalBusy] = React.useState(false)
      const [localNote, setLocalNote] = React.useState('')
      const engine = settings.engine ?? 'cloud'
      const accent = accentOf(settings.accent)
      const dictInfo = host.dict ?? null
      const dictCount = Number(dictInfo?.count) || 0
      const dictReady = Boolean(dictInfo) && dictInfo.available !== false && dictCount > 0

      React.useEffect(() => {
        setProvider(settings.model?.provider ?? '')
        setModelId(settings.model?.model ?? '')
      }, [settings.model?.provider, settings.model?.model])

      React.useEffect(() => {
        setBaseUrlDraft(settings.localBaseUrl ?? '')
      }, [settings.localBaseUrl])

      const loadLocalModels = React.useCallback(async () => {
        setLocalBusy(true)
        try {
          const payload = await requestJson('/local/models')
          if (payload?.ok) {
            setLocalModels(Array.isArray(payload.models) ? payload.models : [])
            setLocalNote((payload.models ?? []).length ? '' : t('settings.localNone'))
          } else {
            setLocalModels([])
            setLocalNote(payload?.message ? interpolate(t('settings.localUnavailable'), { msg: payload.message }) : t('settings.localNone'))
          }
        } catch {
          setLocalNote(t('error.network'))
        } finally {
          setLocalBusy(false)
        }
      }, [])

      React.useEffect(() => {
        if (engine === 'cloud') return
        void loadLocalModels()
      }, [engine, loadLocalModels])

      const loadVocab = React.useCallback(async () => {
        try {
          const payload = await requestJson('/vocab')
          if (payload?.ok) {
            setVocab(Array.isArray(payload.entries) ? payload.entries : [])
            publishHostState({ vocabCount: (payload.entries ?? []).length })
          }
        } catch {
          setVocabError(t('error.network'))
        }
      }, [])

      React.useEffect(() => {
        void loadVocab()
      }, [loadVocab])

      const patch = React.useCallback(async (change) => {
        try {
          const payload = await saveSettings(change)
          if (payload?.ok) {
            setSavedAt(Date.now())
            setVocabError('')
          } else {
            setVocabError(payload?.message || t('error.generic'))
          }
        } catch {
          setVocabError(t('error.network'))
        }
      }, [])

      const removeVocab = React.useCallback(async (id) => {
        try {
          const payload = await requestJson('/vocab', { action: 'remove', id })
          if (payload?.ok) {
            setVocab(payload.entries ?? [])
            publishHostState({ vocabCount: (payload.entries ?? []).length })
          }
        } catch {
          setVocabError(t('error.network'))
        }
      }, [])

      const clearVocab = React.useCallback(async () => {
        try {
          const payload = await requestJson('/vocab', { action: 'clear' })
          if (payload?.ok) {
            setVocab([])
            publishHostState({ vocabCount: 0 })
          }
        } catch {
          setVocabError(t('error.network'))
        }
      }, [])

      const clearCache = React.useCallback(async () => {
        try {
          const payload = await requestJson('/cache/clear', {})
          if (payload?.ok) publishHostState({ cacheSize: 0 })
        } catch {
          setVocabError(t('error.network'))
        }
      }, [])

      // Search, time filter and sort over the notebook. The table is small, so
      // filtering in the browser keeps typing instant.
      const visibleVocab = React.useMemo(() => {
        const now = Date.now()
        const query = vocabQuery.trim().toLowerCase()
        const since =
          vocabRange === 'today' ? startOfDay(now)
            : vocabRange === 'week' ? now - 7 * 86400000
              : vocabRange === 'month' ? now - 30 * 86400000
                : 0
        const rows = (Array.isArray(vocab) ? vocab : []).filter((entry) => {
          if (since > 0 && Number(entry?.createdAt ?? 0) < since) return false
          if (!query) return true
          const haystack = `${entry?.term ?? ''} ${entry?.pos ?? ''} ${entry?.gloss ?? ''} ${entry?.example ?? ''}`.toLowerCase()
          return haystack.includes(query)
        })
        if (vocabSort === 'az') rows.sort((left, right) => String(left?.term ?? '').localeCompare(String(right?.term ?? '')))
        else if (vocabSort === 'old') rows.sort((left, right) => Number(left?.createdAt ?? 0) - Number(right?.createdAt ?? 0))
        else rows.sort((left, right) => Number(right?.createdAt ?? 0) - Number(left?.createdAt ?? 0))
        return rows
      }, [vocab, vocabQuery, vocabRange, vocabSort])

      const modelLabel = host.model ? `${host.model.provider}/${host.model.model}` : ''
      const cacheSize = host.cacheSize ?? 0

      // Opening a row expands it in place: the settings panel is a modal, so a
      // frame-level floating card would sit behind it.
      const [openWordId, setOpenWordId] = React.useState('')
      const toggleWord = (entry) => {
        const id = String(entry.id ?? entry.term ?? '')
        setOpenWordId((current) => (current === id ? '' : id))
      }

      return h(
        'div',
        { className: 'dsh-tr-page' },
        h(Styles),
        h('p', { className: 'dsh-tr-page-intro' }, t('settings.intro')),

        // The notebook sits first: it is the one thing worth coming back to.
        h(
          'div',
          { className: 'dsh-tr-group' },
          h('div', { className: 'dsh-tr-group-title' }, `${t('settings.groupVocab')} · ${interpolate(t('settings.vocabCount'), { n: vocab.length })}`),
          vocab.length === 0
            ? null
            : h(
              'div',
              { className: 'dsh-tr-vocab-toolbar' },
              h('input', {
                className: 'dsh-tr-input dsh-tr-vocab-search',
                type: 'search',
                value: vocabQuery,
                placeholder: t('settings.vocabSearch'),
                'aria-label': t('settings.vocabSearch'),
                onChange: (event) => setVocabQuery(event.target.value),
              }),
              h(
                'select',
                {
                  className: 'dsh-tr-select',
                  value: vocabRange,
                  'aria-label': t('settings.vocabRangeAll'),
                  onChange: (event) => setVocabRange(event.target.value),
                },
                h('option', { value: 'all' }, t('settings.vocabRangeAll')),
                h('option', { value: 'today' }, t('settings.vocabRangeToday')),
                h('option', { value: 'week' }, t('settings.vocabRangeWeek')),
                h('option', { value: 'month' }, t('settings.vocabRangeMonth')),
              ),
              h(
                'select',
                {
                  className: 'dsh-tr-select',
                  value: vocabSort,
                  'aria-label': t('settings.vocabSortNew'),
                  onChange: (event) => setVocabSort(event.target.value),
                },
                h('option', { value: 'new' }, t('settings.vocabSortNew')),
                h('option', { value: 'old' }, t('settings.vocabSortOld')),
                h('option', { value: 'az' }, t('settings.vocabSortAz')),
              ),
              h('span', { className: 'dsh-tr-vocab-count' }, interpolate(t('settings.vocabFiltered'), { m: visibleVocab.length, n: vocab.length })),
            ),
          vocab.length === 0
            ? h('div', { className: 'dsh-tr-vocab-empty' }, h('span', { className: 'dsh-tr-muted' }, t('settings.vocabEmpty')))
            : visibleVocab.length === 0
              ? h('div', { className: 'dsh-tr-vocab-empty' }, h('span', { className: 'dsh-tr-muted' }, t('settings.vocabNoMatch')))
              : h(
                'div',
                { className: 'dsh-tr-vtable' },
                h(
                  'div',
                  { className: 'dsh-tr-vhead' },
                  h('span', null, t('settings.vocabColTerm')),
                  h('span', null, t('settings.vocabColPos')),
                  h('span', null, t('settings.vocabColGloss')),
                  h('span', { className: 'dsh-tr-vtime' }, t('settings.vocabColTime')),
                  h('span', null, ''),
                ),
                visibleVocab.map((entry) => {
                  const rowId = String(entry.id ?? entry.term ?? '')
                  const open = openWordId === rowId
                  return h(
                    React.Fragment,
                    { key: rowId },
                    h(
                      'div',
                      {
                        className: `dsh-tr-vrow is-clickable${open ? ' is-open' : ''}`,
                        tabIndex: 0,
                        title: open ? t('action.close') : t('settings.vocabOpen'),
                        'aria-expanded': open ? 'true' : 'false',
                        onClick: () => toggleWord(entry),
                        onKeyDown: (event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          toggleWord(entry)
                        },
                      },
                      h('span', { className: 'dsh-tr-vterm', title: entry.term }, highlightText(entry.term, vocabQuery)),
                      h('span', { className: 'dsh-tr-vpos' }, entry.pos || '—'),
                      h('span', { className: 'dsh-tr-vgloss', title: entry.gloss || '' }, highlightText(entry.gloss, vocabQuery)),
                      h('span', { className: 'dsh-tr-vtime' }, formatSavedAt(entry.createdAt, t)),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-tr-vremove',
                          title: t('settings.vocabRemove'),
                          'aria-label': `${t('settings.vocabRemove')} ${entry.term ?? ''}`,
                          onClick: (event) => {
                            event.stopPropagation()
                            if (open) setOpenWordId('')
                            void removeVocab(entry.id)
                          },
                        },
                        '×',
                      ),
                    ),
                    open ? h(WordDetail, { entry }) : null,
                  )
                }),
              ),
          h(
            'div',
            { className: 'dsh-tr-vocab-actions' },
            vocab.length
              ? h(CopyButton, { value: JSON.stringify(visibleVocab, null, 2), label: vocabQuery || vocabRange !== 'all' ? `${t('settings.vocabCopy')} (${visibleVocab.length})` : t('settings.vocabCopy') })
              : null,
            vocab.length
              ? h('button', { type: 'button', className: 'dsh-tr-link', onClick: () => void clearVocab() }, t('settings.vocabClear'))
              : null,
          ),
        ),

        h(
          'div',
          { className: 'dsh-tr-group' },
          h('div', { className: 'dsh-tr-group-title' }, t('settings.groupBehaviour')),
          h(Switch, { checked: settings.enabled !== false, label: t('settings.enabled'), hint: t('settings.enabledHint'), onChange: (value) => void patch({ enabled: value }) }),
          h(Switch, { checked: settings.autoTranslate === true, label: t('settings.auto'), hint: t('settings.autoHint'), onChange: (value) => void patch({ autoTranslate: value }) }),
          h(Switch, { checked: localPrefs.autoSelection !== false, label: t('settings.autoSelection'), hint: t('settings.autoSelectionHint'), onChange: (value) => setPref('autoSelection', value) }),
          h(Switch, { checked: settings.showTerms !== false, label: t('settings.terms'), hint: t('settings.termsHint'), onChange: (value) => void patch({ showTerms: value }) }),
          h(Switch, { checked: settings.showContext !== false, label: t('settings.context'), hint: t('settings.contextHint'), onChange: (value) => void patch({ showContext: value }) }),
        ),

        h(
          'div',
          { className: 'dsh-tr-group' },
          h('div', { className: 'dsh-tr-group-title' }, t('settings.groupDict')),
          h(Switch, {
            checked: settings.showDict !== false,
            label: t('settings.showDict'),
            hint: t('settings.showDictHint'),
            onChange: (value) => void patch({ showDict: value }),
          }),
          h(
            'div',
            { className: 'dsh-tr-row' },
            h(
              'div',
              { className: 'dsh-tr-row-main' },
              h('span', { className: 'dsh-tr-row-label' }, t('settings.accent')),
              h('span', { className: 'dsh-tr-row-hint' }, t('settings.accentHint')),
            ),
            h(
              'div',
              { className: 'dsh-tr-inline' },
              h(
                'select',
                {
                  className: 'dsh-tr-select',
                  value: accent,
                  'aria-label': t('settings.accent'),
                  onChange: (event) => void patch({ accent: event.target.value }),
                },
                h('option', { value: 'us' }, t('settings.accentUs')),
                h('option', { value: 'uk' }, t('settings.accentUk')),
              ),
              h(SpeakButton, { text: 'hello', accent, title: t('settings.accentTry') }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-tr-row' },
            h(
              'div',
              { className: 'dsh-tr-row-main' },
              h('span', { className: 'dsh-tr-row-label' }, dictReady ? interpolate(t('settings.dictReady'), { n: dictCount }) : t('settings.dictMissing')),
              h('span', { className: 'dsh-tr-row-hint' }, t('settings.dictCredit')),
            ),
          ),
        ),

        h(
          'div',
          { className: 'dsh-tr-group' },
          h('div', { className: 'dsh-tr-group-title' }, t('settings.groupModel')),
          h(
            'div',
            { className: 'dsh-tr-row' },
            h('div', { className: 'dsh-tr-row-main' }, h('span', { className: 'dsh-tr-row-label' }, t('settings.groupModel')), h('span', { className: 'dsh-tr-row-hint' }, t('settings.engineHint'))),
            h(
              'select',
              {
                className: 'dsh-tr-select',
                value: engine,
                onChange: (event) => void patch({ engine: event.target.value }),
                'aria-label': t('settings.groupModel'),
              },
              h('option', { value: 'cloud' }, t('settings.engineCloud')),
              h('option', { value: 'local' }, t('settings.engineLocal')),
              h('option', { value: 'auto' }, t('settings.engineAuto')),
            ),
          ),
          engine === 'cloud'
            ? null
            : h(
              'div',
              { className: 'dsh-tr-row' },
              h('div', { className: 'dsh-tr-row-main' }, h('span', { className: 'dsh-tr-row-label' }, t('settings.localBaseUrl')), h('span', { className: 'dsh-tr-row-hint' }, t('settings.localHint'))),
              h(
                'div',
                { className: 'dsh-tr-inline' },
                h('input', {
                  className: 'dsh-tr-input',
                  value: baseUrlDraft,
                  placeholder: 'http://127.0.0.1:11434',
                  onChange: (event) => setBaseUrlDraft(event.target.value),
                  'aria-label': t('settings.localBaseUrl'),
                }),
                h('button', { type: 'button', className: 'dsh-tr-chip', onClick: () => void patch({ localBaseUrl: baseUrlDraft }) }, t('settings.modelSave')),
                h('button', { type: 'button', className: 'dsh-tr-chip is-ghost', disabled: localBusy, onClick: () => void loadLocalModels() }, t('settings.localRefresh')),
              ),
            ),
          engine === 'cloud'
            ? null
            : h(
              'div',
              { className: 'dsh-tr-row' },
              h(
                'div',
                { className: 'dsh-tr-row-main' },
                h('span', { className: 'dsh-tr-row-label' }, t('settings.localModel')),
                h('span', { className: 'dsh-tr-row-hint' }, localNote || (localModels.length ? localModels.map((model) => model.name).join(' · ') : t('settings.localNone'))),
              ),
              h(
                'div',
                { className: 'dsh-tr-inline' },
                h(
                  'select',
                  {
                    className: 'dsh-tr-select',
                    value: settings.localModel ?? '',
                    onChange: (event) => void patch({ localModel: event.target.value }),
                    'aria-label': t('settings.localModel'),
                  },
                  h('option', { value: '' }, '—'),
                  (settings.localModel && !localModels.some((model) => model.name === settings.localModel)
                    ? [{ name: settings.localModel }]
                    : []
                  )
                    .concat(localModels)
                    .map((model) => h('option', { key: model.name, value: model.name }, model.name)),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-tr-chip is-ghost',
                    disabled: localBusy || !settings.localModel,
                    onClick: async () => {
                      setLocalBusy(true)
                      setLocalNote(t('settings.localTesting'))
                      try {
                        const payload = await requestJson('/local/test', { model: settings.localModel })
                        setLocalNote(payload?.ok ? interpolate(t('settings.localTestOk'), { model: payload.model, ms: payload.ms }) : payload?.message || t('error.generic'))
                      } catch {
                        setLocalNote(t('error.network'))
                      } finally {
                        setLocalBusy(false)
                      }
                    },
                  },
                  localBusy ? t('settings.localTesting') : t('settings.localTest'),
                ),
              ),
            ),
          h(
            'div',
            { className: 'dsh-tr-row' },
            h('div', { className: 'dsh-tr-row-main' }, h('span', { className: 'dsh-tr-row-label' }, t('settings.current')), h('span', { className: 'dsh-tr-row-hint' }, modelLabel || t('settings.noModel'))),
            h(
              'select',
              {
                className: 'dsh-tr-select',
                value: settings.targetLanguage ?? 'zh-CN',
                onChange: (event) => void patch({ targetLanguage: event.target.value }),
                'aria-label': t('settings.language'),
              },
              h('option', { value: 'zh-CN' }, '简体中文'),
              h('option', { value: 'zh-TW' }, '繁體中文'),
            ),
          ),
          h(
            'div',
            { className: 'dsh-tr-row' },
            h('div', { className: 'dsh-tr-row-main' }, h('span', { className: 'dsh-tr-row-label' }, t('settings.modelHint'))),
            h(
              'div',
              { className: 'dsh-tr-inline' },
              h('input', {
                className: 'dsh-tr-input',
                placeholder: t('settings.provider'),
                value: provider,
                onChange: (event) => setProvider(event.target.value),
                'aria-label': t('settings.provider'),
              }),
              h('input', {
                className: 'dsh-tr-input',
                placeholder: t('settings.modelId'),
                value: modelId,
                onChange: (event) => setModelId(event.target.value),
                'aria-label': t('settings.modelId'),
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tr-chip',
                  onClick: () => void patch({ model: provider.trim() && modelId.trim() ? { provider: provider.trim(), model: modelId.trim() } : null }),
                },
                t('settings.modelSave'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tr-chip is-ghost',
                  onClick: () => {
                    setProvider('')
                    setModelId('')
                    void patch({ model: null })
                  },
                },
                t('settings.modelClear'),
              ),
            ),
          ),
        ),

        h(
          'div',
          { className: 'dsh-tr-group' },
          h('div', { className: 'dsh-tr-group-title' }, t('settings.groupCache')),
          h(
            'div',
            { className: 'dsh-tr-row' },
            h('div', { className: 'dsh-tr-row-main' }, h('span', { className: 'dsh-tr-row-hint' }, interpolate(t('settings.cacheHint'), { n: cacheSize }))),
            h('button', { type: 'button', className: 'dsh-tr-link', onClick: () => void clearCache() }, t('settings.cacheClear')),
          ),
        ),

        h('p', { className: 'dsh-tr-foot' }, t('settings.privacy')),
        host.persist === false ? h('p', { className: 'dsh-tr-warn' }, t('settings.persistOff')) : null,
        savedAt ? h('p', { className: 'dsh-tr-foot' }, t('settings.saved')) : null,
        vocabError ? h('p', { className: 'dsh-tr-warn' }, vocabError) : null,
      )
    }

    // ------------------------------------------------------------- register

    function registerSlot(slots, slotName, options, component) {
      try {
        slots.inject(slotName, () => {
          try {
            return slots.register(options, component)
          } catch (error) {
            logError(`could not register ${slotName}`, error)
            return () => {}
          }
        })
      } catch (error) {
        logError(`could not inject ${slotName}`, error)
      }
    }

    function apply(ctx) {
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : ctx.locale
      const slots = typeof ctx.get === 'function' ? ctx.get('slots') : ctx.slots
      if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        const disposeLocale = locale.register(NS, { zh, en })
        if (typeof disposeLocale === 'function' && typeof ctx.effect === 'function') ctx.effect(() => disposeLocale)
        t = locale.bind(NS)
      }
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        logError('the slot service is unavailable; no UI was registered', null)
        return
      }
      void loadHostState()

      // The official reasoning body has priority 100; a smaller priority
      // replaces it, and the body keeps access to the untranslated text.
      registerSlot(slots, 'conversation.chat.reasoning.body', { name: 'conversation.chat.reasoning.body', priority: 0 }, ReasoningBody)
      // The selection pill lives in the frame-wide floating layer, so it can
      // sit right next to the text instead of in a bar under the composer.
      registerSlot(slots, 'shell.overlay', { name: 'shell.overlay', id: 'dsh-translate-selection', order: 100 }, LearningOverlay)
      // 中→英 belongs to the composer: the button appears while the draft has
      // Chinese, and the result replaces the draft in place.
      registerSlot(slots, 'conversation.input.right', { name: 'conversation.input.right', id: 'dsh-translate-toenglish', order: 20 }, DraftToEnglishButton)
      // The nav row shows the notebook size, so saved words are visible without
      // opening the page.
      registerSlot(
        slots,
        'settings.section',
        {
          name: 'settings.section',
          id: 'dsh-translate',
          order: 60,
          label: () => {
            const count = Number(hostState.vocabCount) || 0
            const title = t('settings.title')
            return count > 0 ? `${title} · ${count}` : title
          },
        },
        SettingsPage,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
