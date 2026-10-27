# TASK-008: Model sağlayıcı soyutlaması (PR-3a)

**Amaç:** Audit K3 — geliştirmede Ollama, GB10'da vLLM (OpenAI uyumlu API) aynı koddan.

**Kapsam**
- `lib/provider.ts`: `chat` (her zaman akış; metin parçaları, düşünme sayacı, `truncated`, istem token sayısı), `embed`, `models`, `healthy`. İki uygulama: `ollama` (`/api/chat`, `/api/embed`, `/api/tags`, `/api/version`) ve `openai` (`/v1/chat/completions` SSE, `/v1/embeddings`, `/v1/models`).
- Yapılandırma: `MODEL_PROVIDER` (`ollama` | `vllm`/`openai`), `MODEL_URL` (eski `OLLAMA_URL` de okunur), `EMBED_URL`, `VISION_URL` (vLLM süreç başına tek model sunar), `MODEL_API_KEY`.
- Düşünme: Ollama `think` (gpt-oss'ta `low`/`high`); vLLM `chat_template_kwargs.enable_thinking` (+ gpt-oss için `reasoning_effort`). Görsel: Ollama `images`, vLLM `image_url` data URL.
- Çağıranlar (sohbet, sınıflandırma/tarama, embedding, görsel ikinci okuma, model listesi) yalnızca sağlayıcıyı kullanıyor; tüm çağrılar hâlâ `admission.model` semaforundan geçiyor. Hata kodları `model_http_*`, `model_stream_error`.
- Arayüz metinleri "Ollama" yerine "model sunucusu".
- Görsel okumaya üst sınır (`VISION_MAX_TOKENS` 4096) — önceden sınırsızdı.

**Kapsam dışı:** vLLM'in GB10 üzerinde gerçek denemesi (PR-3b/deploy aşaması). `NUM_CTX` vLLM'de sunucunun `--max-model-len` değeriyle eşlenmeli (README).

**Kabul**

| Kriter | Sonuç |
|---|---|
| Ollama: parçalı NDJSON birleşir, düşünme sayılır, `length` → truncated, `prompt_eval_count`, `num_ctx`/`num_predict`, görseller | ✅ sahte sunucuyla birim |
| Ollama: bulut ve sohbet dışı modeller listelenmez; embed; sağlık | ✅ birim |
| vLLM: SSE (yorum satırı, `[DONE]`), `reasoning_content`, `finish_reason`, `usage`, data URL görsel, `Authorization` | ✅ birim |
| vLLM: embedding sırası `index`'e göre, model listesi, HTTP ve akış hataları | ✅ birim |
| `pnpm test` 49/49, `tsc`, `lint` | ✅ |

**Rollback:** branch'i geri al; ortam değişkenleri geriye uyumlu (`OLLAMA_URL`).

**Codex bulguları ve karar**
- Codex tur 1 — CHANGES REQUIRED (P2 ×2): kesilmiş görsel okuma başarılı sayılıyordu → `truncated` ise hata (önbelleğe yazılmaz, doğrulama "atlandı" olur); boş `MODEL_URL`/`EMBED_URL`/`VISION_URL` göreli adres üretiyordu → `||` ile varsayılana düşer. Eksik testler eklendi: `Authorization` başlığı, Ollama gpt-oss `low`/`high`, iptal. 51/51.
- Not: vLLM'de düşünme parçalarının ayrışması için sunucu `--reasoning-parser` ile başlatılmalı (deploy notu).
