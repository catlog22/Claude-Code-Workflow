// ========================================
// LiteTasksPage Component
// ========================================
// Lite-plan and lite-fix task list page with TaskDrawer

import * as React from 'react';
import { useIntl } from 'react-intl';
import {
  ArrowLeft,
  Zap,
  Wrench,
  FileEdit,
  MessagesSquare,
  Calendar,
  XCircle,
  Activity,
  Repeat,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Search,
  SortAsc,
  SortDesc,
  ListFilter,
  Hash,
  ListChecks,
  Package,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileCode,
  ThumbsUp,
  ThumbsDown,
  Target,
  GitCompare,
  HelpCircle,
  Cpu,
  Timer,
  Sparkles,
  CheckCheck,
  Route,
  Flag,
  AlertOctagon,
  Link2,
  ShieldCheck,
  Settings2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useAppStore, selectIsImmersiveMode } from '@/stores/appStore';
import { useLiteTasks } from '@/hooks/useLiteTasks';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { TabsNavigation } from '@/components/ui/TabsNavigation';
import { TaskDrawer } from '@/components/shared/TaskDrawer';
import { fetchLiteSessionContext, type LiteTask, type LiteTaskSession, type LiteSessionContext, type RoundSynthesis, type MultiCliContextPackage } from '@/lib/api';
import { LiteContextContent } from '@/components/lite-tasks/LiteContextContent';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/lib/utils';

type LiteTaskTab = 'lite-plan' | 'lite-fix' | 'multi-cli-plan';
type SortField = 'date' | 'name' | 'tasks';
type SortOrder = 'asc' | 'desc';

/**
 * Get i18n text from label object (supports {en, zh} format)
 * Note: fallback should be provided dynamically from component context
 */
function getI18nText(label: string | { en?: string; zh?: string } | undefined): string | undefined {
  if (!label) return undefined;
  if (typeof label === 'string') return label;
  return label.en || label.zh;
}

type ExpandedTab = 'tasks' | 'context';

/**
 * ExpandedSessionPanel - Multi-tab panel shown when a lite session is expanded
 */
