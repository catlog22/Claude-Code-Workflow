import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, RotateCcw } from 'lucide-react';

import {
  WORKFLOWS,
  type Locale,
  type WorkflowComplexity,
  type WorkflowDefinition,
  type WorkflowType,
} from '../lib/workflows';

interface WorkflowSelectorProps {
  locale: Locale;
}

type Step = 'complexity' | 'type' | 'workflow';

type CopyState = 'idle' | 'copied' | 'error';

const COMPLEXITY_ORDER: WorkflowComplexity[] = ['low', 'medium', 'high'];
const TYPE_ORDER: WorkflowType[] = [
  'execution',
  'planning',
  'debugging',
  'testing',
  'analysis',
  'brainstorm',
  'issue',
];

const UI_TEXT = {
  title: {
    en: 'Pick a Workflow',
    zh: '选择工作流',
  },
  subtitle: {
    en: 'A 3-step selector: complexity → type → workflow. Copy the command and run it in CCW.',
    zh: '三步选择：复杂度 → 类型 → 工作流。复制命令后在 CCW 中执行。',
  },
  steps: {
    complexity: { en: 'Complexity', zh: '复杂度' },
    type: { en: 'Type', zh: '类型' },
    workflow: { en: 'Workflow', zh: '工作流' },
  },
  complexity: {
    low: { en: 'Low', zh: '低' },
    medium: { en: 'Medium', zh: '中' },
    high: { en: 'High', zh: '高' },
  },
  complexityHelp: {
    low: {
      en: 'Fast iteration, minimal process',
      zh: '快速迭代，流程最少',
    },
    medium: {
      en: 'Standard session, better traceability',
      zh: '标准 Session，更好可追溯',
    },
    high: {
      en: 'Multi-role exploration / issue pipelines',
      zh: '多角色探索 / Issue 流水线',
    },
  },
  typeLabels: {
    execution: { en: 'Execution', zh: '执行' },
    planning: { en: 'Planning', zh: '规划' },
    debugging: { en: 'Debugging', zh: '调试修复' },
    testing: { en: 'Testing', zh: '测试' },
    analysis: { en: 'Analysis', zh: '分析' },
    brainstorm: { en: 'Brainstorm', zh: '头脑风暴' },
    issue: { en: 'Issue', zh: 'Issue 流程' },
  },
  actions: {
    back: { en: 'Back', zh: '返回' },
    reset: { en: 'Start over', zh: '重新开始' },
    copy: { en: 'Copy', zh: '复制' },
    copied: { en: 'Copied', zh: '已复制' },
    copyError: { en: 'Copy failed', zh: '复制失败' },
  },
  selected: {
    title: { en: 'Selected command', zh: '已选命令' },
    hint: {
      en: 'Paste this into your chat input (slash command) to run the workflow.',
      zh: '将此内容粘贴到聊天输入框（Slash Command）以运行工作流。',
    },
  },
  empty: {
    en: 'No workflows match the current filters.',
    zh: '当前筛选条件下没有匹配的工作流。',
  },
};

