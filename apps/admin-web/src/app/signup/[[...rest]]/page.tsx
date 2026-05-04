import { SignUp } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-3xl font-semibold tracking-tight text-accent">Athena</div>
          <div className="text-sm text-white/60 mt-1">create your workspace</div>
        </div>
        <SignUp signInUrl="/signin" forceRedirectUrl="/dashboard" />
      </div>
    </div>
  );
}
