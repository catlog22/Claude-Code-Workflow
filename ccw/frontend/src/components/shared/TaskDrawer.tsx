// ========================================
// TaskDrawer Component
// ========================================
// Right-side task detail drawer with Overview/Flowchart/Files tabs

import * as React from 'react';
import { useIntl } from 'react-intl';
import { X, FileText, GitBranch, Folder, CheckCircle, Circle, Loader2, XCircle } from 'lucide-react';
import { Flowchart } from './Flowchart';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';
import type { NormalizedTask, LiteTask } from '@/lib/api';
import { buildFlowControl, normalizeTask } from '@/lib/api';
import type { TaskData } from '@/types/store';

// ========== Types ==========

export interface TaskDrawerProps {
  task: NormalizedTask | TaskData | LiteTask | null;
  isOpen: boolean;
  onClose: () => void;
}

type TabValue = 'overview' | 'flowchart' | 'files';

// Status configuration
const taskStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | null; icon: React.ComponentType<{ className?: string }> }> = {
  pending: {
    label: 'sessionDetail.taskDrawer.status.pending',
    variant: 'secondary',
    icon: Circle,
  },
  in_progress: {
    label: 'sessionDetail.taskDrawer.status.inProgress',
    variant: 'warning',
    icon: Loader2,
  },
  completed: {
    label: 'sessionDetail.taskDrawer.status.completed',
    variant: 'success',
    icon: CheckCircle,
  },
  blocked: {
    label: 'sessionDetail.taskDrawer.status.blocked',
    variant: 'destructive',
    icon: XCircle,
  },
  skipped: {
    label: 'sessionDetail.taskDrawer.status.skipped',
    variant: 'default',
    icon: Circle,
  },
  failed: {
    label: 'sessionDetail.taskDrawer.status.failed',
    variant: 'destructive',
    icon: XCircle,
  },
};

// ========== Component ==========

