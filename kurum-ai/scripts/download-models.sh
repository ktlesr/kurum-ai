#!/usr/bin/env bash
# Üretimde gereken her şeyi önceden indirir: container imajları, LLM, embedding modeli, tokenizer dosyaları.
# Cihazın internet çıkışı KISA SÜRELİĞİNE açıkken çalıştırın; bitince çıkışı tekrar kapatın.
# Kapılı (gated) bir model için: HF_TOKEN=hf_xxx scripts/download-models.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "HATA: .env yok. Önce: cp .env.example .env" >&2; exit 1; }
# .env'i source etmiyoruz (LDAP_APP_DN gibi boşluklu değerler bash'i bozar); gerekeni tek tek okuyoruz.
envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }
LLM_MODEL=$(envval LLM_MODEL); LLM_MODEL=${LLM_MODEL:-openai/gpt-oss-20b}
EMB_MODEL=$(envval HF_EMBEDDING_MODEL); EMB_MODEL=${EMB_MODEL:-BAAI/bge-m3}
WEBUI_VERSION=$(envval WEBUI_VERSION); WEBUI_IMAGE=ghcr.io/open-webui/open-webui:${WEBUI_VERSION:-v0.11.4}

echo "== 1/4 Container imajları indiriliyor"
docker compose -f compose.prod.yml pull

mkdir -p models/llm models/embedding models/tiktoken certs

# İndirme için Open WebUI imajındaki Python + huggingface_hub kullanılır; cihaza ek paket kurulmaz.
py() { docker run --rm ${HF_TOKEN:+-e HF_TOKEN="$HF_TOKEN"} -v "$PWD/models:/models" --entrypoint python "$WEBUI_IMAGE" -c "$@"; }
hf_download() { # <repo> <hedef klasör>
  # original/ ve metal/ (gpt-oss) ile onnx/openvino/tf kopyaları kullanılmıyor; atlanır (~26 GB tasarruf).
  # Ağırlıkların .safetensors hali varsa aynı ağırlıkların .bin kopyası da atlanır.
  py 'import sys
from huggingface_hub import list_repo_files, snapshot_download
ignore = ["original/*", "metal/*", "onnx/*", "openvino/*", "*.onnx", "*.h5", "*.msgpack", "*.ot"]
if any(f.endswith(".safetensors") for f in list_repo_files(sys.argv[1])):
    ignore.append("*.bin")
snapshot_download(sys.argv[1], local_dir=sys.argv[2], ignore_patterns=ignore)' "$1" "$2"
}

echo "== 2/4 LLM: $LLM_MODEL"
hf_download "$LLM_MODEL" "/models/llm/$LLM_MODEL"

echo "== 3/4 Embedding modeli: $EMB_MODEL"
hf_download "$EMB_MODEL" "/models/embedding/$EMB_MODEL"

echo "== 4/4 Tokenizer dosyaları (gpt-oss çevrimdışı çalışması için)"
py 'import urllib.request
for n in ("o200k_base", "cl100k_base"):
    urllib.request.urlretrieve(f"https://openaipublic.blob.core.windows.net/encodings/{n}.tiktoken", f"/models/tiktoken/{n}.tiktoken")'

echo
du -sh models/llm models/embedding models/tiktoken
echo
echo "Tamamlandı. Şimdi cihazın internet çıkışını tekrar kapatın, sonra:"
echo "  docker compose -f compose.prod.yml up -d"
