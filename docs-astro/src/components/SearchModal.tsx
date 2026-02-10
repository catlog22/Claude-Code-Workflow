import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface SearchModalProps {
  locale: 'en' | 'zh';
}

const RECENT_SEARCHES_KEY = 'ccw:recent-searches';
const MAX_RECENT_SEARCHES = 5;

type CategoryFilter = 'all' | 'getting-started' | 'workflows' | 'cli-commands' | 'dashboard';

const CATEGORY_LABELS: Record<CategoryFilter, { en: string; zh: string }> = {
  'all': { en: 'All', zh: '全部' },
  'getting-started': { en: 'Getting Started', zh: '快速开始' },
  'workflows': { en: 'Workflows', zh: '工作流' },
  'cli-commands': { en: 'CLI Commands', zh: 'CLI 命令' },
  'dashboard': { en: 'Dashboard', zh: '仪表盘' },
};

const QUICK_SUGGESTIONS: Array<{ en: string; zh: string }> = [
  { en: 'getting started', zh: '快速开始' },
  { en: 'workflow', zh: '工作流' },
  { en: 'cli commands', zh: 'CLI 命令' },
  { en: 'dashboard', zh: '仪表盘' },
  { en: 'configuration', zh: '配置' },
  { en: 'troubleshooting', zh: '故障排除' },
];

function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT_SEARCHES);
  } catch {
    // Ignore parse errors
  }
  return [];
}

function saveRecentSearch(term: string): void {
  const trimmed = term.trim();
  if (!trimmed) return;
  try {
    const existing = getRecentSearches();
    const filtered = existing.filter((s) => s !== trimmed);
    const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Ignore storage errors
  }
}

