import { describe, expect, it } from 'vitest';

import { buildTocTree, type TocHeading } from './toc';

function h(depth: number, slug: string, text: string): TocHeading {
  return { depth, slug, text };
}

describe('toc utils', () => {
  it('filters headings to requested depth range (default: h2-h4)', () => {
    const tree = buildTocTree({
      headings: [
        h(1, 'title', 'Title'),
        h(2, 'a', 'A'),
        h(3, 'b', 'B'),
        h(4, 'c', 'C'),
        h(5, 'd', 'D'),
      ],
    });

    expect(tree.map((item) => item.slug)).toEqual(['a']);
    expect(tree[0]?.children.map((item) => item.slug)).toEqual(['b']);
    expect(tree[0]?.children[0]?.children.map((item) => item.slug)).toEqual(['c']);
  });

  it('nests headings using the closest lower depth parent', () => {
    const tree = buildTocTree({
      headings: [
        h(2, 'section-1', 'Section 1'),
        h(4, 'deep-1', 'Deep 1'),
        h(3, 'sub-1', 'Sub 1'),
        h(4, 'deep-2', 'Deep 2'),
        h(2, 'section-2', 'Section 2'),
      ],
    });

    expect(tree).toHaveLength(2);
    expect(tree[0]?.slug).toBe('section-1');

    // h4 immediately after h2 attaches to h2
    expect(tree[0]?.children.map((item) => item.slug)).toEqual(['deep-1', 'sub-1']);

    // subsequent h4 under h3 attaches to h3
    const sub1 = tree[0]?.children.find((item) => item.slug === 'sub-1');
    expect(sub1?.children.map((item) => item.slug)).toEqual(['deep-2']);
  });

  it('drops headings with missing slug/text', () => {
    const tree = buildTocTree({
      headings: [
        h(2, '', 'Missing slug'),
        h(2, 'ok', 'OK'),
        h(3, 'child', ''),
      ],
    });

    expect(tree.map((item) => item.slug)).toEqual(['ok']);
    expect(tree[0]?.children).toHaveLength(0);
  });

  it('respects custom depth range', () => {
    const tree = buildTocTree({
      headings: [h(2, 'a', 'A'), h(3, 'b', 'B'), h(4, 'c', 'C')],
      minDepth: 3,
      maxDepth: 3,
    });

    expect(tree.map((item) => item.slug)).toEqual(['b']);
  });
});

