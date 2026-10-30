// The mark is one file (public/logo.svg), also the tab icon. An <img> keeps it one source.
export function Logo({ size = 32 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="" width={size} height={size} className="shrink-0" />;
}

export function BetaBadge() {
  return <span className="rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-accent">Beta</span>;
}
