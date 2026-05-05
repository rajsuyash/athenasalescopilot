import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Rocket Sales Agent · Real-time AI sales coach for Google Meet',
  description:
    'Rocket Sales Agent listens to your sales calls and surfaces grounded answers, objection handling, and next-best questions in real time — pulled from your own playbook in under two seconds.',
  metadataBase: new URL('https://rocketsalesagent.com'),
  openGraph: {
    title: 'Rocket Sales Agent — close more calls with AI in your ear',
    description:
      'Real-time, grounded coaching for Google Meet. Built for B2B sales teams.',
    url: 'https://rocketsalesagent.com',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased font-sans" suppressHydrationWarning>
        <ClerkProvider
          appearance={{
            baseTheme: dark,
            variables: {
              colorPrimary: '#6ee7b7',
              colorBackground: '#0b0f17',
              colorText: '#f8fafc',
              colorTextSecondary: '#94a3b8',
              colorInputBackground: '#152031',
              colorInputText: '#f8fafc',
              fontFamily: 'var(--font-jakarta)',
              borderRadius: '10px',
            },
            elements: {
              card: 'backdrop-blur-xl bg-ink-800/60 border border-white/5',
              formButtonPrimary: 'shadow-glow-mint',
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
