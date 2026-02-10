import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeToggleProps {
  locale?: 'en' | 'zh';
}

const STORAGE_KEY = 'theme';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function safeGetStoredThemeMode(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

function safeSetStoredThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore write failures (e.g. privacy mode / disabled storage).
  }
}

declare global {
  interface Window {
    __getThemeMode?: () => ThemeMode;
    __setThemeMode?: (mode: ThemeMode) => void;
  }
}

export default function ThemeToggle({ locale = 'en' }: ThemeToggleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>('system');
  const containerRef = useRef<HTMLDivElement>(null);

  const labels = useMemo(() => {
    return locale === 'zh'
      ? {
          toggle: '主题设置',
          light: '浅色',
          dark: '深色',
          system: '跟随系统',
        }
      : {
          toggle: 'Theme',
          light: 'Light',
          dark: 'Dark',
          system: 'System',
        };
  }, [locale]);

  useEffect(() => {
    // Prefer the global helpers defined in BaseLayout (early script) to avoid
    // mismatches between initialization and the island hydration.
    const initial =
      (typeof window.__getThemeMode === 'function' && window.__getThemeMode()) ||
      safeGetStoredThemeMode() ||
      'system';

    setMode(initial);
  }, []);

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ mode?: ThemeMode }>;
      if (customEvent.detail?.mode && isThemeMode(customEvent.detail.mode)) {
        setMode(customEvent.detail.mode);
      }
    };

    window.addEventListener('theme-change', handleThemeChange);
    return () => window.removeEventListener('theme-change', handleThemeChange);
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!isOpen) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (!containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const setThemeMode = (nextMode: ThemeMode) => {
    setIsOpen(false);
    setMode(nextMode);

    if (typeof window.__setThemeMode === 'function') {
      window.__setThemeMode(nextMode);
      return;
    }

    // Fallback behavior if BaseLayout script is not present for some reason.
    // Keep it deliberately boring: compute effective theme and set both the
    // data attribute and the `.dark` class.
    safeSetStoredThemeMode(nextMode);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const effective = nextMode === 'system' ? (prefersDark ? 'dark' : 'light') : nextMode;
    const root = document.documentElement;

    if (effective === 'dark') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.removeAttribute('data-theme');
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  };

  const icon =
    mode === 'light' ? (
      <Sun className="w-5 h-5" />
    ) : mode === 'dark' ? (
      <Moon className="w-5 h-5" />
    ) : (
      <Monitor className="w-5 h-5" />
    );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={labels.toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="p-2 hover:bg-muted rounded-md transition-colors"
        onClick={() => setIsOpen((v) => !v)}
      >
        {icon}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={labels.toggle}
          className="absolute right-0 mt-2 w-40 bg-background border border-border rounded-md shadow-lg overflow-hidden z-50"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={mode === 'light'}
            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={() => setThemeMode('light')}
          >
            <span className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-muted-foreground" />
              {labels.light}
            </span>
            {mode === 'light' && <Check className="w-4 h-4" />}
          </button>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={mode === 'dark'}
            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={() => setThemeMode('dark')}
          >
            <span className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-muted-foreground" />
              {labels.dark}
            </span>
            {mode === 'dark' && <Check className="w-4 h-4" />}
          </button>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={mode === 'system'}
            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted transition-colors"
            onClick={() => setThemeMode('system')}
          >
            <span className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-muted-foreground" />
              {labels.system}
            </span>
            {mode === 'system' && <Check className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
