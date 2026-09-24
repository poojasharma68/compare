import { AuditForm } from '@/components/audit/AuditForm';
import { envFigmaToken } from '@/lib/figma/figmaClient';
import { Logo } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

const CAPABILITIES = [
  {
    title: 'Figma → live comparison',
    body: 'Layer geometry, type, colour and structure from the Figma REST API, matched against real DOM elements and computed CSS.',
  },
  {
    title: 'Multi-viewport responsive suite',
    body: 'Nine preset viewports plus any custom width × height, checked for overflow, overlap, clipping, wrapping and layout breaks.',
  },
  {
    title: 'Cross-browser comparison',
    body: 'The same page in Chromium, Firefox and WebKit, diffed element by element — anything that breaks, shifts or disappears in one engine is flagged.',
  },
  {
    title: 'No pixel diffing',
    body: 'Every verdict comes from measured geometry and computed styles. Screenshots are captured only as supporting evidence.',
  },
];

export default function HomePage() {
  const hasServerToken = Boolean(envFigmaToken());

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-10 sm:py-16">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-ink">UIX-Ray</span>
          </div>
        </div>
        <span className="font-mono text-[11px] text-faint">v0.1 · MVP</span>
      </header>

      <div className="grid flex-1 items-start gap-10 lg:grid-cols-[1fr_minmax(420px,520px)] lg:gap-14">
        <section className="animate-rise pt-2">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            Frontend UI &amp;
            <br />
            <span className="text-brand">Responsive Testing</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            Point UIX-Ray at a Figma frame and a live URL. It reads the design through the Figma API, measures the real
            page with Playwright, matches layers to elements, and reports exactly where the implementation drifts —
            plus every responsive break across viewports and browsers.
          </p>

          <dl className="mt-9 space-y-5 border-l border-line pl-5">
            {CAPABILITIES.map((item) => (
              <div key={item.title}>
                <dt className="text-[13.5px] font-medium text-ink">{item.title}</dt>
                <dd className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted">{item.body}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-faint">
            <span>Playwright · Chromium · Firefox · WebKit</span>
            <span className="text-line-strong">/</span>
            <span>Figma REST API</span>
            <span className="text-line-strong">/</span>
            <span>getBoundingClientRect</span>
            <span className="text-line-strong">/</span>
            <span>getComputedStyle</span>
          </div>
        </section>

        <div className="animate-rise" style={{ animationDelay: '80ms' }}>
          <AuditForm hasServerToken={hasServerToken} />
        </div>
      </div>
    </main>
  );
}
