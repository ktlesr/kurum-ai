// What a link shows when shared (WhatsApp and the like). These apps never sign in, so a card is chosen from the address only
// and says nothing about anyone's work.
import type { Metadata } from "next";

export const OG_CARDS = {
  home: { title: "Zafer AI", text: "Dokümanlarınız hakkında soru sorun. İşleme kurum sunucusunda yapılır." },
  studio: { title: "Görsel Stüdyo", text: "Sosyal medya görseli, sunum ve Reels'i yapay zekâ desteğiyle hazırlayın." },
} as const;
export type OgCard = keyof typeof OG_CARDS;

export function ogMeta(card: OgCard): Pick<Metadata, "openGraph" | "twitter"> {
  const { title, text } = OG_CARDS[card];
  const images = [{ url: `/api/og?k=${card}`, width: 1200, height: 630, alt: title, type: "image/png" }];
  return {
    openGraph: { title, description: text, siteName: "Zafer AI", locale: "tr_TR", type: "website", images },
    twitter: { card: "summary_large_image", title, description: text, images: images.map((i) => i.url) },
  };
}
