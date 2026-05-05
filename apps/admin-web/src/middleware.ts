import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Public routes that should bypass the Clerk session check. Anything not
// listed here requires a signed-in user — that includes /dashboard,
// /playbooks, /meetings, /settings, and every /api proxy route.
const isPublic = createRouteMatcher([
  '/',
  '/signin(.*)',
  '/signup(.*)',
  '/privacy',
  '/terms',
  '/install',
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
