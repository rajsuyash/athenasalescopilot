'use client';

import Link from 'next/link';
import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useState } from 'react';
import { AmbientBg } from './landing/AmbientBg';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell relative min-h-screen flex flex-col text-white selection:bg-accent/30 selection:text-white">
      <AmbientBg />
      <div className="relative z-10 flex flex-1 flex-col">
        <FloatingNav />
        <main className="flex-1">{children}</main>
        <PublicFooter />
      </div>
    </div>
  );
}

function FloatingNav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 12));

  // Scroll progress bar (top edge) — gives the page a constant motion signal.
  const { scrollYProgress } = useScroll();
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <>
      <motion.div
        style={{ scaleX }}
        className="fixed top-0 left-0 right-0 z-50 h-[2px] origin-left bg-gradient-to-r from-accent via-electric-400 to-violet-400"
        aria-hidden="true"
      />
      {/* Top bar — full-width, always-visible. Three zones via flex with
          margin-auto on the brand. CSS is plain and stable; no fragile
          width math. */}
      <motion.header
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
        className={`fixed top-0 inset-x-0 z-40 transition-colors duration-300
          ${scrolled
            ? 'bg-ink-900/85 border-b border-white/10 shadow-glow-soft backdrop-blur-2xl'
            : 'bg-ink-900/40 border-b border-white/5 backdrop-blur-md'}`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          {/* Brand — left */}
          <Link
            href="/"
            className="group flex items-center gap-2 font-semibold tracking-tight"
          >
            <BrandMark />
            <span className="text-white/90 group-hover:text-white transition-colors">
              Rocket<span className="text-accent">.</span>
            </span>
          </Link>

          {/* Center nav — hidden on small screens. mx-auto centers it within
              the remaining flex slack between brand and right cluster. */}
          <nav className="hidden md:flex items-center gap-0.5 mx-auto text-sm text-white/65">
            <NavLink href="/#how">How it works</NavLink>
            <NavLink href="/#features">Features</NavLink>
            <NavLink href="/#pricing">Pricing</NavLink>
            <NavLink href="/install">Install</NavLink>
          </nav>

          {/* Right cluster — Sign in + Get started. ml-auto so it sticks to
              the right whether or not the nav renders. */}
          <div className="flex items-center gap-2 text-sm ml-auto md:ml-0">
            <Link
              href="/signin"
              className="px-3 py-1.5 text-white/90 hover:text-white hover:bg-white/5 rounded-md transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signin?mode=signup"
              className="group relative inline-flex items-center gap-1.5 rounded-lg bg-accent text-ink-900 font-semibold px-3.5 py-1.5 shadow-glow-mint hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200"
            >
              <span>Get started</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </motion.header>
    </>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md hover:text-white hover:bg-white/5 transition-colors"
    >
      {children}
    </Link>
  );
}

function BrandMark() {
  return (
    <span className="relative inline-grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-accent via-electric-400 to-violet-400 shadow-[0_8px_24px_-8px_rgba(110,231,183,0.7)]">
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-ink-900" fill="currentColor">
        {/* Rocket / sparkle composite — vector, not emoji. */}
        <path d="M12 2.5L13.7 8.4 19.5 10 13.7 11.6 12 17.5 10.3 11.6 4.5 10 10.3 8.4z" />
      </svg>
      <span className="absolute inset-0 rounded-lg ring-1 ring-white/10" />
    </span>
  );
}

function ArrowRight({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

export function PublicFooter() {
  return (
    <footer className="relative mt-32 border-t border-white/5">
      <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
        <div className="col-span-2">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark />
            <span>Rocket Sales Agent</span>
          </div>
          <p className="mt-3 text-white/50 max-w-xs leading-relaxed">
            The AI sales coach that whispers grounded answers in your ear during every Google Meet
            call. Built for B2B sellers who want to close.
          </p>
        </div>
        <div>
          <div className="text-white/40 text-xs uppercase tracking-widest mb-3">Product</div>
          <ul className="space-y-2 text-white/70">
            <li><Link href="/#features" className="hover:text-white transition-colors">Features</Link></li>
            <li><Link href="/#how" className="hover:text-white transition-colors">How it works</Link></li>
            <li><Link href="/#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
            <li><Link href="/install" className="hover:text-white transition-colors">Install for Chrome</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-white/40 text-xs uppercase tracking-widest mb-3">Company</div>
          <ul className="space-y-2 text-white/70">
            <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link></li>
            <li><Link href="/terms" className="hover:text-white transition-colors">Terms</Link></li>
            <li><a href="mailto:rajsuyash@gmail.com" className="hover:text-white transition-colors">Contact</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Rocket Sales Agent. All rights reserved.</span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_2px_rgba(110,231,183,0.6)]" />
            All systems operational
          </span>
        </div>
      </div>
    </footer>
  );
}
