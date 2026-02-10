import { useMemo } from 'react';

interface GraphNode {
  id: string;
  label: string;
  kind: 'session' | 'status';
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

function clampLabel(label: string, max = 20): string {
  if (label.length <= max) return label;
  return `${label.slice(0, Math.max(0, max - 3))}...`;
}

/**
 * GraphCanvas - Lightweight SVG renderer (code-split).
 *
 * This intentionally does not rely on heavy graph/flow libraries so the docs
 * site can keep bundles small while still demonstrating interactivity.
 */
export default function GraphCanvas({ nodes, edges, selectedNodeId, onSelectNode }: GraphCanvasProps) {
  const { positioned, width, height, edgeLines } = useMemo(() => {
    const statuses = nodes.filter((n) => n.kind === 'status').sort((a, b) => a.label.localeCompare(b.label));
    const sessions = nodes.filter((n) => n.kind === 'session');

    const statusX = 90;
    const sessionX = 340;
    const paddingY = 40;
    const statusGap = 54;
    const sessionGapY = 44;
    const sessionCols = 2;
    const sessionColGap = 260;

    const positionedNodes: PositionedNode[] = [];

    statuses.forEach((n, i) => {
      positionedNodes.push({ ...n, x: statusX, y: paddingY + i * statusGap });
    });

    sessions.forEach((n, i) => {
      const col = i % sessionCols;
      const row = Math.floor(i / sessionCols);
      positionedNodes.push({
        ...n,
        x: sessionX + col * sessionColGap,
        y: paddingY + row * sessionGapY,
      });
    });

    const nodeById = new Map(positionedNodes.map((n) => [n.id, n]));
    const lines = edges
      .map((e) => {
        const from = nodeById.get(e.from);
        const to = nodeById.get(e.to);
        if (!from || !to) return null;
        return {
          id: e.id,
          x1: from.x - 10,
          y1: from.y,
          x2: to.x + 120,
          y2: to.y,
        };
      })
      .filter(Boolean) as Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;

    const maxY = Math.max(...positionedNodes.map((n) => n.y), paddingY);
    const computedHeight = maxY + 60;
    const computedWidth = sessionX + sessionColGap * Math.max(1, sessionCols - 1) + 260;

    return { positioned: positionedNodes, width: computedWidth, height: computedHeight, edgeLines: lines };
  }, [edges, nodes]);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        role="img"
        aria-label="Session graph"
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[720px] h-[340px] bg-background rounded-md border border-border"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Edges */}
        <g className="text-border">
          {edgeLines.map((l) => (
            <path
              key={l.id}
              d={`M ${l.x1} ${l.y1} C ${l.x1 - 80} ${l.y1}, ${l.x2 + 80} ${l.y2}, ${l.x2} ${l.y2}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              markerEnd="url(#arrow)"
              opacity={0.7}
            />
          ))}
        </g>

        {/* Nodes */}
        {positioned.map((n) => {
          const isSelected = n.id === selectedNodeId;
          const isStatus = n.kind === 'status';
          const w = isStatus ? 160 : 240;
          const h = 30;
          const x = n.x - w / 2;
          const y = n.y - h / 2;

          return (
            <g
              key={n.id}
              onClick={() => onSelectNode(n.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={8}
                fill={isSelected ? 'oklch(var(--primary) / 0.10)' : 'oklch(var(--muted) / 0.40)'}
                stroke={isSelected ? 'oklch(var(--primary) / 1)' : 'oklch(var(--border) / 1)'}
                strokeWidth={isSelected ? 1.5 : 1}
              />
              <text
                x={n.x}
                y={n.y + 4}
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
                className={isStatus ? 'text-muted-foreground' : 'text-foreground'}
              >
                {clampLabel(n.label, isStatus ? 18 : 24)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Rendered as SVG for docs performance. The full CCW dashboard uses richer graph tooling.
      </div>
    </div>
  );
}
