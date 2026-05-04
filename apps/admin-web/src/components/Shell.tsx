import Link from 'next/link';

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
            Athena
          </Link>
          <nav className="flex gap-4 text-sm text-white/70">
            <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
            <Link href="/playbooks" className="hover:text-white">Playbooks</Link>
            <Link href="/meetings" className="hover:text-white">Meetings</Link>
            <Link href="/settings" className="hover:text-white">Settings</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-white/50">
            {workspace ? <span>{workspace}</span> : null}
            {email ? <span>{email}</span> : null}
            <form action="/api/auth/logout" method="post">
              <button className="rounded px-2 py-1 hover:bg-white/5" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">{children}</main>
      <footer className="border-t border-white/5 text-xs text-white/40 py-3">
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center gap-4">
          <span>Athena · sales copilot · workspace admin</span>
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