function ExpandedSessionPanel({
  session,
  onTaskClick,
}: {
  session: LiteTaskSession;
  onTaskClick: (task: LiteTask) => void;
}) {
  const { formatMessage } = useIntl();
  const [activeTab, setActiveTab] = React.useState<ExpandedTab>('tasks');
  const [contextData, setContextData] = React.useState<LiteSessionContext | null>(null);
  const [contextLoading, setContextLoading] = React.useState(false);
  const [contextError, setContextError] = React.useState<string | null>(null);

  const tasks = session.tasks || [];
  const taskCount = tasks.length;

  // Load context data lazily when context tab is selected
  React.useEffect(() => {
    if (activeTab !== 'context') return;
    if (contextData || contextLoading) return;
    if (!session.path) {
      setContextError('No session path available');
      return;
    }

    setContextLoading(true);
    fetchLiteSessionContext(session.path)
      .then((data) => {
        setContextData(data);
        setContextError(null);
      })
      .catch((err) => {
        setContextError(err.message || 'Failed to load context');
      })
      .finally(() => {
        setContextLoading(false);
      });
  }, [activeTab, session.path, contextData, contextLoading]);

  return (
    <div className="mt-2 ml-6 pb-2">
      {/* Quick Info Cards */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab('tasks'); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            activeTab === 'tasks'
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {formatMessage({ id: 'liteTasks.quickCards.tasks' })}
          <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
            {taskCount}
          </Badge>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab('context'); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            activeTab === 'context'
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          {formatMessage({ id: 'liteTasks.quickCards.context' })}
        </button>
      </div>

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.map((task, index) => {
            const filesCount = task.flow_control?.target_files?.length || 0;
            const stepsCount = task.flow_control?.implementation_approach?.length || 0;
            const criteriaCount = task.context?.acceptance?.length || 0;
            const depsCount = task.context?.depends_on?.length || 0;

            return (
              <Card
                key={task.id || index}
                className="cursor-pointer hover:shadow-sm hover:border-primary/50 transition-all border-border border-l-4 border-l-primary/50"
                onClick={(e) => {
                  e.stopPropagation();
                  onTaskClick(task);
                }}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge className="text-xs font-mono shrink-0 bg-primary/10 text-primary border-primary/20">
                        {task.task_id || `#${index + 1}`}
                      </Badge>
                      <h4 className="text-sm font-medium text-foreground line-clamp-1">
                        {task.title || formatMessage({ id: 'liteTasks.untitled' })}
                      </h4>
                    </div>
                    {/* Meta badges - right side, single row */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {task.meta?.type && (
                        <Badge variant="info" className="text-[10px] px-1.5 py-0 whitespace-nowrap">{task.meta.type}</Badge>
                      )}
                      {filesCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 whitespace-nowrap">
                          <FileCode className="h-2.5 w-2.5" />
                          {filesCount} files
                        </Badge>
                      )}
                      {stepsCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 whitespace-nowrap">
                          {stepsCount} steps
                        </Badge>
                      )}
                      {criteriaCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 whitespace-nowrap">
                          {criteriaCount} criteria
                        </Badge>
                      )}
                      {depsCount > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">→</span>
                          {task.context?.depends_on?.map((depId, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 font-mono border-primary/30 text-primary whitespace-nowrap">
                              {depId}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 pl-[calc(1.5rem+0.75rem)] line-clamp-2">
                      {task.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Context Tab */}
      {activeTab === 'context' && (
        <div className="space-y-3">
          {contextLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm">{formatMessage({ id: 'liteTasks.contextPanel.loading' })}</span>
            </div>
          )}
          {contextError && !contextLoading && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {formatMessage({ id: 'liteTasks.contextPanel.error' })}: {contextError}
            </div>
          )}
          {!contextLoading && !contextError && contextData && (
            <LiteContextContent contextData={contextData} session={session} />
          )}
          {!contextLoading && !contextError && !contextData && !session.path && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {formatMessage({ id: 'liteTasks.contextPanel.empty' })}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ContextContent - Extracted to @/components/lite-tasks/LiteContextContent.tsx
 */

/**
 * RoundDetailCard - Display detailed information for a single discussion round
 */
function RoundDetailCard({ round, isLast }: { round: RoundSynthesis; isLast: boolean }) {
  const { formatMessage } = useIntl();
  const [expanded, setExpanded] = React.useState(isLast);

  const solutions = round.solutions || [];
  const convergence = round.convergence;
  const crossVerification = round.cross_verification;
  const clarificationQuestions = round.clarification_questions || [];
  const cliExecutions = round.cli_executions || {};

  // Format duration
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Get convergence badge variant
  const getConvergenceVariant = (recommendation?: string) => {
    switch (recommendation) {
      case 'converged': return 'success';
      case 'continue': return 'warning';
      case 'user_input_needed': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        {/* Round Header */}
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
              {round.round}
            </div>
            <div>
              <h4 className="font-medium text-foreground flex items-center gap-2">
                {formatMessage({ id: 'liteTasks.multiCli.round' })} {round.round}
                {convergence && (
                  <Badge variant={getConvergenceVariant(convergence.recommendation)} className="text-[10px]">
                    {convergence.recommendation === 'converged' && <CheckCheck className="h-3 w-3 mr-1" />}
                    {convergence.recommendation === 'converged' && formatMessage({ id: 'liteTasks.multiCli.converged' })}
                    {convergence.recommendation === 'continue' && formatMessage({ id: 'liteTasks.multiCli.continuing' })}
                    {convergence.recommendation === 'user_input_needed' && formatMessage({ id: 'liteTasks.multiCli.needsInput' })}
                  </Badge>
                )}
              </h4>
              <p className="text-xs text-muted-foreground">
                {round.timestamp ? new Date(round.timestamp).toLocaleString() : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* CLI Status Summary */}
            <div className="flex items-center gap-1">
              {Object.entries(cliExecutions).map(([cli, exec]) => (
                <Badge
                  key={cli}
                  variant={exec.status === 'success' ? 'success' : 'destructive'}
                  className="text-[10px] px-1.5 py-0"
                >
                  {cli}
                </Badge>
              ))}
            </div>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Expanded Content */}
        {expanded && (
          <div className="mt-4 space-y-4">
            {/* User Feedback Incorporated */}
            {round.user_feedback_incorporated && (
              <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1">
                  <MessageCircle className="h-4 w-4" />
                  {formatMessage({ id: 'liteTasks.multiCli.userFeedback' })}
                </div>
                <p className="text-sm text-foreground">{round.user_feedback_incorporated}</p>
              </div>
            )}

            {/* CLI Executions */}
            {Object.keys(cliExecutions).length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Cpu className="h-4 w-4" />
                  {formatMessage({ id: 'liteTasks.multiCli.cliExecutions' })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(cliExecutions).map(([cli, exec]) => (
                    <div key={cli} className="flex items-center justify-between p-2 bg-muted/50 rounded-md text-xs">
                      <span className="font-medium">{cli}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{exec.model}</span>
                        <Badge variant={exec.status === 'success' ? 'success' : 'destructive'} className="text-[10px] px-1 py-0">
                          <Timer className="h-3 w-3 mr-1" />
                          {formatDuration(exec.duration_ms)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Solutions */}
            {solutions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  {formatMessage({ id: 'liteTasks.multiCli.solutions' })} ({solutions.length})
                </div>
                <div className="space-y-3">
                  {solutions.map((solution, idx) => (
                    <div key={idx} className="p-3 bg-muted/30 rounded-lg border border-border/50">
                      <div className="flex items-start justify-between mb-2">
                        <h5 className="font-medium text-foreground text-sm">{solution.name}</h5>
                        <div className="flex items-center gap-1">
                          {solution.source_cli.map((cli) => (
                            <Badge key={cli} variant="outline" className="text-[10px] px-1.5 py-0">
                              {cli}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{solution.summary}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="success" className="text-[10px]">
                          {Math.round(solution.feasibility * 100)}% {formatMessage({ id: 'liteTasks.multiCli.feasible' })}
                        </Badge>
                        <Badge variant="warning" className="text-[10px]">{solution.effort}</Badge>
                        <Badge variant={solution.risk === 'high' ? 'destructive' : solution.risk === 'low' ? 'success' : 'warning'} className="text-[10px]">
                          {solution.risk} {formatMessage({ id: 'liteTasks.multiCli.risk' })}
                        </Badge>
                      </div>
                      {/* Pros/Cons */}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {solution.pros.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-xs text-success">
                              <ThumbsUp className="h-3 w-3" />
                              {formatMessage({ id: 'liteTasks.multiCli.pros' })}
                            </div>
                            <ul className="text-[10px] text-muted-foreground space-y-0.5">
                              {solution.pros.slice(0, 3).map((pro, i) => (
                                <li key={i} className="truncate">• {pro}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {solution.cons.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-xs text-destructive">
                              <ThumbsDown className="h-3 w-3" />
                              {formatMessage({ id: 'liteTasks.multiCli.cons' })}
                            </div>
                            <ul className="text-[10px] text-muted-foreground space-y-0.5">
                              {solution.cons.slice(0, 3).map((con, i) => (
                                <li key={i} className="truncate">• {con}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Convergence Analysis */}
            {convergence && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Target className="h-4 w-4" />
                  {formatMessage({ id: 'liteTasks.multiCli.convergence' })}
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          convergence.score >= 0.9 ? 'bg-success' :
                          convergence.score >= 0.7 ? 'bg-warning' : 'bg-destructive'
                        }`}
                        style={{ width: `${convergence.score * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium">{Math.round(convergence.score * 100)}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{convergence.rationale}</p>
                </div>
              </div>
            )}

            {/* Cross Verification */}
            {crossVerification && (crossVerification.agreements.length > 0 || crossVerification.disagreements.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <GitCompare className="h-4 w-4" />
                  {formatMessage({ id: 'liteTasks.multiCli.crossVerification' })}
                </div>
                <div className="space-y-2">
                  {/* Agreements */}
                  {crossVerification.agreements.length > 0 && (
                    <div className="p-3 bg-success/10 border border-success/20 rounded-lg">
                      <div className="flex items-center gap-2 text-xs font-medium text-success mb-2">
                        <CheckCircle2 className="h-3 w-3" />
                        {formatMessage({ id: 'liteTasks.multiCli.agreements' })} ({crossVerification.agreements.length})
                      </div>
                      <ul className="text-[10px] text-muted-foreground space-y-1">
                        {crossVerification.agreements.slice(0, 5).map((agreement, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                            <span>{agreement}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Disagreements */}
                  {crossVerification.disagreements.length > 0 && (
                    <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                      <div className="flex items-center gap-2 text-xs font-medium text-warning mb-2">
                        <AlertCircle className="h-3 w-3" />
                        {formatMessage({ id: 'liteTasks.multiCli.disagreements' })} ({crossVerification.disagreements.length})
                      </div>
                      <div className="space-y-2">
                        {crossVerification.disagreements.map((disagreement, i) => (
                          <div key={i} className="text-[10px]">
                            <div className="font-medium text-foreground mb-1">{disagreement.topic}</div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex items-center gap-1">
                                <Badge variant="outline" className="text-[9px] px-1 py-0">gemini</Badge>
                                <span className="text-muted-foreground truncate">{disagreement.gemini}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Badge variant="outline" className="text-[9px] px-1 py-0">codex</Badge>
                                <span className="text-muted-foreground truncate">{disagreement.codex}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Resolution */}
                  {crossVerification.resolution && (
                    <div className="text-xs text-muted-foreground italic">
                      {formatMessage({ id: 'liteTasks.multiCli.resolution' })}: {crossVerification.resolution}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Clarification Questions */}
            {clarificationQuestions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <HelpCircle className="h-4 w-4" />
                  {formatMessage({ id: 'liteTasks.multiCli.clarificationQuestions' })} ({clarificationQuestions.length})
                </div>
                <ul className="space-y-1">
                  {clarificationQuestions.map((question, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <HelpCircle className="h-3 w-3 shrink-0 mt-0.5 text-info" />
                      <span>{question}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * MultiCliContextContent - Display context-package.json for multi-cli-plan sessions
 */
function MultiCliContextContent({ data }: { data: MultiCliContextPackage }) {
  const { formatMessage } = useIntl();
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set(['solution', 'plan']));

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const isExpanded = (section: string) => expandedSections.has(section);

  // Section wrapper component
  const Section = ({ id, icon, title, badge, children, defaultExpanded = true }: {
    id: string;
    icon: React.ReactNode;
    title: string;
    badge?: React.ReactNode;
    children: React.ReactNode;
    defaultExpanded?: boolean;
  }) => {
    // Initialize expanded state based on defaultExpanded if not already in set
    React.useEffect(() => {
      if (defaultExpanded && !expandedSections.has(id)) {
        setExpandedSections(prev => new Set(prev).add(id));
      }
    }, [id, defaultExpanded]);

    return (
      <Card className="border-border">
        <button
          type="button"
          className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection(id)}
        >
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-sm font-medium text-foreground flex-1">{title}</span>
          {badge}
          {isExpanded(id) ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {isExpanded(id) && (
          <CardContent className="px-3 pb-3 pt-0">
            {children}
          </CardContent>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      {/* Solution Section */}
      {data.solution && (
        <Section
          id="solution"
          icon={<Sparkles className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.solution' })}
          badge={
            <div className="flex items-center gap-1">
              {data.solution.source_cli.map(cli => (
                <Badge key={cli} variant="outline" className="text-[10px] px-1.5 py-0">{cli}</Badge>
              ))}
            </div>
          }
        >
          <div className="space-y-2">
            <h4 className="font-medium text-foreground text-sm">{data.solution.name}</h4>
            <p className="text-xs text-muted-foreground">{data.solution.summary}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success" className="text-[10px]">
                {Math.round(data.solution.feasibility * 100)}% {formatMessage({ id: 'liteTasks.multiCli.feasible' })}
              </Badge>
              <Badge variant="warning" className="text-[10px]">{data.solution.effort}</Badge>
              <Badge variant={data.solution.risk === 'high' ? 'destructive' : data.solution.risk === 'low' ? 'success' : 'warning'} className="text-[10px]">
                {data.solution.risk} {formatMessage({ id: 'liteTasks.multiCli.risk' })}
              </Badge>
            </div>
          </div>
        </Section>
      )}

      {/* Implementation Plan Section */}
      {data.implementation_plan && (
        <Section
          id="plan"
          icon={<Route className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.implementationPlan' })}
          badge={<Badge variant="secondary" className="text-[10px]">{data.implementation_plan.tasks?.length || 0} tasks</Badge>}
        >
          <div className="space-y-3">
            {/* Approach */}
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{formatMessage({ id: 'liteTasks.multiCli.context.approach' })}:</span>{' '}
              {data.implementation_plan.approach}
            </div>

            {/* Execution Flow */}
            {data.implementation_plan.execution_flow && (
              <div className="p-2 bg-muted/50 rounded-md">
                <code className="text-xs font-mono text-foreground">{data.implementation_plan.execution_flow}</code>
              </div>
            )}

            {/* Tasks */}
            {data.implementation_plan.tasks && data.implementation_plan.tasks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">{formatMessage({ id: 'liteTasks.multiCli.context.tasks' })}</div>
                <div className="space-y-1.5">
                  {data.implementation_plan.tasks.map((task, idx) => (
                    <div key={task.id || idx} className="flex items-start gap-2 p-2 bg-muted/30 rounded-md">
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0">{task.id}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground">{task.name}</div>
                        {task.key_point && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">{task.key_point}</div>
                        )}
                        {task.files && task.files.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {task.files.map((f, i) => (
                              <Badge key={i} variant="secondary" className="text-[9px] font-mono">
                                {f.action === 'create' ? '+' : f.action === 'delete' ? '-' : '~'} {f.file}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Milestones */}
            {data.implementation_plan.milestones && data.implementation_plan.milestones.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Flag className="h-3 w-3" />
                  {formatMessage({ id: 'liteTasks.multiCli.context.milestones' })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.implementation_plan.milestones.map((milestone, i) => (
                    <Badge key={i} variant="info" className="text-[10px]">{milestone}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Dependencies Section */}
      {data.dependencies && (data.dependencies.internal?.length > 0 || data.dependencies.external?.length > 0) && (
        <Section
          id="deps"
          icon={<Link2 className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.dependencies' })}
          badge={<Badge variant="secondary" className="text-[10px]">{(data.dependencies.internal?.length || 0) + (data.dependencies.external?.length || 0)}</Badge>}
        >
          <div className="space-y-2">
            {data.dependencies.internal && data.dependencies.internal.length > 0 && (
              <div>
                <div className="text-xs font-medium text-foreground mb-1">{formatMessage({ id: 'liteTasks.multiCli.context.internal' })}</div>
                <div className="flex flex-wrap gap-1">
                  {data.dependencies.internal.map((dep, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono">{dep}</Badge>
                  ))}
                </div>
              </div>
            )}
            {data.dependencies.external && data.dependencies.external.length > 0 && (
              <div>
                <div className="text-xs font-medium text-foreground mb-1">{formatMessage({ id: 'liteTasks.multiCli.context.external' })}</div>
                <div className="flex flex-wrap gap-1">
                  {data.dependencies.external.map((dep, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-mono">{dep}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Consensus Section */}
      {data.consensus && data.consensus.agreements?.length > 0 && (
        <Section
          id="consensus"
          icon={<ShieldCheck className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.consensus' })}
          badge={<Badge variant="success" className="text-[10px]">{data.consensus.agreements.length}</Badge>}
        >
          <div className="space-y-2">
            <ul className="space-y-1">
              {data.consensus.agreements.map((agreement, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                  <span>{agreement}</span>
                </li>
              ))}
            </ul>
            {data.consensus.resolved_conflicts && (
              <div className="mt-2 p-2 bg-success/10 border border-success/20 rounded-md text-xs text-muted-foreground">
                <span className="font-medium text-success">{formatMessage({ id: 'liteTasks.multiCli.context.resolvedConflicts' })}:</span>{' '}
                {data.consensus.resolved_conflicts}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Technical Concerns Section */}
      {data.technical_concerns && data.technical_concerns.length > 0 && (
        <Section
          id="concerns"
          icon={<AlertOctagon className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.technicalConcerns' })}
          badge={<Badge variant="warning" className="text-[10px]">{data.technical_concerns.length}</Badge>}
        >
          <ul className="space-y-1">
            {data.technical_concerns.map((concern, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertCircle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                <span>{concern}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Constraints Section */}
      {data.constraints && data.constraints.length > 0 && (
        <Section
          id="constraints"
          icon={<Settings2 className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.constraints' })}
          badge={<Badge variant="secondary" className="text-[10px]">{data.constraints.length}</Badge>}
        >
          <div className="flex flex-wrap gap-1.5">
            {data.constraints.map((constraint, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">{constraint}</Badge>
            ))}
          </div>
        </Section>
      )}

      {/* Session Info */}
      {(data.task_description || data.session_id) && (
        <Section
          id="info"
          icon={<Package className="h-4 w-4" />}
          title={formatMessage({ id: 'liteTasks.multiCli.context.sessionInfo' })}
          defaultExpanded={false}
        >
          <div className="space-y-2 text-xs">
            {data.task_description && (
              <div className="text-muted-foreground">
                <span className="font-medium text-foreground">{formatMessage({ id: 'liteTasks.contextPanel.taskDescription' })}:</span>{' '}
                {data.task_description}
              </div>
            )}
            {data.session_id && (
              <div className="text-muted-foreground">
                <span className="font-medium text-foreground">{formatMessage({ id: 'liteTasks.contextPanel.sessionId' })}:</span>{' '}
                <span className="font-mono bg-muted/50 px-1.5 py-0.5 rounded">{data.session_id}</span>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

type MultiCliExpandedTab = 'tasks' | 'discussion' | 'context';

/**
 * ExpandedMultiCliPanel - Multi-tab panel shown when a multi-cli session is expanded
 */
function ExpandedMultiCliPanel({
  session,
  onTaskClick,
}: {
  session: LiteTaskSession;
  onTaskClick: (task: LiteTask) => void;
}) {
  const { formatMessage } = useIntl();
  const [activeTab, setActiveTab] = React.useState<MultiCliExpandedTab>('tasks');
  const [contextData, setContextData] = React.useState<LiteSessionContext | null>(null);
  const [contextLoading, setContextLoading] = React.useState(false);
  const [contextError, setContextError] = React.useState<string | null>(null);

  const tasks = session.tasks || [];
  const taskCount = tasks.length;
  const synthesis = session.latestSynthesis || {};
  const plan = session.plan || {};
  const roundCount = session.roundCount || (session.metadata?.roundId as number) || 1;

  // Get i18n text helper
  const getI18nTextLocal = (text: string | { en?: string; zh?: string } | undefined): string => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    return text.en || text.zh || '';
  };

  // Build implementation chain from task dependencies
  const buildImplementationChain = (): string => {
    if (tasks.length === 0) return '';

    // Find tasks with no dependencies (starting tasks)
    const taskDeps: Record<string, string[]> = {};
    const taskIds = new Set<string>();

    tasks.forEach(t => {
      const id = t.task_id || t.id;
      taskIds.add(id);
      taskDeps[id] = t.context?.depends_on || [];
    });

    // Find starting tasks (no deps or deps not in task list)
    const startingTasks = tasks.filter(t => {
      const deps = t.context?.depends_on || [];
      return deps.length === 0 || deps.every(d => !taskIds.has(d));
    }).map(t => t.task_id || t.id);

    // Group parallel tasks
    const parallelStart = startingTasks.length > 1
      ? `(${startingTasks.join(' | ')})`
      : startingTasks[0] || '';

    // Find subsequent tasks in order
    const processed = new Set(startingTasks);
    const chain: string[] = [parallelStart];

    let iterations = 0;
    while (processed.size < tasks.length && iterations < 20) {
      iterations++;
      const nextBatch: string[] = [];

      tasks.forEach(t => {
        const id = t.task_id || t.id;
        if (processed.has(id)) return;

        const deps = t.context?.depends_on || [];
        if (deps.every(d => processed.has(d) || !taskIds.has(d))) {
          nextBatch.push(id);
        }
      });

      if (nextBatch.length === 0) break;

      nextBatch.forEach(id => processed.add(id));
      if (nextBatch.length > 1) {
        chain.push(`(${nextBatch.join(' | ')})`);
      } else {
        chain.push(nextBatch[0]);
      }
    }

    return chain.filter(Boolean).join(' → ');
  };

  // Load context data lazily
  React.useEffect(() => {
    if (activeTab !== 'context') return;
    if (contextData || contextLoading) return;
    if (!session.path) {
      setContextError('No session path available');
      return;
    }

    setContextLoading(true);
    fetchLiteSessionContext(session.path)
      .then((data) => {
        setContextData(data);
        setContextError(null);
      })
      .catch((err) => {
        setContextError(err.message || 'Failed to load context');
      })
      .finally(() => {
        setContextLoading(false);
      });
  }, [activeTab, session.path, contextData, contextLoading]);

  const implementationChain = buildImplementationChain();
  const goal = getI18nTextLocal(plan.goal as string | { en?: string; zh?: string }) ||
               getI18nTextLocal(synthesis.title as string | { en?: string; zh?: string }) || '';
  const solution = getI18nTextLocal(plan.solution as string | { en?: string; zh?: string }) || '';
  const feasibility = (plan.feasibility as number) || 0;
  const effort = (plan.effort as string) || '';
  const risk = (plan.risk as string) || '';

  return (
    <div className="mt-2 ml-6 pb-2">
      {/* Session Info Header */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3 pb-2 border-b border-border/50">
        {session.createdAt && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatMessage({ id: 'liteTasks.createdAt' })}: {new Date(session.createdAt).toLocaleDateString()}
          </span>
        )}
        <span className="flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" />
          {formatMessage({ id: 'liteTasks.quickCards.tasks' })}: {taskCount} {formatMessage({ id: 'liteTasks.tasksCount' })}
        </span>
      </div>

      {/* Tab Buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab('tasks'); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            activeTab === 'tasks'
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {formatMessage({ id: 'liteTasks.quickCards.tasks' })}
          <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
            {taskCount}
          </Badge>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab('discussion'); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            activeTab === 'discussion'
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          {formatMessage({ id: 'liteTasks.multiCli.discussion' })}
          <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
            {roundCount}
          </Badge>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab('context'); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            activeTab === 'context'
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          {formatMessage({ id: 'liteTasks.quickCards.context' })}
        </button>
      </div>

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div className="space-y-3">
          {/* Goal/Solution/Implementation Header */}
          {(goal || solution || implementationChain) && (
            <Card className="border-border bg-muted/30">
              <CardContent className="p-3 space-y-2">
                {goal && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{formatMessage({ id: 'liteTasks.multiCli.goal' })}:</span>
                    <span className="ml-2 text-foreground">{goal}</span>
                  </div>
                )}
                {solution && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{formatMessage({ id: 'liteTasks.multiCli.solution' })}:</span>
                    <span className="ml-2 text-foreground">{solution}</span>
                  </div>
                )}
                {implementationChain && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">{formatMessage({ id: 'liteTasks.multiCli.implementation' })}:</span>
                    <code className="ml-2 px-2 py-0.5 rounded bg-background border border-border text-xs font-mono">
                      {implementationChain}
                    </code>
                  </div>
                )}
                {(feasibility > 0 || effort || risk) && (
                  <div className="flex items-center gap-2 pt-1">
                    {feasibility > 0 && (
                      <Badge variant="success" className="text-[10px]">{feasibility}%</Badge>
                    )}
                    {effort && (
                      <Badge variant="warning" className="text-[10px]">{effort}</Badge>
                    )}
                    {risk && (
                      <Badge variant={risk === 'high' ? 'destructive' : risk === 'medium' ? 'warning' : 'success'} className="text-[10px]">
                        {risk} {formatMessage({ id: 'liteTasks.multiCli.risk' })}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Task List */}
          {tasks.map((task, index) => {
            const filesCount = task.flow_control?.target_files?.length || 0;
            const stepsCount = task.flow_control?.implementation_approach?.length || 0;
            const criteriaCount = task.context?.acceptance?.length || 0;
            const depsCount = task.context?.depends_on?.length || 0;

            return (
              <Card
                key={task.id || index}
                className="cursor-pointer hover:shadow-sm hover:border-primary/50 transition-all border-border border-l-4 border-l-primary/50"
                onClick={(e) => {
                  e.stopPropagation();
                  onTaskClick(task);
                }}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge className="text-xs font-mono shrink-0 bg-primary/10 text-primary border-primary/20">
                        {task.task_id || `T${index + 1}`}
                      </Badge>
                      <h4 className="text-sm font-medium text-foreground line-clamp-1">
                        {task.title || formatMessage({ id: 'liteTasks.untitled' })}
                      </h4>
                    </div>
                    {/* Meta badges - right side, single row */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {task.meta?.type && (
                        <Badge variant="info" className="text-[10px] px-1.5 py-0 whitespace-nowrap">{task.meta.type}</Badge>
                      )}
                      {filesCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 whitespace-nowrap">
                          <FileCode className="h-2.5 w-2.5" />
                          {filesCount} files
                        </Badge>
                      )}
                      {stepsCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 whitespace-nowrap">
                          {stepsCount} steps
                        </Badge>
                      )}
                      {criteriaCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 whitespace-nowrap">
                          {criteriaCount} criteria
                        </Badge>
                      )}
                      {depsCount > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">→</span>
                          {task.context?.depends_on?.map((depId, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 font-mono border-primary/30 text-primary whitespace-nowrap">
                              {depId}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Discussion Tab */}
      {activeTab === 'discussion' && (
        <div className="space-y-3">
          {/* Rounds Detail */}
          {session.rounds && session.rounds.length > 0 ? (
            session.rounds.map((round, idx) => (
              <RoundDetailCard
                key={round.round || idx}
                round={round}
                isLast={idx === session.rounds!.length - 1}
              />
            ))
          ) : (
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessagesSquare className="h-5 w-5 text-primary" />
                  <h4 className="font-medium text-foreground">
                    {formatMessage({ id: 'liteTasks.multiCli.discussionRounds' })}
                  </h4>
                  <Badge variant="secondary" className="text-xs">{roundCount} {formatMessage({ id: 'liteTasks.rounds' })}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.multiCli.discussionDescription' })}
                </p>
                {goal && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm text-foreground">{goal}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Context Tab */}
      {activeTab === 'context' && (
        <div className="space-y-3">
          {contextLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm">{formatMessage({ id: 'liteTasks.contextPanel.loading' })}</span>
            </div>
          )}
          {contextError && !contextLoading && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              {formatMessage({ id: 'liteTasks.contextPanel.error' })}: {contextError}
            </div>
          )}
          {!contextLoading && !contextError && contextData && (
            // Detect multi-cli-plan context by checking for solution field
            (contextData.context as MultiCliContextPackage)?.solution ? (
              <MultiCliContextContent data={contextData.context as MultiCliContextPackage} />
            ) : (
              <LiteContextContent contextData={contextData} session={session} />
            )
          )}
          {!contextLoading && !contextError && !contextData && !session.path && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {formatMessage({ id: 'liteTasks.contextPanel.empty' })}
              </p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/**
 * LiteTasksPage component - Display lite-plan and lite-fix sessions with expandable tasks
 */
export function LiteTasksPage() {
  const navigate = useNavigate();
  const { subType, id } = useParams<{ subType?: string; id?: string }>();
  const { litePlan, liteFix, multiCliPlan, isLoading, error, refetch } = useLiteTasks();
  const { formatMessage } = useIntl();
  const [activeTab, setActiveTab] = React.useState<LiteTaskTab>('lite-plan');
  const [expandedSessionId, setExpandedSessionId] = React.useState<string | null>(null);
  const [selectedTask, setSelectedTask] = React.useState<LiteTask | null>(null);
  const paramsInitialized = React.useRef(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortField, setSortField] = React.useState<SortField>('date');
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('desc');
  const isImmersiveMode = useAppStore(selectIsImmersiveMode);
  const toggleImmersiveMode = useAppStore((s) => s.toggleImmersiveMode);

  // Filter and sort sessions
  const filterAndSort = React.useCallback((sessions: LiteTaskSession[]) => {
    let filtered = sessions;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = sessions.filter(session =>
        session.id.toLowerCase().includes(query) ||
        session.tasks?.some(task =>
          task.title?.toLowerCase().includes(query) ||
          task.task_id?.toLowerCase().includes(query)
        )
      );
    }

    // Apply sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'date':
          comparison = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
        case 'name':
          comparison = a.id.localeCompare(b.id);
          break;
        case 'tasks':
          comparison = (a.tasks?.length || 0) - (b.tasks?.length || 0);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [searchQuery, sortField, sortOrder]);

  // Filtered data
  const filteredLitePlan = React.useMemo(() => filterAndSort(litePlan), [litePlan, filterAndSort]);
  const filteredLiteFix = React.useMemo(() => filterAndSort(liteFix), [liteFix, filterAndSort]);
  const filteredMultiCliPlan = React.useMemo(() => filterAndSort(multiCliPlan), [multiCliPlan, filterAndSort]);

  // Handle URL params to auto-open task drawer
  React.useEffect(() => {
    if (!id || paramsInitialized.current) return;
    if (isLoading) return;

    // Find the session containing this task
    const allSessions = [...litePlan, ...liteFix, ...multiCliPlan];
    const targetSession = allSessions.find(session => session.id === id);

    if (targetSession) {
      paramsInitialized.current = true;

      // Set active tab based on subType
      if (subType === 'lite-plan') setActiveTab('lite-plan');
      else if (subType === 'lite-fix') setActiveTab('lite-fix');
      else if (subType === 'multi-cli-plan') setActiveTab('multi-cli-plan');

      // Expand the session
      setExpandedSessionId(id);

      // Find and select the task
      const task = targetSession.tasks?.find(t => t.task_id === id || t.id === id);
      if (task) {
        setSelectedTask(task);
      }
    }
  }, [id, subType, isLoading, litePlan, liteFix, multiCliPlan]);

  // Toggle sort
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const handleBack = () => {
    navigate('/sessions');
  };

  // Get status badge color
  const getStatusColor = (status?: string) => {
    const statusColors: Record<string, string> = {
      decided: 'success',
      converged: 'success',
      plan_generated: 'success',
      completed: 'success',
      exploring: 'info',
      initialized: 'info',
      analyzing: 'warning',
      debating: 'warning',
      blocked: 'destructive',
      conflict: 'destructive',
    };
    return statusColors[status || ''] || 'secondary';
  };

  // Render lite task card with expandable tasks
  const renderLiteTaskCard = (session: LiteTaskSession) => {
    const isLitePlan = session.type === 'lite-plan';
    const taskCount = session.tasks?.length || 0;
    const isExpanded = expandedSessionId === session.id;

    // Calculate task status distribution (no useMemo - this is a render function, not a component)
    const tasks = session.tasks || [];
    const taskStats = {
      completed: tasks.filter((t) => t.status === 'completed').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
    };

    const firstTask = tasks[0];

    return (
      <div key={session.id}>
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-foreground text-sm tracking-wide uppercase">{session.id}</h3>
                </div>
              </div>
              <Badge variant={isLitePlan ? 'secondary' : 'warning'} className="gap-1 flex-shrink-0">
                {isLitePlan ? <FileEdit className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                {formatMessage({ id: isLitePlan ? 'liteTasks.type.plan' : 'liteTasks.type.fix' })}
              </Badge>
            </div>

            {/* Task preview - first task title */}
            {firstTask?.title && (
              <div className="mb-3 pb-3 border-b border-border/50">
                <p className="text-sm text-foreground line-clamp-1">{firstTask.title}</p>
              </div>
            )}

            {/* Task status distribution */}
            <div className="flex items-center flex-wrap gap-2 mb-3">
              {taskStats.completed > 0 && (
                <Badge variant="success" className="gap-1 text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  {taskStats.completed} {formatMessage({ id: 'liteTasks.status.completed' })}
                </Badge>
              )}
              {taskStats.inProgress > 0 && (
                <Badge variant="warning" className="gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  {taskStats.inProgress} {formatMessage({ id: 'liteTasks.status.inProgress' })}
                </Badge>
              )}
              {taskStats.blocked > 0 && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertCircle className="h-3 w-3" />
                  {taskStats.blocked} {formatMessage({ id: 'liteTasks.status.blocked' })}
                </Badge>
              )}
            </div>

            {/* Date and task count */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {session.createdAt && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
              )}
              {taskCount > 0 && (
                <span className="flex items-center gap-1">
                  <Hash className="h-3.5 w-3.5" />
                  {taskCount} {formatMessage({ id: 'liteTasks.tasksCount' })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Expanded tasks panel with tabs */}
        {isExpanded && session.tasks && session.tasks.length > 0 && (
          <ExpandedSessionPanel
            session={session}
            onTaskClick={setSelectedTask}
          />
        )}
      </div>
    );
  };

  // Render multi-cli plan card
  const renderMultiCliCard = (session: LiteTaskSession) => {
    const metadata = session.metadata || {};
    const latestSynthesis = session.latestSynthesis || {};
    const roundCount = (metadata.roundId as number) || session.roundCount || 1;
    const topicTitle = getI18nText(
      latestSynthesis.title as string | { en?: string; zh?: string } | undefined
    ) || formatMessage({ id: 'liteTasks.discussionTopic' });
    const status = latestSynthesis.status || session.status || 'analyzing';
    const createdAt = (metadata.timestamp as string) || session.createdAt || '';

    // Calculate task status distribution (no useMemo - this is a render function, not a component)
    const tasks = session.tasks || [];
    const taskStats = {
      completed: tasks.filter((t) => t.status === 'completed').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      total: tasks.length,
    };

    const isExpanded = expandedSessionId === session.id;

    return (
      <div key={session.id}>
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-foreground text-sm tracking-wide uppercase">{session.id}</h3>
                </div>
              </div>
              <Badge variant="secondary" className="gap-1 flex-shrink-0">
                <MessagesSquare className="h-3 w-3" />
                {formatMessage({ id: 'liteTasks.type.multiCli' })}
              </Badge>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
              <MessageCircle className="h-4 w-4" />
              <span className="line-clamp-1">{topicTitle}</span>
            </div>

            {/* Task status distribution for multi-cli */}
            {taskStats.total > 0 && (
              <div className="flex items-center flex-wrap gap-2 mb-3">
                {taskStats.completed > 0 && (
                  <Badge variant="success" className="gap-1 text-xs">
                    <CheckCircle2 className="h-3 w-3" />
                    {taskStats.completed} {formatMessage({ id: 'liteTasks.status.completed' })}
                  </Badge>
                )}
                {taskStats.inProgress > 0 && (
                  <Badge variant="warning" className="gap-1 text-xs">
                    <Clock className="h-3 w-3" />
                    {taskStats.inProgress} {formatMessage({ id: 'liteTasks.status.inProgress' })}
                  </Badge>
                )}
                {taskStats.blocked > 0 && (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <AlertCircle className="h-3 w-3" />
                    {taskStats.blocked} {formatMessage({ id: 'liteTasks.status.blocked' })}
                  </Badge>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {createdAt && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(createdAt).toLocaleDateString()}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Repeat className="h-3.5 w-3.5" />
                {roundCount} {formatMessage({ id: 'liteTasks.rounds' })}
              </span>
              <Badge variant={getStatusColor(status) as 'success' | 'info' | 'warning' | 'destructive' | 'secondary'} className="gap-1">
                <Activity className="h-3 w-3" />
                {status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Expanded multi-cli panel with tabs */}
        {isExpanded && (
          <ExpandedMultiCliPanel
            session={session}
            onTaskClick={setSelectedTask}
          />
        )}
      </div>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" disabled>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {formatMessage({ id: 'common.actions.back' })}
          </Button>
          <div className="h-8 w-64 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
        <XCircle className="h-5 w-5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">{formatMessage({ id: 'common.errors.loadFailed' })}</p>
          <p className="text-xs mt-0.5">{error.message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {formatMessage({ id: 'common.actions.retry' })}
        </Button>
      </div>
    );
  }

  const totalSessions = litePlan.length + liteFix.length + multiCliPlan.length;

  return (
    <div className={cn("space-y-6", isImmersiveMode && "h-screen overflow-hidden")}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {formatMessage({ id: 'common.actions.back' })}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {formatMessage({ id: 'liteTasks.title' })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {formatMessage({ id: 'liteTasks.subtitle' }, { count: totalSessions })}
            </p>
          </div>
        </div>
        <button
          onClick={toggleImmersiveMode}
          className={cn(
            'p-2 rounded-md transition-colors',
            isImmersiveMode
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          title={isImmersiveMode ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isImmersiveMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Tabs */}
      <TabsNavigation
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as LiteTaskTab)}
        tabs={[
          {
            value: 'lite-plan',
            label: formatMessage({ id: 'liteTasks.type.plan' }),
            icon: <FileEdit className="h-4 w-4" />,
            badge: <Badge variant="secondary" className="ml-2">{litePlan.length}</Badge>,
          },
          {
            value: 'lite-fix',
            label: formatMessage({ id: 'liteTasks.type.fix' }),
            icon: <Wrench className="h-4 w-4" />,
            badge: <Badge variant="secondary" className="ml-2">{liteFix.length}</Badge>,
          },
          {
            value: 'multi-cli-plan',
            label: formatMessage({ id: 'liteTasks.type.multiCli' }),
            icon: <MessagesSquare className="h-4 w-4" />,
            badge: <Badge variant="secondary" className="ml-2">{multiCliPlan.length}</Badge>,
          },
        ]}
      />

        {/* Search and Sort Toolbar */}
        <div className="mt-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={formatMessage({ id: 'liteTasks.searchPlaceholder' })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Sort Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ListFilter className="h-3.5 w-3.5" />
              {formatMessage({ id: 'liteTasks.sortBy' })}:
            </span>
            <Button
              variant={sortField === 'date' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => toggleSort('date')}
              className="h-8 px-3 text-xs gap-1"
            >
              <Calendar className="h-3.5 w-3.5" />
              {formatMessage({ id: 'liteTasks.sort.date' })}
              {sortField === 'date' && (sortOrder === 'desc' ? <SortDesc className="h-3 w-3" /> : <SortAsc className="h-3 w-3" />)}
            </Button>
            <Button
              variant={sortField === 'name' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => toggleSort('name')}
              className="h-8 px-3 text-xs gap-1"
            >
              {formatMessage({ id: 'liteTasks.sort.name' })}
              {sortField === 'name' && (sortOrder === 'desc' ? <SortDesc className="h-3 w-3" /> : <SortAsc className="h-3 w-3" />)}
            </Button>
            <Button
              variant={sortField === 'tasks' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => toggleSort('tasks')}
              className="h-8 px-3 text-xs gap-1"
            >
              <Hash className="h-3.5 w-3.5" />
              {formatMessage({ id: 'liteTasks.sort.tasks' })}
              {sortField === 'tasks' && (sortOrder === 'desc' ? <SortDesc className="h-3 w-3" /> : <SortAsc className="h-3 w-3" />)}
            </Button>
          </div>
        </div>

        {/* Lite Plan Tab */}
        {activeTab === 'lite-plan' && (
          <div className="mt-4">
            {litePlan.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Zap className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {formatMessage({ id: 'liteTasks.empty.title' }, { type: 'lite-plan' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.empty.message' })}
                </p>
              </div>
            ) : filteredLitePlan.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {formatMessage({ id: 'liteTasks.noResults.title' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.noResults.message' })}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">{filteredLitePlan.map(renderLiteTaskCard)}</div>
            )}
          </div>
        )}

        {/* Lite Fix Tab */}
        {activeTab === 'lite-fix' && (
          <div className="mt-4">
            {liteFix.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Zap className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {formatMessage({ id: 'liteTasks.empty.title' }, { type: 'lite-fix' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.empty.message' })}
                </p>
              </div>
            ) : filteredLiteFix.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {formatMessage({ id: 'liteTasks.noResults.title' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.noResults.message' })}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">{filteredLiteFix.map(renderLiteTaskCard)}</div>
            )}
          </div>
        )}

        {/* Multi-CLI Plan Tab */}
        {activeTab === 'multi-cli-plan' && (
          <div className="mt-4">
            {multiCliPlan.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Zap className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {formatMessage({ id: 'liteTasks.empty.title' }, { type: 'multi-cli-plan' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.empty.message' })}
                </p>
              </div>
            ) : filteredMultiCliPlan.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {formatMessage({ id: 'liteTasks.noResults.title' })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatMessage({ id: 'liteTasks.noResults.message' })}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">{filteredMultiCliPlan.map(renderMultiCliCard)}</div>
            )}
          </div>
        )}

      {/* TaskDrawer */}
      <TaskDrawer
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

export default LiteTasksPage;
