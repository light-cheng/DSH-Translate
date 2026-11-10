# Changelog

## 0.1.1 — 2026-11-10

First public release.

- English learning for DeepSeek Harness: part-by-part translation of reasoning blocks with
  `x/y` progress, stop and resume; instant selection translation with a context note and
  key-vocabulary chips; right-click actions; Chinese-to-English composer rewrite with undo.
- Bundled offline English–Chinese dictionary (58,468 entries, 32,888 inflected-form lookups)
  that answers before the model does, plus US/UK IPA and pronunciation with a three-step
  fallback (Youdao audio → `speechSynthesis` → the IPA alone).
- Vocabulary notebook in the settings page: search, time filter, sort, in-place word cards,
  delete, copy and clear.
- Model route choice: Harness cloud model, local Ollama, or local-first with cloud fallback;
  translation cache and notebook live in the DSH profile under `dsh-translate/`.
- Chinese and English UI, following the Harness language setting.
- Licensing: plugin code MIT; bundled dictionary data GPL-3.0-only because the British IPA
  data derives from ipacards (GPL-3.0). See `THIRD-PARTY-NOTICES.md`.
