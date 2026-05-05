import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export interface ShellProps {
  email?: string | null;
  workspace?: string | null;
  children: React.ReactNode;
}

export function Shell({ email, workspace, children }: ShellProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-white/5 bg-ink-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold tracking-tight text-accent">
            Rocket<span className="text-white/60">.</span>
          </Link>
          <nav className="flex gap-4 text-sm text-white/70">
            <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
            <Link href="/playbooks" className="hover:text-white">Playbooks</Link>
            <Link href="/meetings" className="hover:text-white">Meetings</Link>
            <Link href="/settings" className="hover:text-white">Settings</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-white/50">
            {/* Persistent install CTA — visible on every signed-in page until
                the Web Store listing publishes. Drives sign-ups straight to
                the sideload guide where the .zip lives. */}
            <Link
              href="/install"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 text-accent px-2.5 py-1 text-[11px] font-medium hover:bg-accent/15 hover:border-accent/50 transition-colors"
              title="Download the Chrome extension"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Install extension
            </Link>
            {workspace ? <span>{workspace}</span> : null}
            {email ? <span className="hidden md:inline">{email}</span> : null}
            <UserButton />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">{children}</main>
      <footer className="border-t border-white/5 text-xs text-white/40 py-3">
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center gap-4">
          <span>Rocket Sales Agent · workspace admin</span>
          <Link href="/privacy" className="ml-auto hover:text-white/70">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-white/70">
            Terms
          </Link>
        </div>
      </footer>
    </div>
  );
}
