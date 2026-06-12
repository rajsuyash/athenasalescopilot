/**
 * Lightweight i18n: typed dictionaries keyed by locale, persisted via the
 * NEXT_LOCALE cookie (see server.ts / LanguageSwitch). Deliberately no i18n
 * library and no /[locale]/ route restructure — a cookie + dictionary covers
 * the need (EN default, FR for the French client base).
 *
 * Coverage is incremental: header/nav + the onboarding journey first. Pages
 * without keys here simply stay English until their keys are added.
 *
 * This module is imported by BOTH server and client components — keep it
 * free of next/headers and other server-only imports.
 */
export type Locale = 'en' | 'fr';

export const LOCALES: Locale[] = ['en', 'fr'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export interface Dict {
  nav: {
    dashboard: string;
    playbooks: string;
    meetings: string;
    settings: string;
    installExtension: string;
  };
  banner: {
    welcome: (workspace: string) => string;
    title: string;
    step1Title: string;
    step1Body: string;
    step2Title: string;
    step2Body: string;
    step3Title: string;
    step3Body: string;
    cta: string;
    manual: string;
    manualKnowledge: string;
    manualInstall: string;
  };
  onboarding: {
    backToDashboard: string;
    title: string;
    subtitle: string;
  };
  gate: {
    beforeFirstCall: string;
    step1Title: string;
    step1Body: string;
    step1Installed: string;
    download: (version: string) => string;
    installGuide: string;
    checkAgain: string;
    step2Title: string;
    step2Body: string;
    step2Waiting: string;
    connect: string;
    connectErrorSuffix: string;
    step3Title: string;
    step3Body: string;
    skip: string;
    connectedBanner: (version: string) => string;
  };
}

const en: Dict = {
  nav: {
    dashboard: 'Dashboard',
    playbooks: 'Playbooks',
    meetings: 'Meetings',
    settings: 'Settings',
    installExtension: 'Install extension',
  },
  banner: {
    welcome: (workspace) => `Welcome to ${workspace}`,
    title: 'Get to your first coached call',
    step1Title: 'Install the Chrome extension',
    step1Body: '— it joins your Google Meet calls and powers the live coach.',
    step2Title: 'Connect it',
    step2Body: '— one click, signs the extension into this workspace.',
    step3Title: 'Build your playbook',
    step3Body: '— a few questions become your canvas, script, and objection handling.',
    cta: 'Start setup (~5 minutes)',
    manual: 'Prefer manual setup?',
    manualKnowledge: 'Upload docs on Knowledge',
    manualInstall: 'install guide',
  },
  onboarding: {
    backToDashboard: 'Dashboard',
    title: 'Get set up',
    subtitle:
      'Three steps: install the Chrome extension, connect it to this workspace, then answer a few questions about your business. We turn them into your Business Model Canvas, your probing + pitching script, and your objection handling — so the live coach is ready on your very first call.',
  },
  gate: {
    beforeFirstCall: 'Before your first call',
    step1Title: 'Install the Chrome extension',
    step1Body:
      'The extension joins your Google Meet calls and powers the live coach. Without it, nothing you set up below reaches your calls.',
    step1Installed: 'Installed ✓',
    download: (version) => `Download extension (v${version})`,
    installGuide: 'Step-by-step install guide ↗',
    checkAgain: "I've installed it — check again",
    step2Title: 'Connect it to your workspace',
    step2Body: 'One click — signs the extension into this workspace. No codes to copy.',
    step2Waiting: 'Waiting for step 1.',
    connect: 'Connect extension',
    connectErrorSuffix: 'try the pairing-code flow',
    step3Title: 'Build your playbook (guided setup)',
    step3Body:
      "Unlocks when the extension is connected. We'll build your Business Model Canvas, sales script, and objection handling.",
    skip: 'Skip for now — set up the extension later',
    connectedBanner: (version) =>
      `Chrome extension installed & connected (v${version}) — the live coach will join your calls.`,
  },
};

const fr: Dict = {
  nav: {
    dashboard: 'Tableau de bord',
    playbooks: 'Playbooks',
    meetings: 'Réunions',
    settings: 'Paramètres',
    installExtension: "Installer l'extension",
  },
  banner: {
    welcome: (workspace) => `Bienvenue sur ${workspace}`,
    title: 'Préparez votre premier appel coaché',
    step1Title: "Installez l'extension Chrome",
    step1Body: '— elle rejoint vos appels Google Meet et alimente le coach en direct.',
    step2Title: 'Connectez-la',
    step2Body: "— un clic, et l'extension est connectée à cet espace de travail.",
    step3Title: 'Construisez votre playbook',
    step3Body:
      '— quelques questions deviennent votre canvas, votre script et votre traitement des objections.',
    cta: 'Démarrer la configuration (~5 minutes)',
    manual: 'Vous préférez une configuration manuelle ?',
    manualKnowledge: 'Téléversez vos documents dans Knowledge',
    manualInstall: "guide d'installation",
  },
  onboarding: {
    backToDashboard: 'Tableau de bord',
    title: 'Configuration',
    subtitle:
      "Trois étapes : installez l'extension Chrome, connectez-la à cet espace de travail, puis répondez à quelques questions sur votre activité. Nous les transformons en Business Model Canvas, en script de découverte + pitch et en traitement des objections — pour que le coach en direct soit prêt dès votre tout premier appel.",
  },
  gate: {
    beforeFirstCall: 'Avant votre premier appel',
    step1Title: "Installez l'extension Chrome",
    step1Body:
      "L'extension rejoint vos appels Google Meet et alimente le coach en direct. Sans elle, rien de ce que vous configurez ci-dessous n'atteint vos appels.",
    step1Installed: 'Installée ✓',
    download: (version) => `Télécharger l'extension (v${version})`,
    installGuide: "Guide d'installation pas à pas ↗",
    checkAgain: "Je l'ai installée — vérifier à nouveau",
    step2Title: 'Connectez-la à votre espace de travail',
    step2Body: "Un clic — l'extension se connecte à cet espace. Aucun code à copier.",
    step2Waiting: "En attente de l'étape 1.",
    connect: "Connecter l'extension",
    connectErrorSuffix: 'essayez le code de jumelage',
    step3Title: 'Construisez votre playbook (configuration guidée)',
    step3Body:
      "Se débloque une fois l'extension connectée. Nous construirons votre Business Model Canvas, votre script de vente et votre traitement des objections.",
    skip: "Passer pour l'instant — configurer l'extension plus tard",
    connectedBanner: (version) =>
      `Extension Chrome installée et connectée (v${version}) — le coach en direct rejoindra vos appels.`,
  },
};

export const dictionaries: Record<Locale, Dict> = { en, fr };

export function isLocale(v: string | undefined | null): v is Locale {
  return v === 'en' || v === 'fr';
}
