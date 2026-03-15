// ========================================
// Hook Wizard Component
// ========================================
// Multi-step wizard for creating common hook patterns

import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useWorkflowStore, selectProjectPath } from '@/stores/workflowStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  ChevronLeft,
  ChevronRight,
  Brain,
  Shield,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  Plus,
  Trash2,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSkills, type Skill, type SkillsResponse, saveHook } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  detect,
  getShell,
  getShellName,
  checkCompatibility,
  getPlatformName,
  DEFAULT_PLATFORM_REQUIREMENTS,
  type Platform,
} from '@/utils/platformUtils';

// ========== Types ==========

export type WizardType = 'memory-update' | 'danger-protection' | 'skill-context';

type WizardStep = 1 | 2 | 3;

export interface HookWizardProps {
  wizardType: WizardType;
  open: boolean;
  onClose: () => void;
}

interface MemoryUpdateConfig {
  tool: 'gemini' | 'qwen' | 'codex' | 'opencode';
  threshold: number;
  timeout: number;
}

interface DangerProtectionConfig {
  selectedOptions: string[];
}

interface SkillContextConfig {
  mode: 'keyword' | 'auto';
  skillConfigs: Array<{ skill: string; keywords: string }>;
}

// ========== Hook Templates ==========
// Templates are now defined in backend: ccw/src/core/hooks/hook-templates.ts
// All templates use `ccw hook template exec <id> --stdin` format
// This avoids Windows Git Bash quote handling issues

// Template IDs that map to backend templates
const TEMPLATE_IDS = {
  'memory-update-queue': 'memory-auto-compress',
  'danger-bash-confirm': 'danger-bash-confirm',
  'danger-file-protection': 'danger-file-protection',
  'danger-git-destructive': 'danger-git-destructive',
  'danger-network-confirm': 'danger-network-confirm',
  'danger-system-paths': 'danger-system-paths',
  'danger-permission-change': 'danger-permission-change',
} as const;

// Danger protection option definitions
const DANGER_OPTIONS = [
  { id: 'bash-confirm', templateId: 'danger-bash-confirm', labelKey: 'cliHooks.wizards.dangerProtection.options.bashConfirm', descKey: 'cliHooks.wizards.dangerProtection.options.bashConfirmDesc' },
  { id: 'file-protection', templateId: 'danger-file-protection', labelKey: 'cliHooks.wizards.dangerProtection.options.fileProtection', descKey: 'cliHooks.wizards.dangerProtection.options.fileProtectionDesc' },
  { id: 'git-destructive', templateId: 'danger-git-destructive', labelKey: 'cliHooks.wizards.dangerProtection.options.gitDestructive', descKey: 'cliHooks.wizards.dangerProtection.options.gitDestructiveDesc' },
  { id: 'network-confirm', templateId: 'danger-network-confirm', labelKey: 'cliHooks.wizards.dangerProtection.options.networkConfirm', descKey: 'cliHooks.wizards.dangerProtection.options.networkConfirmDesc' },
  { id: 'system-paths', templateId: 'danger-system-paths', labelKey: 'cliHooks.wizards.dangerProtection.options.systemPaths', descKey: 'cliHooks.wizards.dangerProtection.options.systemPathsDesc' },
  { id: 'permission-change', templateId: 'danger-permission-change', labelKey: 'cliHooks.wizards.dangerProtection.options.permissionChange', descKey: 'cliHooks.wizards.dangerProtection.options.permissionChangeDesc' },
] as const;

// ========== Wizard Definitions ==========

