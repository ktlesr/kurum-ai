import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getUser } from "@/lib/auth";
import { Logo } from "../logo";
import { ThemeToggle } from "../theme-toggle";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Kullanım Rehberi · Zafer AI" };

/** A label as it appears on the screen. lib/guide-labels.test.ts checks each one still exists in the code. */
const L = ({ children }: { children: string }) => <strong className="font-semibold">{children}</strong>;
const K = ({ children }: { children: string }) => <kbd className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-xs">{children}</kbd>;
const Note = ({ children }: { children: ReactNode }) => <p className="guide-note rounded-lg bg-accent-soft px-3 py-2 text-sm">{children}</p>;
const Warn = ({ children }: { children: ReactNode }) => <p className="guide-note rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">{children}</p>;

const CONTENTS: [string, string, [string, string][]][] = [
  ["baslarken", "Başlarken", [["giris", "Giriş ve parola"], ["uygulama", "Telefona ve bilgisayara ekleme"], ["veri", "Verileriniz nerede duruyor"]]],
  ["asistan", "Asistan (sohbet)", [["soru", "Soru sorma"], ["belge", "Belge ekleme"], ["kitaplik", "Ortak belgeler ve Belgelerim"], ["hazir", "Hazır işler ve profiller"], ["kaynak", "Cevapları doğrulama"], ["internet", "İnternet ve bağlantılar"], ["dosya", "Cevabı dosya olarak alma"], ["sablon", "Şablon doldurma"], ["galeri", "Galeriden fotoğraf getirme"], ["gecmis", "Sohbetleri yönetme ve yedek"], ["sinir", "Sınırlar ve uyarılar"]]],
  ["studyo", "Görsel Stüdyo", [["baslangic", "Başlangıç"], ["sosyal", "Sosyal medya görseli"], ["yapay", "Yapay zekâ ile içerik"], ["sunum", "Sunum"], ["video", "Video / Reels"], ["duzenleme", "Tuvalde düzenleme"], ["marka", "Marka ve logolar"], ["kayit", "Kaydetme ve taşıma"], ["indir", "Dışa aktarma"], ["kisayol", "Klavye kısayolları"]]],
  ["sorun", "Sık karşılaşılan durumlar", []],
];

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section id={id} className="guide-part scroll-mt-4 border-t border-line pt-8 first:border-t-0 first:pt-0">
    <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
    <div className="mt-5 space-y-8">{children}</div>
  </section>
);
const Topic = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <div id={id} className="scroll-mt-4">
    <h3 className="text-base font-semibold">{title}</h3>
    <div className="guide-body mt-2 space-y-3 text-[15px] leading-relaxed">{children}</div>
  </div>
);

const Contents = () => (
  <ol className="space-y-3 text-sm">
    {CONTENTS.map(([id, title, topics]) => (
      <li key={id}>
        <a href={`#${id}`} className="font-medium hover:text-accent">{title}</a>
        {topics.length > 0 && (
          <ul className="mt-1 space-y-1 border-l border-line pl-3">
            {topics.map(([t, name]) => <li key={t}><a href={`#${t}`} className="text-muted hover:text-accent">{name}</a></li>)}
          </ul>
        )}
      </li>
    ))}
  </ol>
);