export function TaskDrawer({ task, isOpen, onClose }: TaskDrawerProps) {
  const { formatMessage } = useIntl();
  const [activeTab, setActiveTab] = React.useState<TabValue>('overview');

  // Reset to overview when task changes
  React.useEffect(() => {
    if (task) {
      setActiveTab('overview');
    }
  }, [task]);

  // ESC key to close
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Normalize task to unified flat format (handles old nested, new flat, and raw LiteTask/TaskData)
  // MUST be called before early return to satisfy React hooks rules
  const nt = React.useMemo(
    () => task ? normalizeTask(task as unknown as Record<string, unknown>) : null,
    [task],
  );

  if (!task || !isOpen || !nt) {
    return null;
  }
  const taskId = nt.task_id || 'N/A';
  const taskTitle = nt.title || 'Untitled Task';
  const taskDescription = nt.description;
  const taskStatus = nt.status;
  const flowControl = buildFlowControl(nt);

  // Normalized flat fields
  const acceptanceCriteria = nt.convergence?.criteria || [];
  const focusPaths = nt.focus_paths || [];
  const dependsOn = nt.depends_on || [];
  const preAnalysis = nt.pre_analysis || flowControl?.pre_analysis || [];
  const implSteps = nt.implementation || flowControl?.implementation_approach || [];

  // Get files from multiple sources: nt.files, flowControl.target_files, or sourceRaw.file
  const rawData = nt._raw as Record<string, unknown> | undefined;
  const sourceRaw = (rawData?._raw as Record<string, unknown>) || rawData;
  const rawFile = sourceRaw?.file as string | undefined;
  const taskFiles = nt.files || flowControl?.target_files || (rawFile ? [{ path: rawFile }] : []);
  const taskScope = nt.scope;

  // Detect if task supports status tracking (new format has explicit status/status_history)
  const hasStatusTracking = sourceRaw
    ? (sourceRaw.status !== undefined || sourceRaw.status_history !== undefined)
    : false;

  const statusConfig = taskStatusConfig[taskStatus] || taskStatusConfig.pending;
  const StatusIcon = statusConfig.icon;

  const hasFlowchart = implSteps.length > 0;
  const hasFiles = taskFiles.length > 0;

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity z-40 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-1/2 bg-background border-l border-border shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        style={{ minWidth: '400px', maxWidth: '800px' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border bg-card">
          <div className="flex-1 min-w-0 mr-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-primary/10 text-primary border border-primary/20">{taskId}</span>
              {hasStatusTracking && (
                <Badge variant={statusConfig.variant} className="gap-1">
                  <StatusIcon className="h-3 w-3" />
                  {formatMessage({ id: statusConfig.label })}
                </Badge>
              )}
            </div>
            <h2 id="drawer-title" className="text-lg font-semibold text-foreground">
              {taskTitle}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 hover:bg-secondary">
            <X className="h-5 w-5" />
            <span className="sr-only">{formatMessage({ id: 'common.actions.close' })}</span>
          </Button>
        </div>

        {/* Tabs Navigation */}
        <div className="px-6 pt-4 bg-card">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">
                <FileText className="h-4 w-4 mr-2" />
                {formatMessage({ id: 'sessionDetail.taskDrawer.tabs.overview' })}
              </TabsTrigger>
              {hasFlowchart && (
                <TabsTrigger value="flowchart" className="flex-1">
                  <GitBranch className="h-4 w-4 mr-2" />
                  {formatMessage({ id: 'sessionDetail.taskDrawer.tabs.flowchart' })}
                </TabsTrigger>
              )}
              <TabsTrigger value="files" className="flex-1">
                <Folder className="h-4 w-4 mr-2" />
                {formatMessage({ id: 'sessionDetail.taskDrawer.tabs.files' })}
              </TabsTrigger>
            </TabsList>

            {/* Tab Content (scrollable) */}
            <div className="overflow-y-auto pr-2" style={{ height: 'calc(100vh - 200px)' }}>
              {/* Overview Tab - Rich display matching JS version */}
              <TabsContent value="overview" className="mt-4 pb-6 focus-visible:outline-none">
                <div className="space-y-4">
                  {/* Description Section */}
                  {taskDescription && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span>📝</span>
                        {formatMessage({ id: 'sessionDetail.taskDrawer.overview.description' })}
                      </h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {taskDescription}
                      </p>
                    </div>
                  )}

                  {/* Scope Section */}
                  {taskScope && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span>📁</span>
                        Scope
                      </h3>
                      <div className="pl-3 border-l-2 border-primary">
                        <code className="text-sm text-foreground">{taskScope}</code>
                      </div>
                    </div>
                  )}

                  {/* Acceptance / Convergence Criteria Section */}
                  {acceptanceCriteria.length > 0 && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <span>✅</span>
                        {formatMessage({ id: 'liteTasks.acceptanceCriteria' })}
                      </h3>
                      <div className="space-y-2">
                        {acceptanceCriteria.map((criterion, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-muted-foreground mt-0.5">○</span>
                            <span className="text-sm text-foreground">{criterion}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Focus Paths / Reference Section */}
                  {focusPaths.length > 0 && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <span>📚</span>
                        {formatMessage({ id: 'liteTasks.focusPaths' })}
                      </h3>
                      <div className="space-y-1">
                        {focusPaths.map((path, i) => (
                          <code key={i} className="block text-xs bg-muted px-3 py-1.5 rounded text-foreground font-mono">
                            {path}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dependencies Section */}
                  {dependsOn.length > 0 && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <span>🔗</span>
                        {formatMessage({ id: 'liteTasks.dependsOn' })}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {dependsOn.map((dep, i) => (
                          <Badge key={i} variant="secondary">{dep}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pre-analysis Steps */}
                  {preAnalysis.length > 0 && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <span>🔍</span>
                        {formatMessage({ id: 'sessionDetail.taskDrawer.overview.preAnalysis' })}
                      </h3>
                      <div className="space-y-3">
                        {preAnalysis.map((step, index) => (
                          <div key={index} className="flex items-start gap-3">
                            <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                              {index + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{step.step || step.action}</p>
                              {step.action && step.action !== step.step && (
                                <p className="text-xs text-muted-foreground mt-1">{step.action}</p>
                              )}
                              {step.commands && step.commands.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {step.commands.map((cmd, i) => (
                                    <code key={i} className="text-xs bg-muted px-2 py-0.5 rounded">{cmd}</code>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Implementation Steps */}
                  {flowControl?.implementation_approach && flowControl.implementation_approach.length > 0 && (
                    <div className="p-4 bg-card rounded-lg border border-border">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <span>📋</span>
                        {formatMessage({ id: 'sessionDetail.taskDrawer.overview.implementationSteps' })}
                      </h3>
                      <ol className="space-y-3">
                        {flowControl.implementation_approach.map((step, index) => {
                          const isString = typeof step === 'string';
                          // Extract just the number from strings like "Step 1", "step1", etc.
                          const rawStep = isString ? (index + 1) : (step.step || index + 1);
                          const stepNumber = typeof rawStep === 'string'
                            ? (rawStep.match(/\d+/)?.[0] || index + 1)
                            : rawStep;

                          // Try multiple fields for title (matching JS version)
                          let stepTitle: string;
                          let stepDesc: string | undefined;

                          if (isString) {
                            stepTitle = step;
                          } else {
                            // Try title first, then action, phase, description
                            stepTitle = step.title || step.action || step.phase || '';

                            // If empty, try any string value from the object
                            if (!stepTitle) {
                              const stepKeys = Object.keys(step).filter(k =>
                                k !== 'step' && k !== 'depends_on' && k !== 'modification_points' && k !== 'logic_flow'
                              );
                              for (const key of stepKeys) {
                                const val = step[key as keyof typeof step];
                                if (typeof val === 'string' && val.trim()) {
                                  stepTitle = val;
                                  break;
                                }
                              }
                            }

                            // Final fallback
                            if (!stepTitle) {
                              stepTitle = `Step ${stepNumber}`;
                            }

                            // Description if different from title
                            stepDesc = step.description && step.description !== stepTitle ? step.description : undefined;
                          }

                          return (
                            <li key={index} className="flex items-start gap-3">
                              <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                                {stepNumber}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground">{stepTitle}</p>
                                {stepDesc && (
                                  <p className="text-xs text-muted-foreground mt-1">{stepDesc}</p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}

                  {/* Empty State */}
                  {!taskDescription &&
                    !taskScope &&
                    !acceptanceCriteria.length &&
                    !focusPaths.length &&
                    !(flowControl?.pre_analysis?.length) &&
                    !(flowControl?.implementation_approach?.length) && (
                      <div className="text-center py-12">
                        <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-sm text-muted-foreground">
                          {formatMessage({ id: 'sessionDetail.taskDrawer.overview.empty' })}
                        </p>
                      </div>
                    )}
                </div>
              </TabsContent>

              {/* Flowchart Tab */}
              {hasFlowchart && (
                <TabsContent value="flowchart" className="mt-4 pb-6">
                  <Flowchart flowControl={flowControl!} className="min-h-[400px]" showStepStatus={hasStatusTracking} />
                </TabsContent>
              )}

              {/* Files Tab */}
              <TabsContent value="files" className="mt-4 pb-6">
                {hasFiles ? (
                  <div className="space-y-3">
                    {taskFiles.map((file, index) => {
                      // Support multiple file formats: string, { path: string }, { name: string }, { path, name }
                      let displayPath: string;
                      if (typeof file === 'string') {
                        displayPath = file;
                      } else if (file && typeof file === 'object') {
                        displayPath = file.path || file.name || 'Unknown';
                      } else {
                        displayPath = 'Unknown';
                      }

                      return (
                        <div
                          key={index}
                          className="flex items-center gap-2 p-3 bg-card rounded-md border border-border shadow-sm hover:shadow-md transition-shadow"
                        >
                          <Folder className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="text-sm font-mono text-foreground">{displayPath}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Folder className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                      {formatMessage({ id: 'sessionDetail.taskDrawer.files.empty' })}
                    </p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </>
  );
}
