import Link from 'next/link';
import { Button, Logo } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-5 py-16">
      <div className="panel p-7">
        <Logo />
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">Page not found</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          That URL does not match anything in UIX-Ray.
        </p>
        <Link href="/" className="mt-5 inline-block">
          <Button size="sm">Back to the audit form</Button>
        </Link>
      </div>
    </main>
  );
}
