import Link from 'next/link';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-white/5 bg-ink-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight text-accent">
            Athena
          </Link>
          <nav className="flex gap-4 text-sm text-white/70 ml-2">
            <Link href="/#how" className="hover:text-white">
              How it works
            </Link>
            <Link href="/#pricing" className="hover:text-white">
              Pricing
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/signin" className="text-white/70 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/signin?mode=signup"
              className="rounded bg-accent text-ink-900 font-medium px-3 py-1.5"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-white/5 mt-16">
      <div className="max-w-5xl mx-auto px-6 py-8 text-xs text-white/40 flex flex-wrap items-center gap-4">
        <span>© {new Date().getFullYear()} Athena</span>
        <Link href="/privacy" className="hover:text-white/70">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-white/70">
          Terms
        </Link>
        <a href="mailto:hello@athena.app" className="hover:text-white/70">
          Contact
        </a>
        <span className="ml-auto">Sales copilot · grounded · real-time</span>
      </div>
    </footer>
  );
}
