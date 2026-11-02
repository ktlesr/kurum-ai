// The XML inside Office files. A real parser: these files can't be trusted to look the way a regex expects.
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import { TemplateError } from "./template.ts";

export type El = Element;

export function parseXml(text: string): Document {
  // An Office part has no reason to declare anything; a declaration is how entity tricks start.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new TemplateError("Şablon dosyasının iç yapısı desteklenmiyor.");
  let bad = false;
  const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => { bad = true; }, fatalError: () => { bad = true; } } }).parseFromString(text, "application/xml");
  if (bad || !doc?.documentElement) throw new TemplateError("Şablon dosyası bozuk görünüyor.");
  return doc;
}

export const writeXml = (doc: Document) => new XMLSerializer().serializeToString(doc);

/** Child elements by local name (prefixes differ between tools). */
export const kids = (el: Node, name?: string): El[] => {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as El).localName === name)) out.push(n as El);
  }
  return out;
};
export const kid = (el: Node, name: string): El | undefined => kids(el, name)[0];

/** Every descendant by local name, in document order. */
export function all(el: Node, name: string, into: El[] = []): El[] {
  for (const k of kids(el)) {
    if (k.localName === name) into.push(k);
    all(k, name, into);
  }
  return into;
}

export const textOf = (el: Node): string => el.textContent ?? "";

export async function openZip(bytes: Uint8Array, notOffice: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new TemplateError(notOffice);
  }
}

export async function saveZip(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
