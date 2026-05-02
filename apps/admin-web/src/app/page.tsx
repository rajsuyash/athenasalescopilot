import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { PublicShell } from '@/components/PublicShell';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect('/dashboard');

  return (
    <PublicShell>
      <section className="px-6 pt-20 pb-24 max-w-5xl mx-auto text-center">
        <span className="inline-block text-[11px] uppercase tracking-widest text-accent border border-accent/40 rounded-full px-3 py-1 mb-6">
          Real-time sales coach
        </span>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">
          Win more calls. <br />
          <span className="text-accent">Grounded answers, live.</span>
        </h1>
        <p className="mt-6 text-base md:text-lg text-white/60 max-w-2xl mx-auto">
          Athena listens to your Google Meet calls and surfaces grounded answers, objection
          handling, and the next-best question — pulled from your own playbook in under two seconds.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/signin?mode=signup"
            className="rounded bg-accent text-ink-900 font-medium px-5 py-2.5"
          >
            Get started — it&apos;s free
          </Link>
          <Link
            href="#how"
            className="rounded border border-white/15 px-5 py-2.5 hover:bg-white/5"
          >
            How it works
          </Link>
        </div>
        <p className="mt-4 text-xs text-white/40">
          Free tier · 3 seats · 5 meeting hours / month · no credit card
        </p>
      </section>

      <section id="how" className="px-6 py-16 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Pillar
            title="Live coaching"
            body="Whisper-quiet overlay shows the exact answer or follow-up question to ask, scored against your knowledge base. Suggestions arrive in under 2 seconds from the moment the prospect finishes speaking."
          />
          <Pillar
            title="Grounded in your stack"
            body="Upload your decks, battlecards, and FAQ. Athena chunks them, embeds them, and only ever surfaces text that maps back to a real source. No hallucinated pricing."
          />
          <Pillar
            title="Auto recap + follow-up"
            body="When the call ends, Athena ships a summary, a draft follow-up email, and a list of CRM updates. Forward the inbox link to your manager."
          />
        </div>
      </section>

      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-semibold tracking-tight text-center mb-10">
          Three minutes to your first coached call
        </h2>
        <ol className="space-y-4 text-sm text-white/70 max-w-2xl mx-auto">
          <Step n={1}>
            <strong className="text-white/90">Sign up</strong> — create a workspace. We seed a
            starter knowledge doc so you can see suggestions on call #1.
          </Step>
          <Step n={2}>
            <strong className="text-white/90">Install the Chrome extension</strong> — it detects
            Google Meet automatically and pairs with the overlay.
          </Step>
          <Step n={3}>
            <strong className="text-white/90">Start a meeting</strong> — open Meet, click{' '}
            <em>Open in Athena</em>, and the suggestions stream in real time.
          </Step>
        </ol>
      </section>

      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="text-2xl font-semibold tracking-tight text-center mb-10">Pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PriceCard
            tier="Free"
            price="$0"
            blurb="For solo reps trying it out."
            features={['3 seats', '5 meeting hours / month', 'All grounding features', 'Email support']}
            cta="Get started"
            href="/signin?mode=signup"
            highlighted
          />
          <PriceCard
            tier="Pro"
            price="Soon"
            blurb="For small sales teams."
            features={['25 seats', '250 meeting hours / month', 'Manager dashboards', 'Priority support']}
            cta="Join the waitlist"
            href="/signin?mode=signup"
          />
          <PriceCard
            tier="Enterprise"
            price="Talk to us"
            blurb="For larger orgs that need SSO + audit."
            features={['200 seats', 'Unlimited meeting hours', 'Custom retention + SSO', 'Dedicated success']}
            cta="Contact"
            href="mailto:hello@athena.app"
          />
        </div>
      </section>

      <section className="px-6 py-20 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-semibold tracking-tight mb-3">
          Try it on your next discovery call
        </h2>
        <p className="text-white/60 mb-6">
          Free forever for solo reps. Bring your own playbook, get coached on call #1.
        </p>
        <Link
          href="/signin?mode=signup"
          className="inline-block rounded bg-accent text-ink-900 font-medium px-6 py-3"
        >
          Create your workspace
        </Link>
      </section>
    </PublicShell>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/40 p-5">
      <h3 className="font-medium mb-2">{title}</h3>
      <p className="text-sm text-white/60">{body}</p>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex-shrink-0 w-7 h-7 rounded-full border border-accent/50 text-accent flex items-center justify-center text-xs font-medium">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

interface PriceCardProps {
  tier: string;
  price: string;
  blurb: string;
  features: string[];
  cta: string;
  href: string;
  highlighted?: boolean;
}

function PriceCard({ tier, price, blurb, features, cta, href, highlighted }: PriceCardProps) {
  return (
    <div
      className={`rounded-lg border p-6 flex flex-col ${
        highlighted ? 'border-accent/50 bg-accent/5' : 'border-white/5 bg-ink-800/40'
      }`}
    >
      <div className="text-sm text-white/60">{tier}</div>
      <div className="text-3xl font-semibold mt-1">{price}</div>
      <p className="text-xs text-white/50 mt-2 mb-4">{blurb}</p>
      <ul className="space-y-1.5 text-sm text-white/70 mb-6 flex-1">
        {features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      <Link
        href={href}
        className={`text-center rounded font-medium py-2 ${
          highlighted
            ? 'bg-accent text-ink-900'
            : 'border border-white/15 hover:bg-white/5'
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
