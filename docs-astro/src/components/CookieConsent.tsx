import { useEffect, useMemo, useState } from 'react';

type AnalyticsConsent = 'accepted' | 'declined';

interface CookieConsentProps {
  locale?: 'en' | 'zh';
}

const STORAGE_KEY = 'analytics-consent';

function isAnalyticsConsent(value: unknown): value is AnalyticsConsent {
  return value === 'accepted' || value === 'declined';
}

function safeGetStoredConsent(): AnalyticsConsent | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isAnalyticsConsent(value) ? value : null;
  } catch {
    return null;
  }
}

function safeSetStoredConsent(value: AnalyticsConsent) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Ignore persistence failures (e.g. privacy mode / disabled storage).
  }
}

declare global {
  interface Window {
    __getAnalyticsConsent?: () => AnalyticsConsent | null;
    __setAnalyticsConsent?: (consent: AnalyticsConsent) => void;
    __ensurePlausibleLoaded?: () => void;
  }
}

export default function CookieConsent({ locale = 'en' }: CookieConsentProps) {
  const [isVisible, setIsVisible] = useState(false);

  const copy = useMemo(() => {
    return locale === 'zh'
      ? {
          title: '隐私友好统计',
          description:
            '我们使用 Plausible（无 Cookie）来了解哪些页面最常被访问。你可以选择接受或拒绝统计。',
          accept: '接受',
          decline: '拒绝',
        }
      : {
          title: 'Privacy-friendly analytics',
          description:
            'We use Plausible (cookie-less) to understand which docs are most useful. You can accept or decline analytics.',
          accept: 'Accept',
          decline: 'Decline',
        };
  }, [locale]);

  useEffect(() => {
    const stored = safeGetStoredConsent();
    const helperConsent =
      typeof window.__getAnalyticsConsent === 'function' ? window.__getAnalyticsConsent() : null;

    const existing = stored ?? (isAnalyticsConsent(helperConsent) ? helperConsent : null);
    setIsVisible(existing === null);
  }, []);

  const handleChoice = (choice: AnalyticsConsent) => {
    safeSetStoredConsent(choice);

    if (typeof window.__setAnalyticsConsent === 'function') {
      window.__setAnalyticsConsent(choice);
    } else if (choice === 'accepted' && typeof window.__ensurePlausibleLoaded === 'function') {
      // Defensive fallback: BaseLayout should provide `__setAnalyticsConsent`, but if it doesn't,
      // we still try to enable analytics immediately after acceptance.
      window.__ensurePlausibleLoaded();
    }

    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{copy.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0">
          <button
            type="button"
            className="px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors motion-reduce:transition-none"
            onClick={() => handleChoice('declined')}
          >
            {copy.decline}
          </button>
          <button
            type="button"
            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity motion-reduce:transition-none"
            onClick={() => handleChoice('accepted')}
          >
            {copy.accept}
          </button>
        </div>
      </div>
    </div>
  );
}

