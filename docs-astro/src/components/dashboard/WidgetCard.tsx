import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface WidgetCardProps {
  /**
   * Title shown in the widget header.
   *
   * Usage (Astro):
   * `<WidgetCard client:idle title="Widget Title">...</WidgetCard>`
   */
  title: string;
  /** Optional short description rendered under the title. */
  description?: string;
  /** Optional icon element rendered next to the title. */
  icon?: React.ReactNode;
  /** Optional actions rendered on the right side of the header. */
  actions?: React.ReactNode;
  /** Widget content. */
  children: React.ReactNode;
  /** Optional footer content rendered below the main content. */
  footer?: React.ReactNode;
  /** Extra classes for outer container. */
  className?: string;
  /**
   * If true, the widget can be collapsed/expanded.
   * Collapsing keeps the header visible and hides the content.
   */
  collapsible?: boolean;
  /** Initial collapsed state when `collapsible` is true. */
  defaultCollapsed?: boolean;
}

/**
 * WidgetCard - Dashboard-style card wrapper for React Islands.
 *
 * This is intentionally dependency-light (no design system imports) so
 * each island can reuse it without pulling in heavy UI libraries.
 */
export default function WidgetCard({
  title,
  description,
  icon,
  actions,
  children,
  footer,
  className,
  collapsible = false,
  defaultCollapsed = false,
}: WidgetCardProps) {
  const contentId = useId();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const headerButtonLabel = useMemo(() => {
    if (!collapsible) return undefined;
    return collapsed ? `Expand ${title}` : `Collapse ${title}`;
  }, [collapsed, collapsible, title]);

  const ToggleIcon = collapsed ? ChevronDown : ChevronUp;

  return (
    <section
      className={[
        'border border-border rounded-lg bg-background shadow-sm overflow-hidden',
        className || '',
      ].join(' ')}
    >
      <header className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-2">
            {icon ? (
              <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
              {description ? (
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {actions}
            {collapsible ? (
              <button
                type="button"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors"
                aria-controls={contentId}
                aria-expanded={!collapsed}
                aria-label={headerButtonLabel}
                onClick={() => setCollapsed(v => !v)}
              >
                <ToggleIcon className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div id={contentId} hidden={collapsible ? collapsed : false}>
        <div className="p-4">{children}</div>
        {footer ? <footer className="px-4 pb-4">{footer}</footer> : null}
      </div>
    </section>
  );
}

