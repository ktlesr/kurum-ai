"""Docling extraction for PDF/DOCX. Prints one JSON object per line (stdout):
  {"page": n, "total": N, "markdown": "...", "tables": [{"markdown": "...", "strips": [png_b64, ...]}]}
`tables` holds high-res crops (split into horizontal strips) of tables that sit on pages
containing bitmap images — i.e. likely screenshots that a second reader should verify.
DOCX: a single line with "page": null.
Usage: python scripts/extract.py <file>
"""
import base64
import io
import json
import logging
import os
import sys
import warnings

warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)
sys.stdout.reconfigure(encoding="utf-8")

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import TableItem

SCALE = 3  # render scale for crops (~216 dpi)
MAX_PAGES = int(os.environ.get("DOCLING_MAX_PAGES", "500"))  # lib/extract.ts maps exit 3 to a user message
MAX_RENDER_PX = 60_000_000  # exit 4: a forged 10 m x 10 m page would otherwise render into many GB of RAM
STRIP = 450  # max strip height in px; the vision model downsizes larger images and misreads digits
OVERLAP = 40

path = sys.argv[1]
opts = PdfPipelineOptions(do_ocr=True, do_table_structure=True)
# Tables are often pasted screenshots: build cells from OCR, not the (missing) text layer.
opts.table_structure_options.do_cell_matching = False
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def png(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


if not path.lower().endswith(".pdf"):
    md = conv.convert(path).document.export_to_markdown(image_placeholder="")
    emit({"page": None, "total": 1, "markdown": md, "tables": []})
    sys.exit()

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

pdf = pdfium.PdfDocument(path)
total = len(pdf)
if total > MAX_PAGES:
    sys.exit(3)
# Before Docling touches any page (it renders them too): a forged giant page would blow up memory.
if any(w * h * SCALE * SCALE > MAX_RENDER_PX for w, h in (pdf.get_page_size(i) for i in range(total))):
    sys.exit(4)
for n in range(1, total + 1):
    # ponytail: one convert() per page for progress; models stay loaded in `conv`
    doc = conv.convert(path, page_range=(n, n)).document
    page = pdf[n - 1]
    has_images = any(True for _ in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE]))
    crops = []
    if has_images:
        image = page.render(scale=SCALE).to_pil()
        height = page.get_height()
        for item, _ in doc.iterate_items():
            if not isinstance(item, TableItem) or not item.prov:
                continue
            b = item.prov[0].bbox.to_top_left_origin(height)
            box = [int(b.l * SCALE) - 10, int(b.t * SCALE) - 10, int(b.r * SCALE) + 10, int(b.b * SCALE) + 10]
            table = image.crop(box)
            strips, y = [], 0
            while y < table.height:
                strips.append(png(table.crop((0, y, table.width, min(table.height, y + STRIP)))))
                y += STRIP - OVERLAP
            crops.append({"markdown": item.export_to_markdown(doc), "strips": strips})
    emit({"page": n, "total": total, "markdown": doc.export_to_markdown(image_placeholder=""), "tables": crops})
    page.close()
pdf.close()
