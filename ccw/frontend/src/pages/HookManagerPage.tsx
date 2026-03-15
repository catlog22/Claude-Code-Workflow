// ========================================
// Hook Manager Page
// ========================================
// Full CRUD page for managing CLI hooks

import { useState, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { useWorkflowStore, selectProjectPath } from '@/stores/workflowStore';
import {
  GitFork,
  Plus,
  Search,
  RefreshCw,
  Play,
  Zap,
  Wrench,
  CheckCircle,
  StopCircle,
  Wand2,
  Brain,
  Shield,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { HookCard, HookFormDialog, HookQuickTemplates, HookWizard, type HookCardData, type HookFormData, type HookTriggerType, HOOK_TEMPLATES, type WizardType } from '@/components/hook';
import { useHooks, useToggleHook, useDeleteHook } from '@/hooks';
import { cn } from '@/lib/utils';

// ========== Types ==========

interface HooksByTrigger {
  SessionStart: HookCardData[];
  UserPromptSubmit: HookCardData[];
  PreToolUse: HookCardData[];
  PostToolUse: HookCardData[];
  Stop: HookCardData[];
  Notification: HookCardData[];
  SubagentStart: HookCardData[];
  SubagentStop: HookCardData[];
  PreCompact: HookCardData[];
  SessionEnd: HookCardData[];
  PostToolUseFailure: HookCardData[];
  PermissionRequest: HookCardData[];
}

// ========== Helper Functions ==========

function isHookTriggerType(value: string): value is HookTriggerType {
  return ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionEnd', 'PostToolUseFailure', 'PermissionRequest'].includes(value);
}

function toHookCardData(hook: { name: string; description?: string; enabled: boolean; trigger: string; matcher?: string; command?: string; script?: string; scope?: 'global' | 'project'; index?: number }): HookCardData | null {
  if (!isHookTriggerType(hook.trigger)) {
    return null;
  }
  return {
    name: hook.name,
    description: hook.description,
    enabled: hook.enabled,
    trigger: hook.trigger,
    matcher: hook.matcher,
    command: hook.command || hook.script,
    scope: hook.scope,
    index: hook.index,
  };
}

function groupHooksByTrigger(hooks: HookCardData[]): HooksByTrigger {
  return {
    SessionStart: hooks.filter((h) => h.trigger === 'SessionStart'),
    UserPromptSubmit: hooks.filter((h) => h.trigger === 'UserPromptSubmit'),
    PreToolUse: hooks.filter((h) => h.trigger === 'PreToolUse'),
    PostToolUse: hooks.filter((h) => h.trigger === 'PostToolUse'),
    Stop: hooks.filter((h) => h.trigger === 'Stop'),
    Notification: hooks.filter((h) => h.trigger === 'Notification'),
    SubagentStart: hooks.filter((h) => h.trigger === 'SubagentStart'),
    SubagentStop: hooks.filter((h) => h.trigger === 'SubagentStop'),
    PreCompact: hooks.filter((h) => h.trigger === 'PreCompact'),
    SessionEnd: hooks.filter((h) => h.trigger === 'SessionEnd'),
    PostToolUseFailure: hooks.filter((h) => h.trigger === 'PostToolUseFailure'),
    PermissionRequest: hooks.filter((h) => h.trigger === 'PermissionRequest'),
  };
}

function getTriggerStats(hooksByTrigger: HooksByTrigger) {
  return {
    SessionStart: {
      total: hooksByTrigger.SessionStart.length,
      enabled: hooksByTrigger.SessionStart.filter((h) => h.enabled).length,
    },
    UserPromptSubmit: {
      total: hooksByTrigger.UserPromptSubmit.length,
      enabled: hooksByTrigger.UserPromptSubmit.filter((h) => h.enabled).length,
    },
    PreToolUse: {
      total: hooksByTrigger.PreToolUse.length,
      enabled: hooksByTrigger.PreToolUse.filter((h) => h.enabled).length,
    },
    PostToolUse: {
      total: hooksByTrigger.PostToolUse.length,
      enabled: hooksByTrigger.PostToolUse.filter((h) => h.enabled).length,
    },
    Stop: {
      total: hooksByTrigger.Stop.length,
      enabled: hooksByTrigger.Stop.filter((h) => h.enabled).length,
    },
    Notification: {
      total: hooksByTrigger.Notification.length,
      enabled: hooksByTrigger.Notification.filter((h) => h.enabled).length,
    },
    SubagentStart: {
      total: hooksByTrigger.SubagentStart.length,
      enabled: hooksByTrigger.SubagentStart.filter((h) => h.enabled).length,
    },
    SubagentStop: {
      total: hooksByTrigger.SubagentStop.length,
      enabled: hooksByTrigger.SubagentStop.filter((h) => h.enabled).length,
    },
    PreCompact: {
      total: hooksByTrigger.PreCompact.length,
      enabled: hooksByTrigger.PreCompact.filter((h) => h.enabled).length,
    },
    SessionEnd: {
      total: hooksByTrigger.SessionEnd.length,
      enabled: hooksByTrigger.SessionEnd.filter((h) => h.enabled).length,
    },
    PostToolUseFailure: {
      total: hooksByTrigger.PostToolUseFailure.length,
      enabled: hooksByTrigger.PostToolUseFailure.filter((h) => h.enabled).length,
    },
    PermissionRequest: {
      total: hooksByTrigger.PermissionRequest.length,
      enabled: hooksByTrigger.PermissionRequest.filter((h) => h.enabled).length,
    },
  };
}

// ========== Main Page Component ==========

export function HookManagerPage() {
  const { formatMessage } = useIntl();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTrigger, setSelectedTrigger] = useState<HookTriggerType | 'all'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingHook, setEditingHook] = useState<HookCardData | undefined>();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardType, setWizardType] = useState<WizardType>('memory-update');
  const [expandedHooks, setExpandedHooks] = useState<Set<string>>(new Set());
  const [templatesExpanded, setTemplatesExpanded] = useState(false);
  const [wizardsExpanded, setWizardsExpanded] = useState(false);

  const { hooks, enabledCount, totalCount, isLoading, refetch } = useHooks();
  const { toggleHook } = useToggleHook();
  const { deleteHook } = useDeleteHook();
  const projectPath = useWorkflowStore(selectProjectPath);

  // Convert hooks to HookCardData and filter by search query and trigger type
  const filteredHooks = useMemo(() => {
    let validHooks = hooks.map(toHookCardData).filter((h): h is HookCardData => h !== null);

    // Filter by trigger type
    if (selectedTrigger !== 'all') {
      validHooks = validHooks.filter(h => h.trigger === selectedTrigger);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      validHooks = validHooks.filter(
        (h) =>
          h.name.toLowerCase().includes(query) ||
          (h.description && h.description.toLowerCase().includes(query)) ||
          h.trigger.toLowerCase().includes(query) ||
          (h.command && h.command.toLowerCase().includes(query))
      );
    }

    return validHooks;
  }, [hooks, searchQuery, selectedTrigger]);

  // Group hooks by trigger type
  const hooksByTrigger = useMemo(() => groupHooksByTrigger(filteredHooks), [filteredHooks]);

  // Get stats for each trigger type
  const triggerStats = useMemo(() => getTriggerStats(hooksByTrigger), [hooksByTrigger]);

  // Handlers
  const handleAddClick = () => {
    setDialogMode('create');
    setEditingHook(undefined);
    setDialogOpen(true);
  };

  const handleEditClick = (hook: HookCardData) => {
    setDialogMode('edit');
    setEditingHook(hook);
    setDialogOpen(true);
  };

  const handleDeleteClick = async (hookName: string) => {
    // Find the hook in filteredHooks to get scope and index
    const hook = filteredHooks.find(h => h.name === hookName);
    if (!hook) {
      console.error('Hook not found:', hookName);
      return;
    }
    try {
      await deleteHook({
        name: hook.name,
        scope: hook.scope,
        trigger: hook.trigger,
        index: hook.index,
      });
    } catch (error) {
      console.error('Failed to delete hook:', error);
    }
  };

  const handleSave = async (data: HookFormData) => {
    // This will be implemented when create/update APIs are added
    console.log('Save hook:', data);
    await refetch();
  };

  const handleToggleHookExpand = (hookName: string) => {
    setExpandedHooks((prev) => {
      const next = new Set(prev);
      if (next.has(hookName)) {
        next.delete(hookName);
      } else {
        next.add(hookName);
      }
      return next;
    });
  };

  // ========== Wizard Handlers ==========

  const wizardTypes: Array<{ type: WizardType; icon: typeof Brain; label: string; description: string }> = [
    {
      type: 'memory-update',
      icon: Brain,
      label: formatMessage({ id: 'cliHooks.wizards.memoryUpdate.title' }),
      description: formatMessage({ id: 'cliHooks.wizards.memoryUpdate.shortDescription' }),
    },
    {
      type: 'danger-protection',
      icon: Shield,
      label: formatMessage({ id: 'cliHooks.wizards.dangerProtection.title' }),
      description: formatMessage({ id: 'cliHooks.wizards.dangerProtection.shortDescription' }),
    },
    {
      type: 'skill-context',
      icon: Sparkles,
      label: formatMessage({ id: 'cliHooks.wizards.skillContext.title' }),
      description: formatMessage({ id: 'cliHooks.wizards.skillContext.shortDescription' }),
    },
  ];

  const handleLaunchWizard = (type: WizardType) => {
    setWizardType(type);
    setWizardOpen(true);
  };

  // ========== Quick Templates Logic ==========

  // Determine which templates are already installed
  const installedTemplates = useMemo(() => {
    return HOOK_TEMPLATES.filter(template => {
      return hooks.some(hook => hook.templateId === template.id);
    }).map(t => t.id);
  }, [hooks]);

  // Track per-template installing state
  const [installingTemplateId, setInstallingTemplateId] = useState<string | null>(null);

  const handleInstallTemplate = async (templateId: string) => {
    const template = HOOK_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    setInstallingTemplateId(templateId);
    try {
      // Use backend API to install template
      const response = await fetch('/api/hooks/templates/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          scope: 'project',
          projectPath,
            }),
      });

      if (!response.ok) {
        throw new Error(`Failed to install template: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      await refetch();
    } catch (error) {
      console.error('Failed to install template:', error);
    } finally {
      setInstallingTemplateId(null);
    }
  };

  const FILTER_OPTIONS: Array<{ type: HookTriggerType | 'all'; icon: typeof Zap; label: string }> = [
    { type: 'all', icon: GitFork, label: formatMessage({ id: 'common.all' }) },
    { type: 'SessionStart', icon: Play, label: formatMessage({ id: 'cliHooks.trigger.SessionStart' }) },
    { type: 'UserPromptSubmit', icon: Zap, label: formatMessage({ id: 'cliHooks.trigger.UserPromptSubmit' }) },
    { type: 'PreToolUse', icon: Wrench, label: formatMessage({ id: 'cliHooks.trigger.PreToolUse' }) },
    { type: 'PostToolUse', icon: CheckCircle, label: formatMessage({ id: 'cliHooks.trigger.PostToolUse' }) },
    { type: 'Stop', icon: StopCircle, label: formatMessage({ id: 'cliHooks.trigger.Stop' }) },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GitFork className="w-6 h-6 text-primary" />
            {formatMessage({ id: 'cliHooks.title' })}
          </h1>
          <p className="text-muted-foreground mt-1">
            {formatMessage({ id: 'cliHooks.description' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn('w-4 h-4 mr-1', isLoading && 'animate-spin')} />
            {formatMessage({ id: 'common.actions.refresh' })}
          </Button>
          <Button variant="outline" size="sm" onClick={handleAddClick}>
            <Plus className="w-4 h-4 mr-1" />
            {formatMessage({ id: 'cliHooks.actions.add' })}
          </Button>
          <Button size="sm" onClick={() => handleLaunchWizard('memory-update')} variant="secondary">
            <Wand2 className="w-4 h-4 mr-1" />
            {formatMessage({ id: 'cliHooks.wizards.launch' })}
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="p-4">
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={formatMessage({ id: 'cliHooks.filters.searchPlaceholder' })}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-sm">
                {formatMessage({ id: 'cliHooks.stats.total' }, { count: totalCount })}
              </Badge>
              <Badge variant="default" className="text-sm">
                {formatMessage({ id: 'cliHooks.stats.enabled' }, { count: enabledCount })}
              </Badge>
            </div>
          </div>

          {/* Trigger Type Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {FILTER_OPTIONS.map(({ type, icon: Icon, label }) => {
              const isSelected = selectedTrigger === type;
              const stats = type === 'all'
                ? { enabled: enabledCount, total: totalCount }
                : triggerStats[type as HookTriggerType];

              return (
                <Button
                  key={type}
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedTrigger(type)}
                  className="gap-2"
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  <Badge
                    variant={isSelected ? 'secondary' : 'outline'}
                    className="ml-1"
                  >
                    {stats.enabled}/{stats.total}
                  </Badge>
                </Button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Hook Cards Grid */}
      {filteredHooks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredHooks.map((hook) => (
            <HookCard
              key={hook.name}
              hook={hook}
              isExpanded={expandedHooks.has(hook.name)}
              onToggleExpand={() => handleToggleHookExpand(hook.name)}
              onToggle={toggleHook}
              onEdit={handleEditClick}
              onDelete={handleDeleteClick}
            />
          ))}
        </div>
      )}

      {/* Quick Templates */}
      <Card className="overflow-hidden">
        <div
          className="p-4 cursor-pointer hover:bg-muted/50 transition-colors flex items-center justify-between border-b border-border"
          onClick={() => setTemplatesExpanded(!templatesExpanded)}
        >
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              {formatMessage({ id: 'cliHooks.quickTemplates.title' })}
            </h2>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            {templatesExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </div>
        {templatesExpanded && (
          <div className="p-6">
            <HookQuickTemplates
              onInstallTemplate={handleInstallTemplate}
              installedTemplates={installedTemplates}
              isLoading={!!installingTemplateId}
              installingTemplateId={installingTemplateId}
            />
          </div>
        )}
      </Card>

      {/* Wizard Launchers */}
      <Card className="overflow-hidden">
        <div
          className="p-4 cursor-pointer hover:bg-muted/50 transition-colors flex items-center justify-between"
          onClick={() => setWizardsExpanded(!wizardsExpanded)}
        >
          <div className="flex items-center gap-3">
            <Wand2 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {formatMessage({ id: 'cliHooks.wizards.sectionTitle' })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {formatMessage({ id: 'cliHooks.wizards.sectionDescription' })}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            {wizardsExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </div>
        {wizardsExpanded && (
          <div className="border-t border-border p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {wizardTypes.map(({ type, icon: Icon, label, description }) => (
                <Card key={type} className="p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleLaunchWizard(type)}>
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        {label}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Empty State */}
      {!isLoading && filteredHooks.length === 0 && (
        <Card className="p-12 text-center">
          <GitFork className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {formatMessage({ id: 'cliHooks.empty.title' })}
          </h3>
          <p className="text-muted-foreground mb-6">
            {formatMessage({ id: 'cliHooks.empty.description' })}
          </p>
          <Button onClick={handleAddClick}>
            <Plus className="w-4 h-4 mr-1" />
            {formatMessage({ id: 'cliHooks.actions.addFirst' })}
          </Button>
        </Card>
      )}

      {/* Form Dialog */}
      <HookFormDialog
        mode={dialogMode}
        hook={editingHook}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />

      {/* Hook Wizard */}
      <HookWizard
        wizardType={wizardType}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  );
}

export default HookManagerPage;
