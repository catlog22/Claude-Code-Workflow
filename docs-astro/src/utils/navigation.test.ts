import { describe, expect, it } from 'vitest';

import { buildBreadcrumbs, buildNavigationTree, normalizePath } from './navigation';
import type { NavigationSourceEntry } from './navigation';

function entry(id: string, data: NavigationSourceEntry['data']): NavigationSourceEntry {
  return { id, data };
}

describe('navigation utils', () => {
  it('normalizePath enforces trailing slash and strips hash/query', () => {
    expect(normalizePath('/en/docs')).toBe('/en/docs/');
    expect(normalizePath('/en/docs/')).toBe('/en/docs/');
    expect(normalizePath('/en/docs?a=1#x')).toBe('/en/docs/');
    expect(normalizePath('/')).toBe('/');
  });

  it('buildNavigationTree builds a strict category -> section -> page hierarchy', () => {
    const entries: NavigationSourceEntry[] = [
      entry('en/workflows/4-level-system.mdx', {
        title: '4-Level System',
        category: 'workflows',
        locale: 'en',
        order: 1,
      }),
      entry('en/workflows/4-level-system/level-1.mdx', {
        title: 'Level 1',
        category: 'workflows',
        locale: 'en',
        order: 2,
      }),
      entry('en/workflows/4-level-system/level-2.mdx', {
        title: 'Level 2',
        category: 'workflows',
        locale: 'en',
        order: 3,
      }),
      entry('en/getting-started/index.mdx', {
        title: 'Getting Started',
        category: 'getting-started',
        locale: 'en',
        order: 1,
      }),
      entry('zh/workflows/4-level-system.mdx', {
        title: '4级系统',
        category: 'workflows',
        locale: 'zh',
        order: 1,
      }),
    ];

    const tree = buildNavigationTree({
      entries,
      locale: 'en',
      basePath: '/en/docs',
    });

    const workflows = tree.find((c) => c.key === 'workflows');
    expect(workflows).toBeTruthy();
    expect(workflows?.sections).toHaveLength(1);
    expect(workflows?.sections[0]?.title).toBe('4-Level System');
    expect(workflows?.sections[0]?.href).toBe('/en/docs/workflows/4-level-system/');
    expect(workflows?.sections[0]?.pages.map((p) => p.title)).toEqual(['Level 1', 'Level 2']);
    expect(workflows?.sections[0]?.pages[0]?.href).toBe('/en/docs/workflows/4-level-system/level-1/');

    const gettingStarted = tree.find((c) => c.key === 'getting-started');
    expect(gettingStarted?.sections).toHaveLength(1);
    expect(gettingStarted?.sections[0]?.key).toBe('index');
    expect(gettingStarted?.sections[0]?.href).toBe('/en/docs/getting-started/index/');
  });

  it('buildBreadcrumbs collapses category/index into a single crumb', () => {
    const entries: NavigationSourceEntry[] = [
      entry('en/getting-started/index.mdx', {
        title: 'Getting Started',
        category: 'getting-started',
        locale: 'en',
        order: 1,
      }),
    ];

    const tree = buildNavigationTree({ entries, locale: 'en', basePath: '/en/docs' });
    const crumbs = buildBreadcrumbs({ tree, currentPath: '/en/docs/getting-started/index' });

    expect(crumbs).toEqual([
      { title: 'Getting Started', current: true },
    ]);
  });

  it('buildBreadcrumbs returns category -> section -> page for nested pages', () => {
    const entries: NavigationSourceEntry[] = [
      entry('en/workflows/4-level-system.mdx', {
        title: '4-Level System',
        category: 'workflows',
        locale: 'en',
      }),
      entry('en/workflows/4-level-system/level-1.mdx', {
        title: 'Level 1',
        category: 'workflows',
        locale: 'en',
      }),
    ];

    const tree = buildNavigationTree({ entries, locale: 'en', basePath: '/en/docs' });
    const crumbs = buildBreadcrumbs({ tree, currentPath: '/en/docs/workflows/4-level-system/level-1/' });

    expect(crumbs).toEqual([
      { title: 'Workflows' },
      { title: '4-Level System', href: '/en/docs/workflows/4-level-system/' },
      { title: 'Level 1', current: true },
    ]);
  });
});
