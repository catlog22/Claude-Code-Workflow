export type Locale = 'en' | 'zh';

/**
 * Minimal shape we rely on from Astro content entries.
 * Intentionally not importing `CollectionEntry` so this module stays testable
 * without Astro runtime.
 */
export interface NavigationSourceEntry {
  id: string;
  data: {
    title: string;
    category: string;
    locale: Locale;
    order?: number;
  };
}

export interface NavigationPage {
  id: string;
  title: string;
  href: string;
  order: number;
}

export interface NavigationSection {
  id: string;
  key: string;
  title: string;
  href: string;
  order: number;
  pages: NavigationPage[];
}

export interface NavigationCategory {
  id: string;
  key: string;
  title: string;
  order: number;
  sections: NavigationSection[];
}

export type NavigationTree = NavigationCategory[];

export interface BreadcrumbItem {
  title: string;
  href?: string;
  current?: boolean;
}

const CATEGORY_ORDER: readonly string[] = [
  'getting-started',
  'workflows',
  'cli-commands',
  'dashboard',
  'architecture',
  'api',
  'troubleshooting',
];

const CATEGORY_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    'getting-started': 'Getting Started',
    workflows: 'Workflows',
    'cli-commands': 'CLI Reference',
    dashboard: 'Dashboard',
    architecture: 'Architecture',
    api: 'API',
    troubleshooting: 'Troubleshooting',
  },
  zh: {
    'getting-started': '快速开始',
    workflows: '工作流指南',
    'cli-commands': 'CLI 参考',
    dashboard: 'Dashboard 指南',
    architecture: '架构',
    api: 'API',
    troubleshooting: '故障排查',
  },
};

export function normalizePath(path: string): string {
  const base = path.split('#')[0]?.split('?')[0] ?? '/';
  if (base === '') return '/';
  if (base === '/') return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function joinUrlPath(...parts: string[]): string {
  const raw = parts
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return raw === '' ? '/' : `/${raw}/`;
}

function getCategoryOrder(categoryKey: string): number {
  const index = CATEGORY_ORDER.indexOf(categoryKey);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function getCategoryLabel(locale: Locale, categoryKey: string): string {
  return CATEGORY_LABELS[locale]?.[categoryKey] ?? categoryKey;
}

function getOrder(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : Number.POSITIVE_INFINITY;
}

function compareNavItems(a: { order: number; title: string }, b: { order: number; title: string }): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.title.localeCompare(b.title);
}

export interface BuildNavigationTreeOptions {
  entries: readonly NavigationSourceEntry[];
  locale: Locale;
  /**
   * Base prefix for doc routes, e.g. `/${locale}/docs`.
   * `buildNavigationTree` will always produce trailing-slash hrefs.
   */
  basePath: string;
}

/**
 * Build a strict 3-level navigation tree (category -> section -> page) from content entries.
 *
 * Rules:
 * - category key comes from `entry.data.category` when present; otherwise derived from `entry.id`.
 * - sections are derived from the 2nd path segment after locale.
 * - pages are any remaining path segments joined with `/` (so deeper nesting still fits 3 levels).
 */
export function buildNavigationTree(options: BuildNavigationTreeOptions): NavigationTree {
  const { entries, locale, basePath } = options;

  const categories = new Map<string, NavigationCategory>();
  const sectionsByCategory = new Map<string, Map<string, NavigationSection>>();

  for (const entry of entries) {
    if (entry.data.locale !== locale) continue;

    // entry.id format: "en/category/section/page.mdx"
    const parts = entry.id.split('/').filter(Boolean);
    const idLocale = parts[0];
    if (idLocale !== locale) continue;

    const pathSegments = parts
      .slice(1)
      .join('/')
      .replace(/\.mdx?$/i, '')
      .split('/')
      .filter(Boolean);

    const derivedCategoryKey = pathSegments[0];
    const categoryKey = entry.data.category || derivedCategoryKey;
    if (!categoryKey) continue;

    const categoryId = `category:${categoryKey}`;
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        id: categoryId,
        key: categoryKey,
        title: getCategoryLabel(locale, categoryKey),
        order: getCategoryOrder(categoryKey),
        sections: [],
      });
      sectionsByCategory.set(categoryKey, new Map());
    }

    const sectionKey = pathSegments[1] ?? 'index';
    const remainder = pathSegments.slice(2);
    const sectionId = `${categoryKey}/${sectionKey}`;

    const sectionMap = sectionsByCategory.get(categoryKey)!;
    if (!sectionMap.has(sectionKey)) {
      // Default title: derived from key (will be replaced when we find a section-level entry)
      sectionMap.set(sectionKey, {
        id: `section:${sectionId}`,
        key: sectionKey,
        title: sectionKey,
        href: joinUrlPath(basePath, categoryKey, sectionKey),
        order: Number.POSITIVE_INFINITY,
        pages: [],
      });
    }

    const section = sectionMap.get(sectionKey)!;

    if (remainder.length === 0) {
      // Section-level page (including `index` section nodes)
      section.title = entry.data.title;
      section.order = Math.min(section.order, getOrder(entry.data.order));
      section.href = joinUrlPath(basePath, categoryKey, sectionKey);
      continue;
    }

    const pageKey = remainder.join('/');
    const pageId = `${sectionId}/${pageKey}`;
    section.pages.push({
      id: `page:${pageId}`,
      title: entry.data.title,
      href: joinUrlPath(basePath, categoryKey, sectionKey, pageKey),
      order: getOrder(entry.data.order),
    });
  }

  // Materialize sections into their categories, sorted
  for (const [categoryKey, category] of categories) {
    const sectionMap = sectionsByCategory.get(categoryKey);
    if (!sectionMap) continue;
    const sections = Array.from(sectionMap.values())
      .map((section) => ({
        ...section,
        pages: section.pages.slice().sort(compareNavItems),
      }))
      .sort(compareNavItems);
    category.sections = sections;
  }

  return Array.from(categories.values()).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });
}

