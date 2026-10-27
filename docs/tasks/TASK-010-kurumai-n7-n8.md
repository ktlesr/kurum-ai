# TASK-010: kurum-ai pilot — ağ çıkışı (N7) ve model varsayılanı (N8)

- **N7:** Open WebUI artık yalnızca `internal` `backend` ağında; Caddy iki ağda (girişin tek noktası). Open WebUI'nin ağ düzeyinde dışarı çıkışı yok. LDAP açılacaksa `compose.ldap.yml` override'ı Open WebUI'yi `frontend`'e de bağlar; o durumda host güvenlik duvarında (DOCKER-USER) yalnızca LDAP sunucusuna izin verilmesi belgelendi.
- **N8:** `download-models.sh` varsayılanı `compose.prod.yml` ile aynı (`google/gemma-4-26B-A4B-it`).
- Doğrulama: `docker compose config` iki biçimde — varsayılan: open-webui `[backend]`, caddy `[backend, frontend]`, backend internal; LDAP override ile open-webui `[backend, frontend]`. Caddy `open-webui:8080`'e backend üzerinden ulaşır.
- Canlı yığına uygulanmadı (kullanıcı onayı gerekir).

**Codex bulguları ve karar**
