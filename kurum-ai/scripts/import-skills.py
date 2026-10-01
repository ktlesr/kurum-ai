#!/usr/bin/env python3
"""skills/ altındaki becerileri (SKILL.md) Open WebUI'ye "Yetenek" (Skill) olarak yükler.

Kullanıcı hangi modelle sohbet ederse etsin, beceriyi mesajda anarak çağırır; araç çağırma açık
modellerde model beceri listesinden uygun olanı kendisi seçip yükler (view_skill). Tekrar
çalıştırılırsa mevcut becerileri günceller. Yalnızca standart kütüphane; internet gerekmez.

  python3 scripts/import-skills.py --url https://ai.kurum.local --cacert kurum-ai-root.crt
  python3 scripts/import-skills.py --dry-run          # ağsız: ne yükleneceğini listeler

Yönetici e-posta/parolası ADMIN_EMAIL / ADMIN_PASSWORD ortam değişkenlerinden ya da sorularak alınır.
"""
import argparse
import getpass
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "skills"
MAX_CHARS = 60_000  # ~15K token; üstündeyse references/ eklenmez (bağlamın çoğunu beceri yemesin)

HEADER = """Aşağıda "{name}" becerisinin talimatları var (kaynak: {source}).
Kullanıcının isteğini bu talimatlara göre yerine getir.

Bu ortamın kısıtları talimatlardan önce gelir:
- İnternete ve dış veri servislerine (FactSet, S&P Capital IQ, LSEG, Morningstar vb.) erişimin yok. Yalnızca kullanıcının yüklediği dokümanları ve sohbette verilen bilgileri kullan.
- Kod çalıştıramaz, Excel/PowerPoint/Word dosyası oluşturamazsın. Talimat dosya üretmeyi söylüyorsa içeriği Markdown tablo ve metin olarak ver.
- Dokümanda olmayan bilgiyi uydurma; eksik veriyi açıkça "eksik" diye belirt ve kullanıcıdan iste.
- Sayıları dokümandaki gibi aktar; hesap yaptıysan hesabı adım adım göster.
- Cevabı Türkçe ver.

"""

# Uzun İngilizce şablon baştaki kuralları bastırıyor (test: cevap İngilizce ve TL yerine "$" geldi); sona da yaz.
FOOTER = """

---
SON HATIRLATMA: Cevabın tamamını Türkçe yaz; yukarıdaki şablonlardaki başlık ve etiketleri de Türkçeye çevir.
Para birimini ve sayıları dokümanda yazdığı gibi aktar (ör. "250.000.000 TL"); başka para birimi işareti ekleme.
Dokümanda olmayan bilgiyi uydurma."""


def parse(skill_md: Path):
    text = skill_md.read_text(encoding="utf-8")
    meta, body = {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line and not line.startswith(" "):
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
    return meta, body


def build(skill_md: Path):
    d = skill_md.parent
    collection, plugin = d.relative_to(ROOT).parts[:2]
    meta, body = parse(skill_md)
    name = meta.get("name") or d.name
    source = (ROOT / collection / "SOURCE.txt").read_text(encoding="utf-8").splitlines()[0].removeprefix("Kaynak: ")
    system = HEADER.format(name=name, source=source) + body.strip()
    refs = sorted(p for p in d.rglob("*.md") if p != skill_md)
    ref_text = "".join(f"\n\n---\n## Ek: {p.relative_to(d).as_posix()}\n\n{p.read_text(encoding='utf-8').strip()}" for p in refs)
    if refs and len(system) + len(ref_text) <= MAX_CHARS:
        system += ref_text
        omitted = []
    else:
        omitted = [p.relative_to(d).as_posix() for p in refs]
    system += FOOTER
    return {
        "id": (''.join(w[0] for w in collection.split('-')) + '-' + name)[:64],
        "name": name.replace("-", " ").title(),
        "description": meta.get("description", ""),
        "tags": [collection, plugin],
        "system": system,
        "omitted": omitted,
    }


def skills():
    return [build(p) for p in sorted(ROOT.glob("*/*/*/SKILL.md"))]


class Api:
    def __init__(self, url, cacert):
        self.url = url.rstrip("/")
        self.token = None
        self.ctx = ssl.create_default_context(cafile=cacert)

    def call(self, method, path, body=None):
        req = urllib.request.Request(self.url + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json",
                                              **({"Authorization": f"Bearer {self.token}"} if self.token else {})})
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{method} {path}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="https://ai.kurum.local")
    ap.add_argument("--cacert", help="Caddy iç CA kök sertifikası (README: Aşama 2, bölüm 5); kurum sertifikasında gerekmez")
    ap.add_argument("--private", action="store_true", help="Becerileri yalnızca yöneticiye açık bırak (varsayılan: tüm kullanıcılar)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    items = skills()
    if a.dry_run:
        for s in items:
            note = f"  (eklenmeyen ek: {len(s['omitted'])})" if s["omitted"] else ""
            print(f"{s['id']:45} {len(s['system']):>7} karakter{note}")
        print(f"\n{len(items)} beceri")
        return

    api = Api(a.url, a.cacert)
    email = os.environ.get("ADMIN_EMAIL") or input("Yönetici e-posta: ")
    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Parola: ")
    api.token = api.call("POST", "/api/v1/auths/signin", {"email": email, "password": password})["token"]

    existing = {sk["id"] for sk in api.call("GET", "/api/v1/skills/") or []}

    grants = [] if a.private else [{"principal_type": "user", "principal_id": "*", "permission": "read"}]
    for s in items:
        form = {
            "id": s["id"],
            "name": s["name"],
            "description": s["description"],
            "content": s["system"],
            "meta": {"tags": s["tags"]},
            "access_grants": grants,
            "is_active": True,
        }
        update = s["id"] in existing
        api.call("POST", f"/api/v1/skills/id/{s['id']}/update" if update else "/api/v1/skills/create", form)
        print(("güncellendi " if update else "eklendi     ") + s["id"])
    print(f"\n{len(items)} beceri yüklendi.")


if __name__ == "__main__":
    main()
