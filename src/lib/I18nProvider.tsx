import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const localeMap = {
  'zh-TW': () => import('@/locales/zh-TW.json'),
  'zh-CN': () => import('@/locales/zh-CN.json'),
  en: () => import('@/locales/en.json'),
};

function detectDefaultLocale(): Locale {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('locale');
    if (saved && (saved === 'zh-TW' || saved === 'zh-CN' || saved === 'en')) return saved as Locale;
    const navLang = navigator.language || navigator.languages?.[0] || '';
    if (navLang.startsWith('zh-TW')) return 'zh-TW';
    if (navLang.startsWith('zh-CN') || navLang === 'zh') return 'zh-CN';
    if (navLang.startsWith('en')) return 'en';
  }
  return 'zh-CN'; // fallback
}

export type Locale = keyof typeof localeMap;

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'zh-TW',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== 'undefined') {
      return detectDefaultLocale();
    }
    return 'zh-CN';
  });
  const [messages, setMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    localeMap[locale]().then((mod) => setMessages(mod.default || mod));
  }, [locale]);

  // 實際 setLocale，會寫入 localStorage
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    if (typeof window !== 'undefined') {
      localStorage.setItem('locale', l);
    }
  };

  function t(key: string) {
    return messages[key] || key;
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
} 