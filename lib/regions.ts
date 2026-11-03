// Official classifications a question may use as shorthand, given to the model as fact: a local model's memory of them is
// unreliable (it read "TR33" as Zonguldak, Karabük, Bartın, which is TR81). İBBS (NUTS) levels 1 and 2, and the development
// agency of each level-2 region. No "server-only": the test drives it.

const LEVEL2: [code: string, agency: string, provinces: string[]][] = [
  ["TR10", "İstanbul Kalkınma Ajansı", ["İstanbul"]],
  ["TR21", "Trakya Kalkınma Ajansı", ["Tekirdağ", "Edirne", "Kırklareli"]],
  ["TR22", "Güney Marmara Kalkınma Ajansı", ["Balıkesir", "Çanakkale"]],
  ["TR31", "İzmir Kalkınma Ajansı", ["İzmir"]],
  ["TR32", "Güney Ege Kalkınma Ajansı", ["Aydın", "Denizli", "Muğla"]],
  ["TR33", "Zafer Kalkınma Ajansı", ["Manisa", "Afyonkarahisar", "Kütahya", "Uşak"]],
  ["TR41", "Bursa Eskişehir Bilecik Kalkınma Ajansı", ["Bursa", "Eskişehir", "Bilecik"]],
  ["TR42", "Doğu Marmara Kalkınma Ajansı", ["Kocaeli", "Sakarya", "Düzce", "Bolu", "Yalova"]],
  ["TR51", "Ankara Kalkınma Ajansı", ["Ankara"]],
  ["TR52", "Mevlana Kalkınma Ajansı", ["Konya", "Karaman"]],
  ["TR61", "Batı Akdeniz Kalkınma Ajansı", ["Antalya", "Isparta", "Burdur"]],
  ["TR62", "Çukurova Kalkınma Ajansı", ["Adana", "Mersin"]],
  ["TR63", "Doğu Akdeniz Kalkınma Ajansı", ["Hatay", "Kahramanmaraş", "Osmaniye"]],
  ["TR71", "Ahiler Kalkınma Ajansı", ["Kırıkkale", "Aksaray", "Niğde", "Nevşehir", "Kırşehir"]],
  ["TR72", "Orta Anadolu Kalkınma Ajansı", ["Kayseri", "Sivas", "Yozgat"]],
  ["TR81", "Batı Karadeniz Kalkınma Ajansı", ["Zonguldak", "Karabük", "Bartın"]],
  ["TR82", "Kuzey Anadolu Kalkınma Ajansı", ["Kastamonu", "Çankırı", "Sinop"]],
  ["TR83", "Orta Karadeniz Kalkınma Ajansı", ["Samsun", "Tokat", "Çorum", "Amasya"]],
  ["TR90", "Doğu Karadeniz Kalkınma Ajansı", ["Trabzon", "Ordu", "Giresun", "Rize", "Artvin", "Gümüşhane"]],
  ["TRA1", "Kuzeydoğu Anadolu Kalkınma Ajansı", ["Erzurum", "Erzincan", "Bayburt"]],
  ["TRA2", "Serhat Kalkınma Ajansı", ["Ağrı", "Kars", "Iğdır", "Ardahan"]],
  ["TRB1", "Fırat Kalkınma Ajansı", ["Malatya", "Elazığ", "Bingöl", "Tunceli"]],
  ["TRB2", "Doğu Anadolu Kalkınma Ajansı", ["Van", "Muş", "Bitlis", "Hakkari"]],
  ["TRC1", "İpekyolu Kalkınma Ajansı", ["Gaziantep", "Adıyaman", "Kilis"]],
  ["TRC2", "Karacadağ Kalkınma Ajansı", ["Şanlıurfa", "Diyarbakır"]],
  ["TRC3", "Dicle Kalkınma Ajansı", ["Mardin", "Batman", "Şırnak", "Siirt"]],
];
const LEVEL1: Record<string, string> = {
  TR1: "İstanbul", TR2: "Batı Marmara", TR3: "Ege", TR4: "Doğu Marmara", TR5: "Batı Anadolu", TR6: "Akdeniz",
  TR7: "Orta Anadolu", TR8: "Batı Karadeniz", TR9: "Doğu Karadeniz", TRA: "Kuzeydoğu Anadolu", TRB: "Ortadoğu Anadolu", TRC: "Güneydoğu Anadolu",
};

const low = (s: string) => s.toLocaleLowerCase("tr");
const PROVINCES = new Set(LEVEL2.flatMap(([, , p]) => p.map(low)));
/** One of the 81 provinces ("Afyon" too). */
export const isProvince = (name: string) => PROVINCES.has(low(name)) || low(name) === "afyon";

export interface Known { facts: string[]; names: string[] }

/** The official regions and agencies the question names, as facts and the provinces they cover. */
export function knownTerms(question: string): Known {
  const facts: string[] = [];
  const names: string[] = [];
  const q = low(question);
  const add = (fact: string, provinces: string[]) => {
    if (facts.includes(fact)) return;
    facts.push(fact);
    names.push(...provinces.filter((p) => !names.includes(p)));
  };
  // Level 2 in any case ("tr33"); level 1 only as written in capitals (TRA could be a word's start).
  for (const m of question.matchAll(/(?<![\p{L}\p{N}])tr([1-9]\d|[a-c][1-3])(?![\p{L}\p{N}])/giu)) {
    const r = LEVEL2.find(([c]) => c === `TR${m[1].toUpperCase()}`);
    if (r) add(`${r[0]} (İBBS Düzey 2 bölgesi, ${r[1]}) = ${r[2].join(", ")}`, r[2]);
  }
  for (const m of question.matchAll(/(?<![\p{L}\p{N}])TR([1-9A-C])(?![\p{L}\p{N}])/gu)) {
    const code = `TR${m[1]}`;
    const parts = LEVEL2.filter(([c]) => c.startsWith(code));
    add(`${code} (İBBS Düzey 1, ${LEVEL1[code]}) = ${parts.map(([c, , p]) => `${c}: ${p.join(", ")}`).join("; ")}`, parts.flatMap(([, , p]) => p));
  }
  for (const [code, agency, provinces] of LEVEL2) {
    const short = low(agency.replace(/ Kalkınma Ajansı$/, ""));
    if (new RegExp(`(?<!\\p{L})${short}\\s+(?:kalkınma\\s+)?ajans`, "u").test(q)) add(`${agency} = ${code} bölgesi: ${provinces.join(", ")}`, provinces);
  }
  return { facts, names };
}
