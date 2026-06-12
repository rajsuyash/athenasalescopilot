'use client';

/**
 * Client-side locale context. The root layout (server) reads the NEXT_LOCALE
 * cookie and seeds this provider, so client components (Shell, gate, switch)
 * render the right language on first paint — no flash, no document.cookie
 * parsing in components.
 */
import { createContext, useContext } from 'react';
import { DEFAULT_LOCALE, dictionaries, type Dict, type Locale } from './dictionaries';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useDict(): Dict {
  return dictionaries[useContext(LocaleContext)];
}
