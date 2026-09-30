#!/usr/bin/env bash
# Open WebUI veri klasörünü (kullanıcılar, sohbetler, dosyalar, ayarlar, vektör veritabanı) tarihli arşivler.
# Son 14 yedek tutulur. Tutarlı kopya için Open WebUI yedek süresince (genelde < 1 dk) durdurulur.
# Zamanlama (her gece 02:00): 0 2 * * * /opt/kurum-ai/scripts/backup.sh >> /var/log/kurum-ai-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
# Windows Git Bash'te de çalışsın (geliştirme ortamı)
export MSYS_NO_PATHCONV=1
HOST_DIR=$(pwd -W 2>/dev/null || pwd)

KEEP=14
# COMPOSE_FILE ayarlıysa onu kullan (geliştirme: compose.prod.yml;compose.dev.yml), değilse üretim
COMPOSE=(docker compose)
[ -n "${COMPOSE_FILE:-}" ] || COMPOSE+=(-f compose.prod.yml)
file=open-webui-$(date +%Y%m%d-%H%M%S).tar.gz
mkdir -p backups

"${COMPOSE[@]}" stop open-webui
trap '"${COMPOSE[@]}" start open-webui' EXIT

# Servisin kendi volume'unu bağlayan geçici container (ek imaj gerekmez)
"${COMPOSE[@]}" run --rm --no-deps -v "$HOST_DIR/backups:/backup" --entrypoint tar open-webui \
  czf "/backup/$file" -C /app/backend/data .

ls -1t backups/open-webui-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "$(date '+%F %T') yedek: backups/$file ($(du -h "backups/$file" | cut -f1)), toplam $(ls backups/open-webui-*.tar.gz | wc -l) yedek"
