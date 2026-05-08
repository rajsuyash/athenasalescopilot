import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Public routes that should bypass the Clerk session check. Anything not
// listed here requires a signed-in user — that includes /dashboard,
// /playbooks, /meetings, /settings, and every /api proxy route.
//
// /connect-extension is public so the page itself can render in our shell
// while showing a branded "Sign in first" prompt to unauth'd visitors. The
// /api/auth/extension/pair-start proxy underneath still requires auth, so
// the actual code-mint flow remains gated; only the marketing/instruction
// surface is reachable without a session.
const isPublic = createRouteMatcher([
  '/',
  '/signin(.*)',
  '/signup(.*)',
  '/privacy',
  '/terms',
  '/install',
  '/connect-extension',
  '/extension-auth(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  await auth.protect();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
