# syntax=docker/dockerfile:1
# Multi-arch (amd64 dev, arm64 GB10). Targets: "app" (PDF via unpdf) and "app-docling" (+ Docling in the image).
# Build: docker build --target app -t kurum-ai-web .

FROM node:22-bookworm-slim AS deps
WORKDIR /src
RUN npm install -g pnpm@10.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The trace gate fails the build if runtime data, venvs or env files reached the output (audit S12).
RUN pnpm build && node scripts/check-trace.mjs

# Runtime base shared by both targets (user, data volume, healthcheck, command).
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -r app && useradd -r -g app -d /app app && mkdir .cache && chown app:app .cache
EXPOSE 3000
# /app/.cache holds user documents: mount a volume there.
VOLUME ["/app/.cache"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]

# Docling sits below the app files, so a code change reuses this cached layer instead of reinstalling it.
FROM runtime AS docling
# ponytail: Docling from PyPI as-is (CPU torch on amd64 pulls CUDA wheels too; trim with the CPU index if size matters).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/docling && /opt/docling/bin/pip install --no-cache-dir docling==2.130.0
# OCR's torch models go into the package's own folder, which the app user can't write: fetched here, or OCR silently
# reads nothing at runtime. A failed fetch mustn't fail the deploy: lib/extract.ts then reads scans with the vision model.
RUN /opt/docling/bin/python -c "from docling.datamodel.accelerator_options import AcceleratorOptions; from docling.datamodel.pipeline_options import RapidOcrOptions; from docling.models.stages.ocr.rapid_ocr_model import RapidOcrModel; RapidOcrModel(True, None, RapidOcrOptions(backend='torch'), AcceleratorOptions(device='cpu'))" \
  || echo "OCR models not fetched"
# Models live in the data volume: fetch once with DOCLING_OFFLINE=false, then keep it offline.
ENV DOCLING_PYTHON=/opt/docling/bin/python HF_HOME=/app/.cache/hf

# The app files, laid out once for both targets.
FROM scratch AS files
COPY --from=build /src/.next/standalone /app/
COPY --from=build /src/.next/static /app/.next/static
COPY --from=build /src/public /app/public
# Docling worker script, and the admin bootstrap (docker exec … node scripts/create-admin.ts <user>).
COPY scripts/extract.py scripts/create-admin.ts /app/scripts/
COPY lib/db.ts lib/password.ts /app/lib/
# Turbopack bundles postgres into the server chunks; the plain-node admin script needs the package itself (no deps).
COPY --from=deps /src/node_modules/postgres /app/node_modules/postgres

FROM runtime AS app
COPY --from=files /app ./
USER app

# The "browser" service (deploy/compose.yml): Chromium for pages whose figures only appear after their scripts run.
# Its own image and container: no app code, documents or keys in it. playwright-core matches the app's exactly
# (client and server must be the same version).
FROM node:22-bookworm-slim AS browser
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json /tmp/package.json
RUN npm install --no-save --no-package-lock "playwright-core@$(node -p "require('/tmp/package.json').dependencies['playwright-core']")" \
  && rm /tmp/package.json && groupadd -r browser && useradd -r -g browser -d /tmp browser
COPY scripts/browser-server.mjs ./
ENV HOME=/tmp NODE_ENV=production
USER browser
EXPOSE 3100
CMD ["node", "browser-server.mjs"]

FROM docling AS app-docling
COPY --from=files /app ./
USER app