function isCurrentOrChild(href: string, currentPath: string): boolean {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);
  return current === target || current.startsWith(target);
}

export interface BuildBreadcrumbsOptions {
  tree: NavigationTree;
  currentPath: string;
}

/**
 * Breadcrumb rules:
 * - For `.../<category>/index/` pages, collapse `category -> index` into a single category crumb.
 * - For `.../<category>/<section>/index/` pages, collapse `page(index)` so breadcrumbs end at section.
 */
export function buildBreadcrumbs(options: BuildBreadcrumbsOptions): BreadcrumbItem[] {
  const current = normalizePath(options.currentPath);

  let bestMatch:
    | { category: NavigationCategory; section?: NavigationSection; page?: NavigationPage; depth: number }
    | undefined;

  for (const category of options.tree) {
    // Category is not directly navigable in our model, but we still consider matches within it.
    for (const section of category.sections) {
      const sectionMatch = normalizePath(section.href) === current;
      if (sectionMatch) {
        const depth = section.key === 'index' ? 1 : 2;
        if (!bestMatch || depth > bestMatch.depth) {
          bestMatch = { category, section, depth };
        }
      }

      for (const page of section.pages) {
        if (normalizePath(page.href) !== current) continue;
        const pageIsIndex = page.href.split('/').filter(Boolean).at(-1) === 'index';
        const depth = pageIsIndex ? 2 : 3;
        if (!bestMatch || depth > bestMatch.depth) {
          bestMatch = { category, section, page, depth };
        }
      }
    }
  }

  if (!bestMatch) return [];

  const crumbs: BreadcrumbItem[] = [];

  // Category crumb
  if (bestMatch.section?.key === 'index') {
    crumbs.push({
      title: bestMatch.category.title,
      href: bestMatch.section.href,
    });
    const only = crumbs[0];
    if (only) {
      only.current = true;
      delete only.href;
    }
    return crumbs;
  }

  crumbs.push({ title: bestMatch.category.title });

  if (bestMatch.section) {
    crumbs.push({
      title: bestMatch.section.title,
      href: bestMatch.section.href,
    });
  }

  if (bestMatch.page) {
    const pageKey = bestMatch.page.href.split('/').filter(Boolean).at(-1);
    if (pageKey !== 'index') {
      crumbs.push({
        title: bestMatch.page.title,
        href: bestMatch.page.href,
      });
    }
  }

  // Mark last crumb as current and strip its href
  const last = crumbs.at(-1);
  if (last) {
    last.current = true;
    delete last.href;
  }

  return crumbs;
}

export interface ActiveState {
  isActive: boolean;
  isWithin: boolean;
}

export function getActiveState(href: string, currentPath: string): ActiveState {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);
  return {
    isActive: current === target,
    isWithin: isCurrentOrChild(target, current),
  };
}
