import { useMemo } from 'react';

interface CodexLensConfigDraft {
  enabled: boolean;
  projectPath: string;
  indexDir: string;
  maxDepth: number;
}

export interface ConfigEditorProps {
  /**
   * Draft config used for docs previews.
   *
   * This intentionally does not perform any API mutations to keep the docs site
   * safe and dependency-light.
   */
  config: CodexLensConfigDraft;
  onChange: (next: CodexLensConfigDraft) => void;
}

export default function ConfigEditor({ config, onChange }: ConfigEditorProps) {
  const jsonPreview = useMemo(() => JSON.stringify(config, null, 2), [config]);

  return (
    <div className="border border-border rounded-lg bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Config Preview</h3>
          <p className="text-xs text-muted-foreground mt-1">
            This is a docs-only preview of key CodexLens settings.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
          />
          <span className="text-sm text-foreground">Enabled</span>
        </label>

        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Max Depth</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            type="number"
            min={1}
            max={10}
            value={config.maxDepth}
            onChange={(e) => onChange({ ...config, maxDepth: Number(e.target.value) })}
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="block text-xs text-muted-foreground">Project Path</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
            type="text"
            value={config.projectPath}
            onChange={(e) => onChange({ ...config, projectPath: e.target.value })}
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="block text-xs text-muted-foreground">Index Directory</span>
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
            type="text"
            value={config.indexDir}
            onChange={(e) => onChange({ ...config, indexDir: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-4">
        <p className="text-xs text-muted-foreground mb-2">JSON</p>
        <pre className="text-xs font-mono bg-muted/40 border border-border rounded-md p-3 overflow-x-auto">
          {jsonPreview}
        </pre>
      </div>
    </div>
  );
}