function getTypeBadgeClasses(type: WorkflowType) {
  switch (type) {
    case 'execution':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'planning':
      return 'bg-accent/10 text-accent border-accent/20';
    case 'debugging':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300';
    case 'testing':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300';
    case 'analysis':
      return 'bg-secondary text-secondary-foreground border-border';
    case 'brainstorm':
      return 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300';
    case 'issue':
      return 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', 'true');

    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export default function WorkflowSelector({ locale }: WorkflowSelectorProps) {
  const [step, setStep] = useState<Step>('complexity');
  const [selectedComplexity, setSelectedComplexity] = useState<WorkflowComplexity | null>(null);
  const [selectedType, setSelectedType] = useState<WorkflowType | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [animateIn, setAnimateIn] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  const availableWorkflows = useMemo(() => {
    return WORKFLOWS.filter(workflow => {
      if (selectedComplexity && workflow.complexity !== selectedComplexity) return false;
      if (selectedType && workflow.type !== selectedType) return false;
      return true;
    });
  }, [selectedComplexity, selectedType]);

  const availableTypes = useMemo(() => {
    const typeSet = new Set<WorkflowType>();
    for (const workflow of WORKFLOWS) {
      if (selectedComplexity && workflow.complexity !== selectedComplexity) continue;
      typeSet.add(workflow.type);
    }
    return TYPE_ORDER.filter(type => typeSet.has(type));
  }, [selectedComplexity]);

  const selectedWorkflow: WorkflowDefinition | null = useMemo(() => {
    if (!selectedWorkflowId) return null;
    return WORKFLOWS.find(w => w.id === selectedWorkflowId) ?? null;
  }, [selectedWorkflowId]);

  const selectedCommand = selectedWorkflow?.command[locale] ?? '';

  useEffect(() => {
    setAnimateIn(false);
    const id = window.requestAnimationFrame(() => setAnimateIn(true));
    return () => window.cancelAnimationFrame(id);
  }, [step]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const goBack = () => {
    setCopyState('idle');
    if (step === 'workflow') {
      setStep('type');
      setSelectedWorkflowId(null);
      return;
    }
    if (step === 'type') {
      setStep('complexity');
      setSelectedType(null);
      setSelectedWorkflowId(null);
      return;
    }
  };

  const reset = () => {
    setStep('complexity');
    setSelectedComplexity(null);
    setSelectedType(null);
    setSelectedWorkflowId(null);
    setCopyState('idle');
  };

  const handleCopy = async () => {
    if (!selectedCommand.trim()) return;

    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }

    const ok = await copyToClipboard(selectedCommand);
    setCopyState(ok ? 'copied' : 'error');

    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimerRef.current = null;
    }, 1500);
  };

  const stepPanelClassName = [
    'transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none',
    animateIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
  ].join(' ');

  return (
    <section className="border border-border rounded-xl bg-background shadow-sm">
      <div className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">{UI_TEXT.title[locale]}</h2>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-prose">
              {UI_TEXT.subtitle[locale]}
            </p>
          </div>

          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors motion-reduce:transition-none"
          >
            <RotateCcw className="w-4 h-4" />
            {UI_TEXT.actions.reset[locale]}
          </button>
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm">
          {(['complexity', 'type', 'workflow'] as const).map((stepKey, index) => {
            const isActive = step === stepKey;
            const isDone =
              (stepKey === 'complexity' && selectedComplexity) ||
              (stepKey === 'type' && selectedComplexity && selectedType) ||
              (stepKey === 'workflow' && selectedWorkflowId);

            return (
              <div key={stepKey} className="flex items-center gap-2">
                <div
                  className={[
                    'w-8 h-8 rounded-full flex items-center justify-center border text-xs font-semibold',
                    isActive ? 'border-primary text-primary' : 'border-border text-muted-foreground',
                    isDone ? 'bg-primary/10' : 'bg-background',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {index + 1}
                </div>
                <span className={isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                  {UI_TEXT.steps[stepKey][locale]}
                </span>
                {index < 2 && <span className="text-muted-foreground/60">→</span>}
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          {step !== 'complexity' && (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors motion-reduce:transition-none"
            >
              <ArrowLeft className="w-4 h-4" />
              {UI_TEXT.actions.back[locale]}
            </button>
          )}
        </div>

        <div className="mt-5">
          {step === 'complexity' && (
            <div className={stepPanelClassName}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {COMPLEXITY_ORDER.map(level => {
                  const isSelected = selectedComplexity === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        setSelectedComplexity(level);
                        setSelectedType(null);
                        setSelectedWorkflowId(null);
                        setCopyState('idle');
                        setStep('type');
                      }}
                      className={[
                        'text-left p-4 rounded-lg border transition-all duration-200',
                        'hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40',
                        'motion-reduce:transition-none motion-reduce:transform-none',
                        isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-lg font-semibold">
                          {UI_TEXT.complexity[level][locale]}
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-primary" />}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {UI_TEXT.complexityHelp[level][locale]}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'type' && (
            <div className={stepPanelClassName}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {availableTypes.map(type => {
                  const isSelected = selectedType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setSelectedType(type);
                        setSelectedWorkflowId(null);
                        setCopyState('idle');
                        setStep('workflow');
                      }}
                      className={[
                        'text-left p-3 rounded-lg border transition-all duration-200',
                        'hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40',
                        'motion-reduce:transition-none motion-reduce:transform-none',
                        isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                      ].join(' ')}
                    >
                      <div className="text-sm font-medium">
                        {UI_TEXT.typeLabels[type][locale]}
                      </div>
                      <div className="mt-2">
                        <span className={['inline-flex items-center px-2 py-0.5 text-xs rounded-full border', getTypeBadgeClasses(type)].join(' ')}>
                          {availableWorkflows.filter(w => w.type === type).length}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'workflow' && (
            <div className={stepPanelClassName}>
              {availableWorkflows.length === 0 ? (
                <div className="p-4 border border-border rounded-lg text-sm text-muted-foreground">
                  {UI_TEXT.empty[locale]}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {availableWorkflows.map(workflow => {
                    const isSelected = selectedWorkflowId === workflow.id;
                    return (
                      <button
                        key={workflow.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorkflowId(workflow.id);
                          setCopyState('idle');
                        }}
                        data-plausible-event="workflow-select"
                        className={[
                          'text-left p-4 rounded-lg border transition-all duration-200',
                          'hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40',
                          'motion-reduce:transition-none motion-reduce:transform-none',
                          isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold">{workflow.name}</div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {workflow.description[locale]}
                            </p>
                          </div>
                          {isSelected && <Check className="w-5 h-5 text-primary mt-0.5" />}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-full border bg-muted text-muted-foreground">
                            {UI_TEXT.complexity[workflow.complexity][locale]}
                          </span>
                          <span
                            className={[
                              'inline-flex items-center px-2 py-0.5 text-xs rounded-full border',
                              getTypeBadgeClasses(workflow.type),
                            ].join(' ')}
                          >
                            {UI_TEXT.typeLabels[workflow.type][locale]}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedWorkflow && (
                <div className="mt-6 border border-border rounded-lg bg-muted/20">
                  <div className="p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{UI_TEXT.selected.title[locale]}</h3>
                      <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-prose">
                        {UI_TEXT.selected.hint[locale]}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopy}
                      data-plausible-event="code-copy"
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors motion-reduce:transition-none"
                      aria-live="polite"
                    >
                      {copyState === 'copied' ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      {copyState === 'copied'
                        ? UI_TEXT.actions.copied[locale]
                        : copyState === 'error'
                          ? UI_TEXT.actions.copyError[locale]
                          : UI_TEXT.actions.copy[locale]}
                    </button>
                  </div>

                  <div className="px-4 sm:px-5 pb-5">
                    <pre className="text-sm overflow-x-auto border border-border rounded-md bg-background p-4">
                      <code>{selectedCommand}</code>
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