export default async function GuidePage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.mustChange) redirect("/hesap");
  return (
    <div className="guide min-h-full bg-bg">
      <header className="guide-chrome flex h-14 items-center gap-3 border-b border-line bg-panel px-4">
        <Logo size={28} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Kullanım Rehberi</span>
        <PrintButton />
        <ThemeToggle />
        <Link href="/" className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">Asistan</Link>
        <Link href="/studio" className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg sm:block">Görsel Stüdyo</Link>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="İçindekiler" className="guide-chrome lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto">
          <details className="rounded-lg border border-line bg-panel p-3 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">İçindekiler</summary>
            <div className="mt-3"><Contents /></div>
          </details>
          <div className="hidden lg:block"><Contents /></div>
        </nav>
        <main className="min-w-0 max-w-3xl space-y-10">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Zafer AI Kullanım Rehberi</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">Zafer AI iki bölümden oluşur. <strong className="font-semibold text-fg">Asistan</strong> sorularınızı cevaplar, belgelerinizi okur ve özetler. <strong className="font-semibold text-fg">Görsel Stüdyo</strong> sosyal medya görseli, sunum ve video hazırlar. Yapay zekâ işlemleri kurum sunucusunda yapılır.</p>
          </div>

          <Section id="baslarken" title="Başlarken">
            <Topic id="giris" title="Giriş ve parola">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Size e-postayla gelen kullanıcı adı ve parolayla giriş yapın.</li>
                <li>E-postayla yeni gönderilen bir parolada ilk girişte <L>Devam etmek için parolanızı değiştirin</L> ekranı açılır. Değiştirene kadar diğer sayfalar açılmaz.</li>
                <li><L>Mevcut parola</L> alanına e-postadaki parolayı, <L>Yeni parola</L> alanlarına en az 10 karakterlik yeni parolanızı yazın.</li>
              </ol>
              <p>Parolanızı istediğiniz zaman Asistan&apos;ın yan menüsünün en altındaki anahtar simgesinden (<L>Parolayı değiştir</L>) değiştirebilirsiniz. Değiştirince diğer cihazlardaki oturumlarınız kapanır.</p>
              <p>Parolanızı unuttuysanız yöneticinize başvurun; yönetici e-postanıza yeni bir parola gönderebilir.</p>
              <p>Görünümü sağ üstteki tema düğmesinden değiştirebilirsiniz: <L>Gündüz teması</L>, <L>Gece teması</L>, <L>Sistem teması</L>.</p>
            </Topic>
            <Topic id="uygulama" title="Telefona ve bilgisayara ekleme">
              <p>Zafer AI&apos;ı ana ekranınıza ekleyebilirsiniz. Kendi simgesiyle, tarayıcı çubukları olmadan uygulama gibi açılır. Çalışması için internet ve kurum sunucusuna erişim gerekir.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="font-semibold">Android:</strong> Yan menüde <L>Uygulama olarak ekle</L> düğmesine dokunun. Düğme size yol gösterir; tarayıcı menüsündeki ana ekrana ekleme seçeneğini de kullanabilirsiniz.</li>
                <li><strong className="font-semibold">iPhone ve iPad:</strong> Safari&apos;de Paylaş düğmesine dokunup <L>Ana Ekrana Ekle</L>&apos;yi seçin.</li>
                <li><strong className="font-semibold">Bilgisayar (Chrome, Edge):</strong> Tarayıcı izin veriyorsa yan menüde <L>Uygulama olarak ekle</L> görünür; adres çubuğundaki yükleme simgesini de kullanabilirsiniz.</li>
              </ul>
            </Topic>
            <Topic id="veri" title="Verileriniz nerede duruyor">
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-subtle text-left"><tr><th className="px-3 py-2 font-medium">Ne</th><th className="px-3 py-2 font-medium">Nerede</th><th className="px-3 py-2 font-medium">Bilmeniz gereken</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-line"><td className="px-3 py-2">Sohbetler</td><td className="px-3 py-2">Yalnızca kullandığınız tarayıcı</td><td className="px-3 py-2">Başka cihazda görünmez, düzenli yedek alın</td></tr>
                    <tr className="border-t border-line"><td className="px-3 py-2">Stüdyo çalışmaları, marka ve logolar</td><td className="px-3 py-2">Yalnızca kullandığınız tarayıcı</td><td className="px-3 py-2">Taşımak için proje dosyası olarak kaydedin</td></tr>
                    <tr className="border-t border-line"><td className="px-3 py-2">Belgelerim</td><td className="px-3 py-2">Kurum sunucusu</td><td className="px-3 py-2">Giriş yaptığınız her cihazda görünür</td></tr>
                    <tr className="border-t border-line"><td className="px-3 py-2">Ortak belgeler</td><td className="px-3 py-2">Kurum sunucusu</td><td className="px-3 py-2">Herkes için aynıdır, salt okunur</td></tr>
                  </tbody>
                </table>
              </div>
              <Warn>Tarayıcı verilerini temizlemek ya da gizli pencere kullanmak sohbetlerinizi ve stüdyo çalışmalarınızı kaybettirebilir. Önemli olanları yedekleyin.</Warn>
            </Topic>
          </Section>

          <Section id="asistan" title="Asistan (sohbet)">
            <Topic id="soru" title="Soru sorma">
              <p>Sorunuzu alttaki kutuya yazın. <K>Enter</K> gönderir, <K>Shift+Enter</K> yeni satır açar. Cevap yazılırken <K>Esc</K> ya da kare düğme (<L>Durdur (Esc)</L>) durdurur.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><L>Düzenle</L>: Sorunuzu değiştirip yeniden sorar. O sorudan sonraki mesajlar yeni cevapla değişir.</li>
                <li><L>Kopyala</L>: Sorunun ya da cevabın altında tüm metni kopyalar.</li>
                <li>Kod bloklarının üst çubuğunda ayrıca kendi <L>Kopyala</L> düğmeleri vardır; yalnızca o bloğu kopyalar.</li>
              </ul>
              <p>Üst çubuktaki model seçimi sayfa yenilenince varsayılana döner; hangi modellerin listeleneceğini yönetici belirler. Sohbet son 8 mesajı hatırlayarak devam eder, çok eski mesajlara dayanan sorularda konuyu yeniden belirtin.</p>
            </Topic>
            <Topic id="belge" title="Belge ekleme">
              <p>Belgeyi şu yollarla ekleyebilirsiniz:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Soru kutusundaki ataş simgesi (<L>Belge ekle</L>).</li>
                <li>Dosyayı sayfanın herhangi bir yerine sürükleyip bırakmak.</li>
                <li>Ekran görüntüsünü soru kutusuna yapıştırmak; görüntü metne okunur.</li>
                <li>Yan menüde <L>Belgelerim</L> yanındaki yükleme simgesi (<L>Belge yükle</L>).</li>
              </ul>
              <p><strong className="font-semibold">Desteklenen biçimler:</strong> PDF, DOCX, PPTX, XLSX, XLS, CSV, TXT, MD, HTML, PNG, JPG, WEBP. Eski .doc ve .ppt dosyaları da okunur (sunucuda .docx/.pptx biçimine çevrilerek); çevrilemeyen bir dosyayı Word&apos;de ya da PowerPoint&apos;te açıp yeni biçimde kaydedin.</p>
              <p>Belge okunurken adının yanında dönen simge görünür. Bitince sorabilirsiniz. Adının yanındaki X belgeyi yalnızca bu sohbetten çıkarır, silmez.</p>
            </Topic>
            <Topic id="kitaplik" title="Ortak belgeler ve Belgelerim">
              <ul className="list-disc space-y-1 pl-5">
                <li><L>Ortak belgeler</L>: Kurumun herkese açtığı belgeler. Seçip okuyabilirsiniz, değiştiremezsiniz. Yeni belge eklenmesi için yöneticinize başvurun.</li>
                <li><L>Belgelerim</L>: Yüklediğiniz belgeler. Yalnızca siz görürsünüz. <L>Klasöre taşı</L> ile düzenleyebilirsiniz.</li>
              </ul>
              <p>Sohbette yalnızca seçtiğiniz ya da istediğiniz belgeler okunur. Seçmek için dosyanın kutusunu (<L>Bu sohbette kullan</L>) ya da klasörün + simgesini (<L>Klasörü bu sohbette kullan</L>) kullanın.</p>
              <p>Hiç belge seçmediyseniz yazarak da isteyebilirsiniz: <em>“mevzuat klasöründeki kaynakları kullanarak özet hazırla”</em>. Eşleşen belgeler (en çok 8 tane) sonraki sorularda da kullanılır.</p>
              <Warn>Belgelerim&apos;deki <L>Sil</L> belgeyi kalıcı olarak kaldırır; ikinci kez onay ister.</Warn>
            </Topic>
            <Topic id="hazir" title="Hazır işler ve profiller">
              <p>Belgesi hazır yeni bir sohbette şu düğmeler çıkar ve tüm belgeyi kullanır: <L>Özetle</L>, <L>Karşılaştır</L> (2 ya da daha çok belgeyle), <L>Rakamları kontrol et</L>, <L>Şartları çıkar</L>, <L>Ana başlıklar</L>, <L>Sütunları açıkla</L> (tablo dosyasında).</p>
              <p>Gönder düğmesinin yanındaki profil, belge tek seferde okunamayacak kadar büyükse nasıl çalışılacağını belirler:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><L>Otomatik</L>: Soruya göre ilgili bölümleri ya da tüm belgeyi kullanır. Çoğu durumda yeterlidir.</li>
                <li><L>Hızlı</L>: En hızlı cevap; büyük belgede ilgili bölümleri kullanır.</li>
                <li><L>Derin analiz</L>: Belgenin tamamını kullanır; daha yavaş, daha kapsamlıdır.</li>
              </ul>
            </Topic>
            <Topic id="kaynak" title="Cevapları doğrulama">
              <Warn>Yapay zekâ hata yapabilir. Resmî işlerde kullanacağınız rakam, tarih ve hükümleri asıl belgeden kontrol edin.</Warn>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="font-semibold">Sayfa bağlantıları:</strong> Tek belgeli cevaplarda “Sayfa 12” gibi ifadelere tıklayınca <L>Kaynak</L> paneli o yeri açar. Panel belgeden çıkarılan metni gösterir, asıl dosyayı değil; tablolar ve taranmış sayfalar farklı görünebilir.</li>
                <li><strong className="font-semibold">Cevabın altındaki bilgiler:</strong> <L>Kaynak:</L>, <L>Kullanılan bölümler:</L>, <L>Okunan sayfalar:</L> cevabın nereye dayandığını gösterir.</li>
                <li><L>Cümle kaynakları</L>: Cümlelerin belgeyle kelime ve sayı benzerliğini gösterir. Anlamı doğrulamaz.</li>
                <li><strong className="font-semibold">Uyarılar:</strong> <L>Belgelerde geçmeyen sayılar:</L> ve <L>Belgede olmayan sayfa referansı:</L> gibi satırları görürseniz o bilgiyi mutlaka kontrol edin.</li>
                <li>Bilgi belgede yoksa cevap <L>Belgede yok.</L> diye başlar.</li>
              </ul>
            </Topic>
            <Topic id="internet" title="İnternet ve bağlantılar">
              <ul className="list-disc space-y-1 pl-5">
                <li>Asistan gerektiğinde internette arar; bunu ekranda <L>İnternette aranıyor:</L> olarak görürsünüz. Ayrıca açıp kapatmanız gerekmez.</li>
                <li>Belgede bulunmayan bilgi internetten gelirse cevapta ayrı olarak <L>Belgede değil, internetten:</L> diye belirtilir.</li>
                <li>Soruya yazdığınız bağlantıları okuyabilir (en çok 3 adres). Yönetici bu özelliği kapatmış olabilir. Açılmayan siteyi PDF ya da HTML olarak kaydedip yükleyin.</li>
                <li>Cevaplardaki dış bağlantılar güvenlik için tıklanamaz; yalnızca cevabın gerçekten okuduğu sayfalar açılır.</li>
              </ul>
              <Warn>Belgelerinizin içeriği dış bir yapay zekâ servisine gönderilmez. Ancak internet araması yapıldığında sorunuza göre yazılan arama ifadesi dışarı çıkar. Gizli bilgileri sorunun içine yazmak yerine belgede bırakın.</Warn>
            </Topic>
            <Topic id="dosya" title="Cevabı dosya olarak alma">
              <p>Her cevabın altındaki <L>İndir</L> menüsü şu biçimleri verir: Word, PDF, Excel, Markdown, metin, JSON. Tüm sohbet için üst çubuktaki indirme simgesini (<L>Tüm sohbeti dosya olarak indir</L>) kullanın.</p>
              <p>Yazarak da isteyebilirsiniz:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><em>“bunu pdf olarak ver”</em>: Son cevabı dosya yapar.</li>
                <li><em>“bu belgedeki destekleri tablo yap, excel olarak ver”</em>: Önce cevabı yazar, sonra dosyayı hazırlar.</li>
                <li><em>“word ve pdf olarak ver”</em>: Birden çok biçim verir.</li>
              </ul>
              <p>Tablolar Excel&apos;de ayrı sayfalara ve gerçek sayılara dönüşür. Dosyalar tarayıcınızda hazırlanır.</p>
            </Topic>
            <Topic id="sablon" title="Şablon doldurma">
              <p>Kendi boş Excel (.xlsx), Word (.docx), PDF ya da JSON şablonunuza belgelerdeki bilgileri aktarır. Sonuç kendi şablonunuzdur: antet, biçim ve formüller yerinde kalır.</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Bilginin alınacağı belgeleri sohbete ekleyin.</li>
                <li>Yazı kutusunun altındaki <L>Şablon doldur</L> simgesine basın ya da <em>“bilgileri şablona aktar”</em> yazın.</li>
                <li><em>Kayıtlı şablonlardan</em> birini seçin ya da <L>Şablon seç (Excel, Word, PDF, JSON)</L> ile bilgisayarınızdan gösterin (<L>Şablonlarıma kaydet</L> ile bir daha yüklemezsiniz). Varsa özel isteğinizi yazın (örn. yalnızca 2025 kayıtları) ve <L>Belgelerden doldur</L>a basın.</li>
                <li>Bulunan değerleri kontrol edin, gerekirse düzeltin, <L>Dolu şablonu indir</L>e basın.</li>
              </ol>
              <p>Her değerin yanında geldiği belge ve bölüm görünür. Belgede aynen bulunamayan bir değer şablona kendiliğinden yazılmaz, <em>“Doğrulanamadı”</em> diye önerilir; doğruysa üstüne basarak kullanırsınız. Belgede olmayan alan boş kalır.</p>
              <p>Boş hücreler, tablo satırları ve <em>Ad:</em> gibi etiketler kendiliğinden tanınır. Tanınmayan yerlere <code>{"{{ad soyad}}"}</code> ya da <code>____</code> gibi işaret koyabilirsiniz.</p>
              <Warn>Kayıtlar boş satırlardan fazlaysa Word&apos;de ve çoğu Excel şablonunda satır eklenir. PDF&apos;e satır eklenemez: sığmayan kayıtlar ve alana sığmayan değerler yazılmaz, size söylenir. Bu durumda şablonun Word ya da Excel halini kullanın. Taranmış (metni olmayan) PDF şablonları okunamaz. Sonucu kullanmadan önce mutlaka kontrol edin.</Warn>
            </Topic>
            <Topic id="galeri" title="Galeriden fotoğraf getirme">
              <p>Kurumun fotoğraf arşivinden sohbetle fotoğraf isteyebilirsiniz:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><em>“uşak kilim projesinin resimlerinden 3 tanesini getir”</em></li>
                <li><em>“2025 fuar fotoğraflarını göster”</em></li>
                <li><em>“uşak kilim videolarını göster”</em></li>
                <li>Devamı için: <em>“3 tane daha”</em></li>
              </ul>
              <p>Küçük resme basınca büyür; <L>Stüdyoda kullan</L> ile tasarıma alır, <L>İndir</L> ile aslını indirirsiniz. Stüdyoda <L>Görsel</L> panelindeki <L>Galeriden seç</L> de aynı arşivi açar.</p>
              <p>Arama önce klasör ve dosya adlarına, sonra yerel modelin fotoğraflara yazdığı açıklamalara bakar. Yalnızca arşivde gerçekten bulunan dosyalar gösterilir, resim üretilmez. Kişileri yüzünden tanımaz.</p>
              <p>Videolar büyük olsa da sayfada oynatılır ve ileri sarılabilir; video önce tamamen inmez. MP4 ve WEBM genellikle doğrudan oynar. AVI, WMV, MKV gibi biçimler ve bazı MOV dosyaları tarayıcıda oynamaz, <L>İndir</L> ile alırsınız. Videonun içeriği yalnızca bir karesinden tarif edilir, bu yüzden klasör adı videolarda daha da önemlidir.</p>
            </Topic>
            <Topic id="gecmis" title="Sohbetleri yönetme ve yedek">
              <ul className="list-disc space-y-1 pl-5">
                <li><L>Yeni sohbet</L> yeni bir konu açar. <L>Sohbetlerde ara</L> başlık ve mesaj içinde arar.</li>
                <li>Sohbet satırının üzerine gelince simgeler çıkar: <L>Sabitle</L>, <L>Yeniden adlandır</L>, <L>Sil</L>.</li>
                <li>Yanlışlıkla silerseniz 8 saniye içinde <L>Geri al</L> diyebilirsiniz.</li>
                <li><L>Yerel veri ve yedek</L> bölümünde <L>Yedek al</L> sohbetlerinizi dosyaya indirir, <L>Yedekten yükle</L> geri yükler. Başka bir cihaza taşımanın yolu da budur. Yedek belgeleri değil, sohbetleri içerir.</li>
              </ul>
            </Topic>
            <Topic id="sinir" title="Sınırlar ve uyarılar">
              <ul className="list-disc space-y-1 pl-5">
                <li>Dosya başına en çok 25 MB ve 500 sayfa.</li>
                <li>Sohbet başına en çok 20 belge, kişi başına 300 belge.</li>
                <li>Dakikada en çok 20 soru ve 20 yükleme.</li>
                <li>Parola korumalı dosyalar okunamaz; korumayı kaldırıp yeniden yükleyin.</li>
                <li>Çok uzun cevaplar kesilebilir; “devam et” yazabilir ya da soruyu bölebilirsiniz.</li>
              </ul>
            </Topic>
          </Section>

          <Section id="studyo" title="Görsel Stüdyo">
            <Topic id="baslangic" title="Başlangıç">
              <p>Üst çubuktaki <L>Görsel Stüdyo</L> bağlantısıyla açılır. Üç tür iş vardır: <L>Sosyal medya görseli</L>, <L>Sunum</L>, <L>Video / Reels</L>.</p>
              <p><L>Hızlı başlangıç</L> doğrudan boş bir boyut açar: <L>Kare</L> (1080×1080), <L>Dikey</L> (1080×1350), <L>Hikâye</L> (1080×1920), <L>Yatay</L> (1920×1080). <L>Son çalışmalar</L> ve <L>Çalışmalarım</L> kayıtlı işlerinizi açar.</p>
              <p>Soldaki (küçük ekranda alttaki) araç çubuğundan paneller seçilir: <L>Şablon</L>, <L>Yapay zekâ</L>, <L>Metin</L>, <L>Öğeler</L>, <L>Görsel</L>, <L>Marka</L>, <L>Katmanlar</L>, <L>Ayarlar</L>.</p>
            </Topic>
            <Topic id="sosyal" title="Sosyal medya görseli">
              <ol className="list-decimal space-y-1 pl-5">
                <li><L>Şablon</L> panelinden bir tasarım ve boyut seçin.</li>
                <li><L>Metin</L> panelinde şablonun yazılarını doldurun ya da tuvaldeki yazıya çift tıklayın.</li>
                <li><L>Görsel</L> panelinden fotoğraf ve logo ekleyin.</li>
                <li>Sağ üstteki <L>İndir</L> menüsünden PNG, JPEG, WebP ya da SVG alın.</li>
              </ol>
              <Note>Şablon değiştirmek düzenlemeleri sıfırlar, <K>Ctrl+Z</K> ile geri alabilirsiniz. Boyut değiştirince düzenlemeler yeni boyuta taşınır.</Note>
            </Topic>
            <Topic id="yapay" title="Yapay zekâ ile içerik">
              <p><L>Yapay zekâ</L> panelinde konuyu yazın, isterseniz <strong className="font-semibold">Kaynaklar (en fazla 5)</strong> altından belgelerinizi işaretleyin.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li><L>Tek görsel</L>: <L>Metinleri öner</L> seçili tasarımın metinlerini yazar.</li>
                <li><L>Çoklu görsel</L>: Bir konuyu bir dizi görsele böler. <L>Görsel sayısı</L> otomatik ya da 2-10 arasıdır. <L>Görselleri oluştur</L> ile başlatın; sonuç <strong className="font-semibold">Tüm görseller: PNG (ZIP)</strong> olarak indirilebilir.</li>
                <li>Videoda <L>Tüm sahneler</L>: Konudan 2-12 sahne yazar; mevcut sahnelere <L>Sonuna ekle</L> ya da <L>Yerine koy</L> seçebilirsiniz.</li>
              </ul>
              <p>Belgeye dayanan alanların yanında sayfa numarası görünür; dayanmayanda <L>belgede eşleşmedi</L> yazar.</p>
              <Warn>Yapay zekâ yalnızca metin yazar, resim üretmez. Fotoğrafları siz eklersiniz. Kaynak listesinde yalnızca Belgelerim görünür; Ortak belgeler&apos;deki bir belgeyi kullanmak için önce kendi belgelerinize yükleyin.</Warn>
            </Topic>
            <Topic id="sunum" title="Sunum">
              <ol className="list-decimal space-y-1 pl-5">
                <li><L>Sunum</L> panelinde bir tasarım seçin.</li>
                <li>Konuyu, hedef kitleyi ve öne çıkacak noktaları yazın, varsa kaynak işaretleyin.</li>
                <li><L>Slayt sayısı</L>nı seçip <L>Sunumu oluştur</L>a basın. Elle başlamak için <L>Boş sunumla başla</L>.</li>
                <li>Bitince <L>PowerPoint indir</L> ile PPTX alın.</li>
              </ol>
              <p>Alttaki slayt şeridinde <strong className="font-semibold">Slayt ekle</strong> sayfa düzeni sorar. <L>Çoğalt</L> ve <L>Sil</L> de buradadır. Slaytları sürükleyerek sıralayabilirsiniz.</p>
              <p><L>Asıl slayt</L> panelinden tüm slaytlardaki logo, konum, tarih, altbilgi ve sayfa numarası ayarlanır.</p>
              <p>Tasarımı sonradan değiştirmek için <L>Bu tasarımı uygula</L> kullanılır; slaytlar yeniden kurulur ve elle yaptığınız düzenlemeler taşınmaz. <L>Önceki tasarıma dön</L> bir adım geri alır.</p>
              <Note>Sunumlar 16:9 yatay ve en çok 100 slayttır. Yazı tipleri PPTX dosyasına gömülmez; bilgisayarda yoksa PowerPoint benzeriyle gösterir. Kaynaksız yazılan içeriği kullanmadan önce kontrol edin.</Note>
            </Topic>
            <Topic id="video" title="Video / Reels">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Yapay zekâyla ya da <L>Sahne ekle</L> ile sahneleri oluşturun; <L>Hazır akışlar</L> ile de başlayabilirsiniz.</li>
                <li><L>Sahneler</L> panelinde her sahnenin süresini, yazı ve arka plan hareketini, altyazısını seçin.</li>
                <li><L>Geçiş</L> seçin, isterseniz <L>Müzik ekle (isteğe bağlı)</L>.</li>
                <li><L>Videoyu oluştur</L>a basın, önizleyip indirin.</li>
              </ol>
              <p>Altyazıyı <L>Altyazıyı videoya yaz</L> ile görüntüye yazdırabilir, <L>SRT indir</L> ya da <L>VTT indir</L> ile ayrı alabilirsiniz.</p>
              <Warn>Kayıt gerçek sürede yapılır; bitene kadar sekmeyi açık tutun. En çok 20 sahne eklenebilir. Güncel Chrome ya da Edge kullanın. Müzik dosyası ve bitmiş video çalışmayla kaydedilmez: videoyu indirin, yeniden oluşturacaksanız müziği tekrar ekleyin.</Warn>
            </Topic>
            <Topic id="duzenleme" title="Tuvalde düzenleme">
              <ul className="list-disc space-y-1 pl-5">
                <li><strong className="font-semibold">Seçme:</strong> Öğeye tıklayın; boş alanda sürükleyerek ya da <K>Shift</K> ile birden çok öğe seçin.</li>
                <li><strong className="font-semibold">Taşıma ve boyut:</strong> Sürükleyin, köşe tutamaklarını çekin. Hizalama çizgileri kendiliğinden çıkar; <K>Alt</K> bunları kapatır, <K>Shift</K> oranı korur.</li>
                <li><strong className="font-semibold">Yazı:</strong> Çift tıklayın. Bir bölümünü seçerseniz yazı tipi, boyut, kalınlık ve renk yalnızca o bölüme uygulanır.</li>
                <li><strong className="font-semibold">Şekiller:</strong> <L>Öğeler</L> panelinde <L>Dolu</L>, <L>Kontur</L>, <L>Kesikli</L> ya da <L>Resim</L> biçimi seçip şekle tıklayın. <L>Hazır şekil galerisi</L> daha hazır çizimler sunar.</li>
                <li><strong className="font-semibold">Sağ tık menüsü:</strong> <L>Stili kopyala</L>, <L>Şekli değiştir</L>, <L>Resimle doldur…</L>, <L>Kilitle</L> ve hizalama komutları buradadır.</li>
                <li><strong className="font-semibold">Birden çok öğe:</strong> <L>Yatay eşit aralık</L>, <L>Dikey eşit aralık</L>, <L>Aynı genişlik</L> ve <L>Aynı yükseklik</L> <L>Ayarlar</L> panelindedir.</li>
                <li><L>Katmanlar</L>: Üstteki katman önde görünür. Satırları sürükleyerek sıralayın.</li>
                <li><L>Ayarlar</L>: Konum, saydamlık, döndürme, gölge, satır ve harf aralığı, kenarlık.</li>
              </ul>
              <p>Yazı tipi listesinden hazır bir yazı tipi seçebilir, <L>Yazı tipi dosyası yükle</L> ile kendi dosyanızı kullanabilirsiniz. Lisansının bu kullanıma izin verdiğinden emin olun.</p>
            </Topic>
            <Topic id="marka" title="Marka ve logolar">
              <p><L>Marka</L> panelinde <L>Temalar</L>, <L>Ana renk</L> ve <L>Vurgu</L> ile renkleri belirleyin. <L>Logo kütüphanesi</L>ne <L>Logo ekle</L> ile en çok 40 logo koyabilirsiniz. Bir logoya tıklamak onu şablonun logosu yapar; <L>Tasarıma ekle</L> tasarıma ayrıca yerleştirir.</p>
              <p>Tuvaldeki logoyu <L>Logoyu değiştir</L> ile değiştirebilirsiniz. Logolar bozulmaz, oranları korunur. Şeffaf arka planlı PNG ya da SVG en iyi sonucu verir.</p>
            </Topic>
            <Topic id="kayit" title="Kaydetme ve taşıma">
              <ul className="list-disc space-y-1 pl-5">
                <li>Çalışmalar değişiklikten kısa süre sonra kendiliğinden kaydedilir; üstte <L>Kaydedildi</L> görünür. Adı üstteki alandan değiştirilir.</li>
                <li><L>Çalışmalarım</L> kayıtlı işleri açar. <L>Yeni çalışma olarak</L> bir kopya çıkarır. En çok 200 çalışma saklanır.</li>
                <li>Başka bilgisayara taşımak için <L>İndir</L> menüsünden <L>Proje dosyası olarak kaydet</L>, diğer bilgisayarda <L>Dosya aç</L>.</li>
              </ul>
            </Topic>
            <Topic id="indir" title="Dışa aktarma">
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-subtle text-left"><tr><th className="px-3 py-2 font-medium">İş</th><th className="px-3 py-2 font-medium">Biçim</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-line"><td className="px-3 py-2">Sosyal medya görseli</td><td className="px-3 py-2">PNG, JPEG, WebP, SVG</td></tr>
                    <tr className="border-t border-line"><td className="px-3 py-2">Çoklu görsel</td><td className="px-3 py-2">Tek tek ya da hepsi ZIP olarak</td></tr>
                    <tr className="border-t border-line"><td className="px-3 py-2">Sunum</td><td className="px-3 py-2">PowerPoint (PPTX); slayt başına PNG, JPEG, WebP, SVG</td></tr>
                    <tr className="border-t border-line"><td className="px-3 py-2">Video</td><td className="px-3 py-2">MP4 ya da WEBM (tarayıcıya göre)</td></tr>
                  </tbody>
                </table>
              </div>
              <p>Stüdyodan doğrudan PDF alınmaz; sunumu PowerPoint&apos;te açıp PDF olarak kaydedebilirsiniz. Görsel ya da slayt, <L>Video sahnesi olarak ekle</L> ile videoya taşınabilir.</p>
            </Topic>
            <Topic id="kisayol" title="Klavye kısayolları">
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <tbody>
                    {([
                      ["Ctrl+Z / Ctrl+Y", "Geri al / yinele (100 adım)"],
                      ["Ctrl+C, Ctrl+X, Ctrl+V", "Kopyala, kes, yapıştır"],
                      ["Ctrl+D", "Çoğalt"],
                      ["Ctrl+A", "Tümünü seç (kilitliler hariç)"],
                      ["Delete", "Sil"],
                      ["Enter", "Seçili yazıyı düzenle"],
                      ["Esc", "Seçimi ya da düzenlemeyi bitir"],
                      ["Yön tuşları", "1 piksel taşı; Shift ile 10 piksel. Seçim yokken sunumda slayt değiştirir"],
                      ["Ctrl+yön (slayt şeridinde)", "Slaydı taşı"],
                      ["Ctrl+yukarı/aşağı (katmanlarda)", "Katmanı taşı"],
                    ] as const).map(([keys, what]) => (
                      <tr key={keys} className="border-t border-line first:border-t-0"><td className="whitespace-nowrap px-3 py-2"><K>{keys}</K></td><td className="px-3 py-2">{what}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>Tema uygulamak, asıl slaytı değiştirmek ya da tasarım uygulamak geri alma geçmişini temizler. Sahne değişiklikleri <K>Ctrl+Z</K> ile geri alınmaz.</p>
            </Topic>
          </Section>

          <Section id="sorun" title="Sık karşılaşılan durumlar">
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-subtle text-left"><tr><th className="px-3 py-2 font-medium">Gördüğünüz</th><th className="px-3 py-2 font-medium">Ne yapmalı</th></tr></thead>
                <tbody>
                  {([
                    ["Model sunucusuna ulaşılamıyor. Yöneticinize bildirin.", "Sistem güncelleniyor olabilir. Birkaç dakika sonra deneyin, sürerse yöneticinize bildirin."],
                    ["Sunucu şu an çok yoğun. Biraz sonra tekrar deneyin.", "Kısa süre bekleyip yeniden gönderin."],
                    ["Dosya okunamadı. Bozuk ya da parola korumalı olabilir.", "Parola korumasını kaldırın ya da dosyayı yeniden kaydedin."],
                    ["Eski .doc biçimi bu sunucuda desteklenmiyor. Dosyayı Word'de açıp .docx olarak kaydedin.", "Dosyayı .docx olarak kaydedip yeniden yükleyin."],
                    ["Eski .doc dosyası dönüştürülemedi: bozuk ya da parolalı olabilir.", "Dosyayı Word'de açıp .docx olarak kaydedip yeniden yükleyin."],
                    ["Tarayıcı depolama alanı dolu: eski sohbetleri silin ya da yedek alıp temizleyin.", "Yedek alın, eski sohbetleri silin."],
                    ["Bağlantı koptu. Lütfen tekrar deneyin.", "İnternetinizi kontrol edip soruyu yeniden gönderin."],
                    ["Bu tarayıcı video kaydedemiyor. Güncel Chrome ya da Edge kullanın.", "Chrome ya da Edge ile açın. Çalışmanızı proje dosyası olarak taşıyabilirsiniz."],
                  ] as const).map(([seen, act]) => (
                    <tr key={seen} className="border-t border-line align-top"><td className="px-3 py-2"><L>{seen}</L></td><td className="px-3 py-2">{act}</td></tr>
                  ))}
                  <tr className="border-t border-line align-top"><td className="px-3 py-2">Sohbetlerim ya da çalışmalarım görünmüyor</td><td className="px-3 py-2">Aynı cihaz, aynı tarayıcı ve aynı kullanıcıyla mı girdiniz? Bunlar yalnızca o tarayıcıda durur. Gizli pencerede kaydedilmez.</td></tr>
                  <tr className="border-t border-line align-top"><td className="px-3 py-2">Giriş yapamıyorum</td><td className="px-3 py-2">Art arda hatalı denemeden sonra 15 dakika bekleyin. Parolanızı unuttuysanız yöneticinizden yeni parola isteyin.</td></tr>
                </tbody>
              </table>
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
}
