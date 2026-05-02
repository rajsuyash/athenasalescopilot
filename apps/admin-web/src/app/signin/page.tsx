import Link from 'next/link';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Do NOT auto-redirect on cookie presence. Next 15 Server Components
  // cannot mutate cookies, so a stale/expired session cookie cannot be
  // cleared from the dashboard's failure path — the user gets bounced
  // back here. If we redirect to /dashboard on cookie presence, the loop
  // is permanent. Instead, always render the form; the route handler at
  // /api/auth/login replaces the cookie atomically on submit.
  const params = await searchParams;
  const error = params?.error ?? null;
  const mode = params?.mode === 'signup' ? 'signup' : 'signin';

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-3xl font-semibold tracking-tight text-accent">Athena</div>
          <div className="text-sm text-white/60 mt-1">workspace admin</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-ink-800/60 p-6">
          {mode === 'signup' ? <SignupForm /> : <SignInForm />}
          {error ? (
            <p className="mt-4 text-sm text-red-400" data-testid="signin-error">
              {decodeURIComponent(error)}
            </p>
          ) : null}
          <p className="mt-6 text-xs text-white/50 text-center">
            {mode === 'signup' ? (
              <>
                Already have a workspace?{' '}
                <Link className="underline" href="/signin">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{' '}
                <Link className="underline" href="/signin?mode=signup">
                  Create a workspace
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function SignInForm() {
  return (
    <form action="/api/auth/login" method="post" className="space-y-3">
      <h1 className="font-medium">Sign in</h1>
      <Input label="Email" name="email" type="email" autoComplete="email" required />
      <Input label="Password" name="password" type="password" autoComplete="current-password" required />
      <Input label="Workspace slug (optional)" name="workspaceSlug" placeholder="acme" />
      <button className="w-full rounded bg-accent text-ink-900 font-medium py-2 mt-2" type="submit">
        Sign in
      </button>
    </form>
  );
}

function SignupForm() {
  return (
    <form action="/api/auth/signup" method="post" className="space-y-3">
      <h1 className="font-medium">Create your workspace</h1>
      <Input label="Your name" name="name" required />
      <Input label="Email" name="email" type="email" autoComplete="email" required />
      <Input label="Password (≥12 chars)" name="password" type="password" minLength={12} required />
      <Input label="Workspace name" name="workspaceName" placeholder="Acme Sales" required />
      <Input label="Workspace slug" name="workspaceSlug" placeholder="acme" required />
      <button className="w-full rounded bg-accent text-ink-900 font-medium py-2 mt-2" type="submit">
        Create
      </button>
    </form>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="block">
      <span className="block text-xs text-white/60 mb-1">{label}</span>
      <input
        {...rest}
        className="w-full rounded border border-white/10 bg-ink-700/60 px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
    </label>
  );
}
