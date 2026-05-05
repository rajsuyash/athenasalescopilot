import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { PublicShell } from '@/components/PublicShell';
import { Hero } from '@/components/landing/Hero';
import { LogosRow } from '@/components/landing/LogosRow';
import { Stats } from '@/components/landing/Stats';
import { BentoGrid } from '@/components/landing/BentoGrid';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Pricing } from '@/components/landing/Pricing';
import { Cta } from '@/components/landing/Cta';

export const dynamic = 'force-dynamic';

/**
 * rocketsalesagent.com landing page. Composition is hero-driven with a
 * live demo of the product in the right column, then social-proof, then
 * features (bento), then how-it-works, then pricing, then a final CTA.
 *
 * All sections are client components driven by Framer Motion — they
 * scroll-fade-in, the hero coach card auto-cycles three demo scenes,
 * the floating nav reacts to scroll, and a global scroll-progress bar
 * paints the top of the viewport.
 */
export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect('/dashboard');

  return (
    <PublicShell>
      <Hero />
      <LogosRow />
      <Stats />
      <BentoGrid />
      <HowItWorks />
      <Pricing />
      <Cta />
    </PublicShell>
  );
}
