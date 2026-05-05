import { SignIn } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-3xl font-semibold tracking-tight">
            <span className="text-accent">Rocket</span>
            <span className="text-white/60">.</span>
          </div>
          <div className="text-sm text-white/60 mt-1">Sales Agent · workspace admin</div>
        </div>
        <SignIn signUpUrl="/signup" forceRedirectUrl="/dashboard" />
      </div>
    </div>
  );
}