export default function SearchModal({ locale }: SearchModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const pagefindUIRef = useRef<any>(null);
  const inputObserverRef = useRef<MutationObserver | null>(null);

  const showSuggestions = isLoaded && !searchQuery;

  // Load recent searches when modal opens
  useEffect(() => {
    if (isOpen) {
      setRecentSearches(getRecentSearches());
    }
  }, [isOpen]);

  // Track search input value via DOM observation (PagefindUI owns the input)
  useEffect(() => {
    if (!isLoaded || !searchContainerRef.current) return;

    const input = searchContainerRef.current.querySelector<HTMLInputElement>('input');
    if (!input) return;

    const syncValue = () => setSearchQuery(input.value);

    input.addEventListener('input', syncValue);
    input.addEventListener('change', syncValue);

    // Also observe attribute changes (Pagefind may set value programmatically)
    const observer = new MutationObserver(syncValue);
    observer.observe(input, { attributes: true, attributeFilter: ['value'] });
    inputObserverRef.current = observer;

    return () => {
      input.removeEventListener('input', syncValue);
      input.removeEventListener('change', syncValue);
      observer.disconnect();
      inputObserverRef.current = null;
    };
  }, [isLoaded]);

  // Apply category filter by hiding/showing results based on URL path
  useEffect(() => {
    if (!isLoaded || !searchContainerRef.current) return;

    const container = searchContainerRef.current;
    const results = container.querySelectorAll<HTMLElement>('.pagefind-ui__result');

    results.forEach((result) => {
      if (activeFilter === 'all') {
        result.style.display = '';
        return;
      }

      const link = result.querySelector<HTMLAnchorElement>('a');
      const href = link?.getAttribute('href') || '';
      const matchesFilter = href.includes(`/${activeFilter}/`);
      result.style.display = matchesFilter ? '' : 'none';
    });
  }, [activeFilter, isLoaded, searchQuery]);

  // Also re-apply filter when Pagefind renders new results
  useEffect(() => {
    if (!isLoaded || !searchContainerRef.current || activeFilter === 'all') return;

    const container = searchContainerRef.current;
    const resultsArea = container.querySelector('.pagefind-ui__results-area');
    if (!resultsArea) return;

    const observer = new MutationObserver(() => {
      const results = container.querySelectorAll<HTMLElement>('.pagefind-ui__result');
      results.forEach((result) => {
        const link = result.querySelector<HTMLAnchorElement>('a');
        const href = link?.getAttribute('href') || '';
        const matchesFilter = href.includes(`/${activeFilter}/`);
        result.style.display = matchesFilter ? '' : 'none';
      });
    });

    observer.observe(resultsArea, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeFilter, isLoaded]);

  const triggerSearch = useCallback((term: string) => {
    if (!searchContainerRef.current) return;
    const input = searchContainerRef.current.querySelector<HTMLInputElement>('input');
    if (!input) return;

    // Set value and dispatch events so PagefindUI picks it up
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, term);
    } else {
      input.value = term;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    setSearchQuery(term);

    // Save to recent searches
    saveRecentSearch(term);
    setRecentSearches(getRecentSearches());
  }, []);

  const handleClearHistory = useCallback(() => {
    clearRecentSearches();
    setRecentSearches([]);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    const handleToggleSearch = () => {
      setIsOpen(prev => !prev);
    };

    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-search', handleToggleSearch);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-search', handleToggleSearch);
    };
  }, [isOpen]);

  useEffect(() => {
    const loadPagefind = async () => {
      if (isOpen && !isLoaded && searchContainerRef.current) {
        try {
          const { PagefindUI } = await import('@pagefind/default-ui');

          pagefindUIRef.current = new PagefindUI({
            element: searchContainerRef.current,
            showSubResults: true,
            showImages: false,
            excerptLength: 30,
            resetStyles: false,
            translations: locale === 'zh' ? {
              placeholder: '搜索文档...',
              clear_search: '清除',
              load_more: '加载更多结果',
              search_label: '搜索',
              filters_label: '筛选',
              zero_results: '未找到 [SEARCH_TERM] 的结果',
              many_results: '找到 [COUNT] 个结果',
              one_result: '找到 [COUNT] 个结果',
              alt_search: '未找到 [SEARCH_TERM] 的结果。显示 [DIFFERENT_TERM] 的结果:',
              search_suggestion: '未找到 [SEARCH_TERM] 的结果。尝试以下搜索:',
              searching: '搜索中...'
            } : {
              placeholder: 'Search documentation...',
              clear_search: 'Clear',
              load_more: 'Load more results',
              search_label: 'Search',
              filters_label: 'Filters',
              zero_results: 'No results for [SEARCH_TERM]',
              many_results: '[COUNT] results for [SEARCH_TERM]',
              one_result: '[COUNT] result for [SEARCH_TERM]',
              alt_search: 'No results for [SEARCH_TERM]. Showing results for [DIFFERENT_TERM] instead',
              search_suggestion: 'No results for [SEARCH_TERM]. Try one of the following searches:',
              searching: 'Searching...'
            }
          });

          setIsLoaded(true);

          setTimeout(() => {
            const input = searchContainerRef.current?.querySelector<HTMLInputElement>('input');
            if (input) {
              // Used by BaseLayout's global analytics delegation.
              input.setAttribute('data-plausible-event', 'search');
            }
            input?.focus();
          }, 100);
        } catch (error) {
          console.error('Failed to load Pagefind:', error);
        }
      }
    };

    loadPagefind();
  }, [isOpen, isLoaded, locale]);

  // Save search term to recent when user stops typing (debounced)
  useEffect(() => {
    if (!searchQuery) return;
    const timeout = setTimeout(() => {
      saveRecentSearch(searchQuery);
      setRecentSearches(getRecentSearches());
    }, 1500);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      <div className="fixed inset-x-4 top-20 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-2xl sm:w-full z-50">
        <div className="bg-background border border-border rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-sm font-medium text-muted-foreground">
                {locale === 'zh' ? '搜索文档' : 'Search Documentation'}
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-muted rounded transition-colors"
              aria-label={locale === 'zh' ? '关闭搜索' : 'Close search'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Category filter chips */}
          {isLoaded && (
            <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-wrap">
              {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                    activeFilter === key
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {locale === 'zh' ? CATEGORY_LABELS[key].zh : CATEGORY_LABELS[key].en}
                </button>
              ))}
            </div>
          )}

          <div
            ref={searchContainerRef}
            className="pagefind-ui-container max-h-[60vh] overflow-y-auto"
          />

          {/* Quick suggestions and recent searches (shown when input is empty) */}
          {showSuggestions && (
            <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
              {/* Quick suggestions */}
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {locale === 'zh' ? '热门搜索' : 'Popular searches'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SUGGESTIONS.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => triggerSearch(locale === 'zh' ? suggestion.zh : suggestion.en)}
                      className="px-3 py-1.5 text-sm bg-muted/50 text-foreground border border-border rounded-md hover:bg-muted hover:border-muted-foreground/30 transition-colors"
                    >
                      {locale === 'zh' ? suggestion.zh : suggestion.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent searches */}
              {recentSearches.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {locale === 'zh' ? '最近搜索' : 'Recent searches'}
                    </p>
                    <button
                      onClick={handleClearHistory}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {locale === 'zh' ? '清除历史' : 'Clear history'}
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {recentSearches.map((term, i) => (
                      <button
                        key={i}
                        onClick={() => triggerSearch(term)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground rounded-md hover:bg-muted transition-colors text-left"
                      >
                        <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isLoaded && (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <div className="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full" />
              <p className="mt-2 text-sm">
                {locale === 'zh' ? '加载搜索...' : 'Loading search...'}
              </p>
            </div>
          )}

          <div className="px-4 py-2 border-t border-border bg-muted/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">↑↓</kbd>
                  {locale === 'zh' ? '导航' : 'Navigate'}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">↵</kbd>
                  {locale === 'zh' ? '选择' : 'Select'}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">esc</kbd>
                  {locale === 'zh' ? '关闭' : 'Close'}
                </span>
              </div>
              <span>
                {locale === 'zh' ? 'Pagefind 支持' : 'Powered by Pagefind'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
