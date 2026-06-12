'use client';

/**
 * EN | FR segmented switch (header). Persists the choice in the NEXT_LOCALE
 * cookie and refreshes the route so server components re-render in the new
 * locale. One year expiry; path=/ so every page sees it.
 */
import { useRouter } from 'next/navigation';
import { LOCALES, LOCALE_COOKIE, type Locale } from '@/lib/i18n/dictionaries';

const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();

  function setLocale(next: Locale): void {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE_S}; samesite=lax`;
    router.refresh();
  }

  return (
    <div
      className="inline-flex rounded-md border border-white/10 overflow-hidden text-[11px]"
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          aria-pressed={l === locale}
          className={`px-2 py-1 font-medium uppercase transition-colors ${
            l === locale
              ? 'bg-accent/20 text-accent'
              : 'text-white/40 hover:text-white/80 hover:bg-white/5'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
