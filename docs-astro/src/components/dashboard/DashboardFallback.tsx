import { AlertTriangle } from 'lucide-react';

export interface DashboardFallbackProps {
  /** Current locale for bilingual text. */
  locale?: 'en' | 'zh';
}

const messages = {
  en: {
    title: 'CCW Dashboard - Local Server Required',
    description:
      'The dashboard widgets connect to the Claude Code Workflow local API. ' +
      'Start the CCW server to see live session data, CodexLens status, and graph exploration.',
    hint: 'Run `ccw serve` to start the local API server.',
  },
  zh: {
    title: 'CCW 仪表盘 - 需要本地服务器',
    description:
      '仪表盘组件连接到 Claude Code Workflow 本地 API。' +
      '启动 CCW 服务器即可查看实时会话数据、CodexLens 状态和图形探索。',
    hint: '运行 `ccw serve` 启动本地 API 服务器。',
  },
} as const;

/**
 * DashboardFallback - Informational placeholder shown when the CCW API is
 * unreachable.
 *
 * This is a lightweight static component (no API calls). It provides a
 * bilingual message explaining that CCW needs to be running locally for the
 * dashboard widgets to display live data.
 */
export default function DashboardFallback({ locale = 'en' }: DashboardFallbackProps) {
  const t = messages[locale] ?? messages.en;

  return (
    <div className="border border-border rounded-lg bg-muted/20 p-6">
      <div className="flex items-start gap-4">
        <AlertTriangle className="w-6 h-6 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{t.title}</h3>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {t.description}
          </p>
          <p className="text-sm text-muted-foreground mt-3 font-mono bg-muted/40 border border-border rounded-md px-3 py-2 inline-block">
            {t.hint}
          </p>
        </div>
      </div>
    </div>
  );
}