const WIZARD_METADATA = {
  'memory-update': {
    title: 'cliHooks.wizards.memoryUpdate.title',
    description: 'cliHooks.wizards.memoryUpdate.description',
    icon: Brain,
    trigger: 'Stop' as const,
    platformRequirements: DEFAULT_PLATFORM_REQUIREMENTS['memory-update'],
  },
  'danger-protection': {
    title: 'cliHooks.wizards.dangerProtection.title',
    description: 'cliHooks.wizards.dangerProtection.description',
    icon: Shield,
    trigger: 'PreToolUse' as const,
    platformRequirements: DEFAULT_PLATFORM_REQUIREMENTS['danger-protection'],
  },
  'skill-context': {
    title: 'cliHooks.wizards.skillContext.title',
    description: 'cliHooks.wizards.skillContext.description',
    icon: Sparkles,
    trigger: 'UserPromptSubmit' as const,
    platformRequirements: DEFAULT_PLATFORM_REQUIREMENTS['skill-context'],
  },
} as const;

// ========== Main Component ==========

export function HookWizard({
  wizardType,
  open,
  onClose,
}: HookWizardProps) {
  const { formatMessage } = useIntl();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [detectedPlatform, setDetectedPlatform] = useState<Platform>('linux');
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [saving, setSaving] = useState(false);
  const projectPath = useWorkflowStore(selectProjectPath);

  // Fetch available skills for skill-context wizard
  const { data: skillsData, isLoading: skillsLoading } = useQuery<SkillsResponse>({
    queryKey: ['skills'],
    queryFn: () => fetchSkills(),
    enabled: open && wizardType === 'skill-context',
  });

  // Detect platform on mount
  useEffect(() => {
    if (open) {
      setDetectedPlatform(detect());
    }
  }, [open]);

  // Wizard configuration state
  const [memoryConfig, setMemoryConfig] = useState<MemoryUpdateConfig>({
    tool: 'gemini',
    threshold: 5,
    timeout: 300,
  });

  const [dangerConfig, setDangerConfig] = useState<DangerProtectionConfig>({
    selectedOptions: ['bash-confirm', 'file-protection', 'git-destructive'],
  });

  const [skillConfig, setSkillConfig] = useState<SkillContextConfig>({
    mode: 'keyword',
    skillConfigs: [{ skill: '', keywords: '' }],
  });

  // Check platform compatibility
  const wizardMetadata = WIZARD_METADATA[wizardType];
  const compatibilityCheck = checkCompatibility(
    wizardMetadata.platformRequirements,
    detectedPlatform
  );

  // Handlers
  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep((prev) => (prev + 1) as WizardStep);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const handleClose = () => {
    setCurrentStep(1);
    onClose();
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      switch (wizardType) {
        case 'memory-update': {
          // Use backend template API to install memory template
          const response = await fetch('/api/hooks/templates/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              templateId: 'memory-auto-compress',
              scope,
              projectPath,
            }),
          });
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || 'Failed to install template');
          }
          break;
        }

        case 'danger-protection': {
          // Install each selected protection template via backend API
          for (const optionId of dangerConfig.selectedOptions) {
            const option = DANGER_OPTIONS.find(o => o.id === optionId);
            if (!option) continue;
            const templateId = TEMPLATE_IDS[option.templateId as keyof typeof TEMPLATE_IDS] || option.templateId;

            const response = await fetch('/api/hooks/templates/install', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                templateId,
                scope,
                projectPath,
              }),
            });
            const result = await response.json();
            if (!result.success) {
              console.warn(`Failed to install template ${templateId}:`, result.error);
            }
          }
          break;
        }

        case 'skill-context': {
          // Use ccw hook command directly for skill context
          const hookData = skillConfig.mode === 'auto'
            ? {
                _templateId: 'skill-context-auto',
                matcher: '',
                hooks: [{
                  type: 'command',
                  command: 'ccw hook keyword --stdin',
                }],
              }
            : {
                _templateId: 'skill-context-keyword',
                matcher: '',
                hooks: [{
                  type: 'command',
                  command: 'ccw hook keyword --stdin',
                }],
              };
          await saveHook(scope, 'UserPromptSubmit', hookData);
          break;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['hooks'] });
      handleClose();
    } catch (err) {
      console.error('Failed to create hook:', err);
    } finally {
      setSaving(false);
    }
  };

  // ========== Step Renderers ==========

  const renderStep1 = () => {
    const WizardIcon = WIZARD_METADATA[wizardType].icon;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b">
          <div className="p-3 rounded-lg bg-primary/10">
            <WizardIcon className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">
              {formatMessage({ id: WIZARD_METADATA[wizardType].title })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {formatMessage({ id: WIZARD_METADATA[wizardType].description })}
            </p>
          </div>
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className={cn(
              'w-5 h-5',
              compatibilityCheck.compatible ? 'text-green-500' : 'text-destructive'
            )} />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {formatMessage({ id: 'cliHooks.wizards.platform.detected' })}
              </p>
              <p className="text-xs text-muted-foreground">
                {getPlatformName(detectedPlatform)} ({getShellName(getShell(detectedPlatform))})
              </p>
            </div>
            <Badge variant={compatibilityCheck.compatible ? 'default' : 'destructive'}>
              {compatibilityCheck.compatible
                ? formatMessage({ id: 'cliHooks.wizards.platform.compatible' })
                : formatMessage({ id: 'cliHooks.wizards.platform.incompatible' })
              }
            </Badge>
          </div>

          {!compatibilityCheck.compatible && compatibilityCheck.issues.length > 0 && (
            <div className="mt-3 flex items-start gap-2 p-3 bg-destructive/10 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">
                  {formatMessage({ id: 'cliHooks.wizards.platform.compatibilityError' })}
                </p>
                <ul className="mt-1 space-y-1">
                  {compatibilityCheck.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-destructive/80">{issue}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {compatibilityCheck.warnings.length > 0 && (
            <div className="mt-3 flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-600">
                  {formatMessage({ id: 'cliHooks.wizards.platform.compatibilityWarning' })}
                </p>
                <ul className="mt-1 space-y-1">
                  {compatibilityCheck.warnings.map((warning, i) => (
                    <li key={i} className="text-xs text-yellow-600/80">{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-sm text-muted-foreground mb-2">
            {formatMessage({ id: 'cliHooks.wizards.steps.triggerEvent' })}
          </p>
          <Badge variant="secondary">
            {formatMessage({ id: `cliHooks.trigger.${wizardMetadata.trigger}` })}
          </Badge>
        </Card>
      </div>
    );
  };

  const renderStep2 = () => {
    switch (wizardType) {
      case 'memory-update':
        return renderMemoryUpdateConfig();
      case 'danger-protection':
        return renderDangerProtectionConfig();
      case 'skill-context':
        return renderSkillContextConfig();
      default:
        return null;
    }
  };

  const renderStep3 = () => {
    return (
      <div className="space-y-4">
        <div className="text-center pb-4 border-b">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground">
            {formatMessage({ id: 'cliHooks.wizards.steps.review.title' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatMessage({ id: 'cliHooks.wizards.steps.review.description' })}
          </p>
        </div>

        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {formatMessage({ id: 'cliHooks.wizards.steps.review.hookType' })}
            </span>
            <span className="text-sm font-medium text-foreground">
              {formatMessage({ id: WIZARD_METADATA[wizardType].title })}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {formatMessage({ id: 'cliHooks.wizards.steps.review.trigger' })}
            </span>
            <Badge variant="secondary" className="text-xs">
              {formatMessage({ id: `cliHooks.trigger.${wizardMetadata.trigger}` })}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {formatMessage({ id: 'cliHooks.wizards.steps.review.platform' })}
            </span>
            <span className="text-sm text-foreground">
              {getPlatformName(detectedPlatform)}
            </span>
          </div>

          {renderConfigSummary()}
        </Card>

        {/* Scope Selection */}
        <Card className="p-4">
          <p className="text-sm font-medium text-foreground mb-3">
            {formatMessage({ id: 'cliHooks.wizards.steps.review.installTo' })}
          </p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="wizardScope"
                value="project"
                checked={scope === 'project'}
                onChange={() => setScope('project')}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">
                {formatMessage({ id: 'cliHooks.wizards.steps.review.scopeProject' })}
              </span>
              <span className="text-xs text-muted-foreground">(.claude/settings.json)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="wizardScope"
                value="global"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">
                {formatMessage({ id: 'cliHooks.wizards.steps.review.scopeGlobal' })}
              </span>
              <span className="text-xs text-muted-foreground">(~/.claude/settings.json)</span>
            </label>
          </div>
        </Card>

        {/* Command Preview */}
        <Card className="p-4">
          <p className="text-xs text-muted-foreground mb-2">
            {formatMessage({ id: 'cliHooks.wizards.steps.review.commandPreview' })}
          </p>
          <pre className="text-xs font-mono bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
            {getPreviewCommand()}
          </pre>
        </Card>
      </div>
    );
  };

  // ========== Configuration Renderers ==========

  const renderMemoryUpdateConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-foreground">
          {formatMessage({ id: 'cliHooks.wizards.memoryUpdate.cliTool' })}
        </label>
        <Select
          value={memoryConfig.tool}
          onValueChange={(value: MemoryUpdateConfig['tool']) => setMemoryConfig({ ...memoryConfig, tool: value })}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini">Gemini</SelectItem>
            <SelectItem value="qwen">Qwen</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="opencode">OpenCode</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {formatMessage({ id: 'cliHooks.wizards.memoryUpdate.cliToolHelp' })}
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">
          {formatMessage({ id: 'cliHooks.wizards.memoryUpdate.threshold' })}
        </label>
        <Input
          type="number"
          value={memoryConfig.threshold}
          onChange={(e) => setMemoryConfig({ ...memoryConfig, threshold: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) })}
          min={1}
          max={20}
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {formatMessage({ id: 'cliHooks.wizards.memoryUpdate.thresholdHelp' })}
        </p>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">
          {formatMessage({ id: 'cliHooks.wizards.memoryUpdate.timeout' })}
        </label>
        <Input
          type="number"
          value={memoryConfig.timeout}
          onChange={(e) => setMemoryConfig({ ...memoryConfig, timeout: Math.max(60, Math.min(1800, parseInt(e.target.value) || 60)) })}
          min={60}
          max={1800}
          step={60}
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {formatMessage({ id: 'cliHooks.wizards.memoryUpdate.timeoutHelp' })}
        </p>
      </div>
    </div>
  );

  const renderDangerProtectionConfig = () => {
    const toggleOption = (optionId: string) => {
      setDangerConfig(prev => {
        const selected = prev.selectedOptions.includes(optionId)
          ? prev.selectedOptions.filter(id => id !== optionId)
          : [...prev.selectedOptions, optionId];
        return { selectedOptions: selected };
      });
    };

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {formatMessage({ id: 'cliHooks.wizards.dangerProtection.selectProtections' })}
        </p>
        {DANGER_OPTIONS.map(option => (
          <label
            key={option.id}
            className={cn(
              'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              dangerConfig.selectedOptions.includes(option.id)
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'
            )}
          >
            <input
              type="checkbox"
              checked={dangerConfig.selectedOptions.includes(option.id)}
              onChange={() => toggleOption(option.id)}
              className="mt-0.5 accent-primary"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {formatMessage({ id: option.labelKey })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatMessage({ id: option.descKey })}
              </p>
            </div>
          </label>
        ))}
      </div>
    );
  };

  const renderSkillContextConfig = () => {
    const skills: Skill[] = skillsData?.skills ?? [];

    const addConfig = () => {
      setSkillConfig(prev => ({
        ...prev,
        skillConfigs: [...prev.skillConfigs, { skill: '', keywords: '' }],
      }));
    };

    const removeConfig = (index: number) => {
      setSkillConfig(prev => ({
        ...prev,
        skillConfigs: prev.skillConfigs.filter((_, i) => i !== index),
      }));
    };

    const updateConfig = (index: number, field: 'skill' | 'keywords', value: string) => {
      setSkillConfig(prev => {
        const newConfigs = [...prev.skillConfigs];
        newConfigs[index] = { ...newConfigs[index], [field]: value };
        return { ...prev, skillConfigs: newConfigs };
      });
    };

    return (
      <div className="space-y-4">
        {/* Mode Selection */}
        <div>
          <label className="text-sm font-medium text-foreground">
            {formatMessage({ id: 'cliHooks.wizards.skillContext.mode' })}
          </label>
          <div className="flex gap-3 mt-2">
            <label className={cn(
              'flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
              skillConfig.mode === 'keyword' ? 'border-primary bg-primary/5' : 'border-border'
            )}>
              <input
                type="radio"
                name="skillMode"
                value="keyword"
                checked={skillConfig.mode === 'keyword'}
                onChange={() => setSkillConfig(prev => ({ ...prev, mode: 'keyword' }))}
                className="accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{formatMessage({ id: 'cliHooks.wizards.skillContext.modeKeyword' })}</p>
                <p className="text-xs text-muted-foreground">{formatMessage({ id: 'cliHooks.wizards.skillContext.modeKeywordDesc' })}</p>
              </div>
            </label>
            <label className={cn(
              'flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
              skillConfig.mode === 'auto' ? 'border-primary bg-primary/5' : 'border-border'
            )}>
              <input
                type="radio"
                name="skillMode"
                value="auto"
                checked={skillConfig.mode === 'auto'}
                onChange={() => setSkillConfig(prev => ({ ...prev, mode: 'auto' }))}
                className="accent-primary"
              />
              <div>
                <p className="text-sm font-medium">{formatMessage({ id: 'cliHooks.wizards.skillContext.modeAuto' })}</p>
                <p className="text-xs text-muted-foreground">{formatMessage({ id: 'cliHooks.wizards.skillContext.modeAutoDesc' })}</p>
              </div>
            </label>
          </div>
        </div>

        {/* Keyword mode: skill config list */}
        {skillConfig.mode === 'keyword' && (
          <>
            {skillsLoading ? (
              <p className="text-sm text-muted-foreground">
                {formatMessage({ id: 'cliHooks.wizards.skillContext.loadingSkills' })}
              </p>
            ) : (
              <div className="space-y-3">
                {skillConfig.skillConfigs.map((config, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select value={config.skill} onValueChange={(value) => updateConfig(index, 'skill', value)}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder={formatMessage({ id: 'cliHooks.wizards.skillContext.selectSkill' })} />
                      </SelectTrigger>
                      <SelectContent>
                        {skills.map((skill) => (
                          <SelectItem key={skill.name} value={skill.name}>
                            {skill.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={config.keywords}
                      onChange={(e) => updateConfig(index, 'keywords', e.target.value)}
                      placeholder={formatMessage({ id: 'cliHooks.wizards.skillContext.keywordsPlaceholder' })}
                      className="flex-1"
                    />
                    {skillConfig.skillConfigs.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeConfig(index)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addConfig} className="w-full">
                  <Plus className="w-4 h-4 mr-1" />
                  {formatMessage({ id: 'cliHooks.wizards.skillContext.addPair' })}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Auto mode: info display */}
        {skillConfig.mode === 'auto' && (
          <Card className="p-4 bg-muted/30">
            <p className="text-sm text-muted-foreground">
              {formatMessage({ id: 'cliHooks.wizards.skillContext.autoDescription' })}
            </p>
            {!skillsLoading && skills.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {skills.map(s => (
                  <Badge key={s.name} variant="secondary" className="text-xs">{s.name}</Badge>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    );
  };

  // ========== Config Summary ==========

  const renderConfigSummary = () => {
    switch (wizardType) {
      case 'memory-update':
        return (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">CLI Tool</span>
              <Badge variant="secondary">{memoryConfig.tool}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Threshold</span>
              <span>{memoryConfig.threshold} paths</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Timeout</span>
              <span>{memoryConfig.timeout}s</span>
            </div>
          </div>
        );

      case 'danger-protection':
        return (
          <div className="space-y-2 text-sm">
            <span className="text-muted-foreground">
              {formatMessage({ id: 'cliHooks.wizards.dangerProtection.selectedProtections' })}:
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {dangerConfig.selectedOptions.map(id => {
                const opt = DANGER_OPTIONS.find(o => o.id === id);
                return opt ? (
                  <Badge key={id} variant="secondary" className="text-xs">
                    {formatMessage({ id: opt.labelKey })}
                  </Badge>
                ) : null;
              })}
            </div>
          </div>
        );

      case 'skill-context':
        return (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {formatMessage({ id: 'cliHooks.wizards.skillContext.mode' })}
              </span>
              <Badge variant="secondary">
                {skillConfig.mode === 'auto'
                  ? formatMessage({ id: 'cliHooks.wizards.skillContext.modeAuto' })
                  : formatMessage({ id: 'cliHooks.wizards.skillContext.modeKeyword' })
                }
              </Badge>
            </div>
            {skillConfig.mode === 'keyword' && (
              <div>
                <span className="text-muted-foreground">
                  {formatMessage({ id: 'cliHooks.wizards.skillContext.keywordMappings' })}:
                </span>
                <div className="mt-1 space-y-1">
                  {skillConfig.skillConfigs
                    .filter(c => c.skill && c.keywords)
                    .map((config, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline">{config.keywords}</Badge>
                        <span className="text-muted-foreground">{'->'}</span>
                        <Badge variant="secondary">{config.skill}</Badge>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ========== Command Preview ==========

  const getPreviewCommand = (): string => {
    switch (wizardType) {
      case 'memory-update': {
        return `ccw hook template exec memory-auto-compress --stdin`;
      }
      case 'danger-protection': {
        const templates = dangerConfig.selectedOptions
          .map(id => DANGER_OPTIONS.find(o => o.id === id))
          .filter(Boolean)
          .map(opt => {
            const templateId = TEMPLATE_IDS[opt!.templateId as keyof typeof TEMPLATE_IDS] || opt!.templateId;
            return `ccw hook template exec ${templateId} --stdin`;
          });
        return templates.length > 0
          ? templates.join('\n')
          : '# No protections selected';
      }
      case 'skill-context': {
        return `ccw hook keyword --stdin`;
      }
      default:
        return '';
    }
  };

  // ========== Navigation ==========

  const renderNavigation = () => (
    <DialogFooter className="gap-2">
      {currentStep > 1 && (
        <Button variant="outline" onClick={handlePrevious} disabled={saving}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          {formatMessage({ id: 'cliHooks.wizards.navigation.previous' })}
        </Button>
      )}
      {currentStep < 3 ? (
        <Button onClick={handleNext} disabled={!compatibilityCheck.compatible}>
          {formatMessage({ id: 'cliHooks.wizards.navigation.next' })}
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      ) : (
        <Button onClick={handleComplete} disabled={saving}>
          {saving
            ? formatMessage({ id: 'cliHooks.wizards.navigation.creating' })
            : formatMessage({ id: 'cliHooks.wizards.navigation.create' })
          }
        </Button>
      )}
    </DialogFooter>
  );

  // ========== Step Indicator ==========

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 pb-4">
      {[1, 2, 3].map((step) => (
        <div key={step} className="flex items-center">
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
              currentStep === step
                ? 'bg-primary text-primary-foreground'
                : currentStep > step
                ? 'bg-green-500 text-white'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {currentStep > step ? <CheckCircle className="w-4 h-4" /> : step}
          </div>
          {step < 3 && (
            <div
              className={cn(
                'w-12 h-0.5 mx-1',
                currentStep > step ? 'bg-green-500' : 'bg-muted'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {formatMessage({ id: 'cliHooks.wizards.title' })}
          </DialogTitle>
        </DialogHeader>

        <div className="w-full bg-muted h-1 rounded-full my-4">
          <div
            className="bg-primary h-1 rounded-full transition-all duration-300"
            style={{ width: `${(currentStep / 3) * 100}%` }}
          />
        </div>

        {renderStepIndicator()}

        <div className="min-h-[300px]">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </div>

        {renderNavigation()}
      </DialogContent>
    </Dialog>
  );
}

export default HookWizard;
