export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

export interface TocItem extends TocHeading {
  children: TocItem[];
}

export interface BuildTocTreeOptions {
  headings: readonly TocHeading[];
  /** Minimum heading depth to include (default: 2). */
  minDepth?: number;
  /** Maximum heading depth to include (default: 4). */
  maxDepth?: number;
}

function isValidHeading(value: TocHeading): boolean {
  return (
    typeof value.depth === 'number' &&
    Number.isFinite(value.depth) &&
    typeof value.slug === 'string' &&
    value.slug.length > 0 &&
    typeof value.text === 'string' &&
    value.text.length > 0
  );
}

/**
 * Build a nested table-of-contents tree from a flat list of Markdown headings.
 *
 * The returned structure is suitable for rendering as nested `<ul>` lists.
 * This function is intentionally framework-agnostic so it can be unit-tested.
 */
export function buildTocTree(options: BuildTocTreeOptions): TocItem[] {
  const minDepth = options.minDepth ?? 2;
  const maxDepth = options.maxDepth ?? 4;

  const filtered = options.headings
    .filter(isValidHeading)
    .filter((heading) => heading.depth >= minDepth && heading.depth <= maxDepth);

  const root: TocItem = { depth: minDepth - 1, slug: '__root__', text: '__root__', children: [] };
  const stack: TocItem[] = [root];

  for (const heading of filtered) {
    const item: TocItem = { ...heading, children: [] };

    // Find closest parent whose depth is lower than current heading.
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= item.depth) {
      stack.pop();
    }

    const parent = stack[stack.length - 1] ?? root;
    parent.children.push(item);
    stack.push(item);
  }

  return root.children;
}

