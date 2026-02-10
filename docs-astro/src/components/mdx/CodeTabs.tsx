import { useEffect, useRef, useState } from 'react';

interface CodeTab {
  label: string;
  language: string;
  code: string;
}

interface CodeTabsProps {
  tabs: CodeTab[];
  group?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', 'true');

    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function getStorageKey(group: string): string {
  return `ccw:codetab-pref:${group}`;
}

function readPreference(group: string | undefined): number {
  if (!group) return 0;
  try {
    const stored = localStorage.getItem(getStorageKey(group));
    if (stored !== null) {
      const index = parseInt(stored, 10);
      if (!Number.isNaN(index) && index >= 0) return index;
    }
  } catch {
    // localStorage unavailable (SSR, private browsing, etc.)
  }
  return 0;
}

function writePreference(group: string | undefined, index: number): void {
  if (!group) return;
  try {
    localStorage.setItem(getStorageKey(group), String(index));
  } catch {
    // Ignore write failures.
  }
}

const tabIdPrefix = 'codetab';
let instanceCounter = 0;

export default function CodeTabs({ tabs, group }: CodeTabsProps) {
  const [instanceId] = useState(() => ++instanceCounter);
  const [activeTab, setActiveTab] = useState(() => {
    const pref = readPreference(group);
    return pref < tabs.length ? pref : 0;
  });
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Listen for cross-component sync via storage events
  useEffect(() => {
    if (!group) return;

    function onStorage(e: StorageEvent) {
      if (e.key !== getStorageKey(group!)) return;
      if (e.newValue === null) return;
      const index = parseInt(e.newValue, 10);
      if (!Number.isNaN(index) && index >= 0 && index < tabs.length) {
        setActiveTab(index);
      }
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [group, tabs.length]);

  const selectTab = (index: number) => {
    setActiveTab(index);
    writePreference(group, index);
    setCopied(false);
  };

  const handleCopy = async () => {
    const code = tabs[activeTab]?.code;
    if (!code) return;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const ok = await copyToClipboard(code);
    setCopied(ok);

    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, 2000);
  };

  const baseId = `${tabIdPrefix}-${instanceId}`;

  const activeCode = tabs[activeTab]?.code ?? '';
  const lines = activeCode.split('\n');
  // Remove trailing empty line from a final newline
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return (
    <div className="my-4 rounded-lg border border-border overflow-hidden">
      {/* Tab header */}
      <div className="flex items-center justify-between bg-muted border-b border-border">
        <div role="tablist" aria-label="Code examples" className="flex">
          {tabs.map((tab, index) => {
            const tabId = `${baseId}-tab-${index}`;
            const panelId = `${baseId}-panel-${index}`;
            const isActive = activeTab === index;

            return (
              <button
                key={index}
                id={tabId}
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(index)}
                onKeyDown={(e) => {
                  let next = -1;
                  if (e.key === 'ArrowRight') {
                    next = (index + 1) % tabs.length;
                  } else if (e.key === 'ArrowLeft') {
                    next = (index - 1 + tabs.length) % tabs.length;
                  } else if (e.key === 'Home') {
                    next = 0;
                  } else if (e.key === 'End') {
                    next = tabs.length - 1;
                  }
                  if (next >= 0) {
                    e.preventDefault();
                    selectTab(next);
                    const nextEl = document.getElementById(`${baseId}-tab-${next}`);
                    nextEl?.focus();
                  }
                }}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  isActive
                    ? 'border-primary text-primary bg-background'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="mr-2 inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Copy code"
          aria-live="polite"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Tab panels */}
      {tabs.map((tab, index) => {
        const tabId = `${baseId}-tab-${index}`;
        const panelId = `${baseId}-panel-${index}`;
        const isActive = activeTab === index;

        if (!isActive) return null;

        const panelLines = tab.code.split('\n');
        if (panelLines.length > 1 && panelLines[panelLines.length - 1] === '') {
          panelLines.pop();
        }

        return (
          <div
            key={index}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            tabIndex={0}
            className="bg-background"
          >
            <pre className="overflow-x-auto p-4 text-sm leading-relaxed codetabs-lines">
              <code className={`language-${tab.language}`}>
                {panelLines.map((line, lineIndex) => (
                  <span key={lineIndex} className="codetabs-line">
                    {line}
                    {lineIndex < panelLines.length - 1 ? '\n' : ''}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        );
      })}
    </div>
  );
}
