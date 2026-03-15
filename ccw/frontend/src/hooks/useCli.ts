// ========================================
// useCliEndpoints Hook
// ========================================
// TanStack Query hooks for CLI endpoint management

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatMessage } from '../hooks/useLocale';
import { useNotifications } from '../hooks/useNotifications';
import { sanitizeErrorMessage } from '../utils/errorSanitizer';
import {
  fetchCliEndpoints,
  toggleCliEndpoint,
  createCliEndpoint,
  updateCliEndpoint,
  deleteCliEndpoint,
  type CliEndpoint,
  type CliEndpointsResponse,
} from '../lib/api';
import { useWorkflowStore, selectProjectPath } from '@/stores/workflowStore';
import { workspaceQueryKeys } from '@/lib/queryKeys';

// Query key factory
export const cliEndpointsKeys = {
  all: ['cliEndpoints'] as const,
  lists: () => [...cliEndpointsKeys.all, 'list'] as const,
};

const STALE_TIME = 2 * 60 * 1000;

export interface UseCliEndpointsOptions {
  staleTime?: number;
  enabled?: boolean;
}

export interface UseCliEndpointsReturn {
  endpoints: CliEndpoint[];
  litellmEndpoints: CliEndpoint[];
  customEndpoints: CliEndpoint[];
  wrapperEndpoints: CliEndpoint[];
  totalCount: number;
  enabledCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  invalidate: () => Promise<void>;
}

export function useCliEndpoints(options: UseCliEndpointsOptions = {}): UseCliEndpointsReturn {
  const { staleTime = STALE_TIME, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: cliEndpointsKeys.lists(),
    queryFn: fetchCliEndpoints,
    staleTime,
    enabled,
    retry: 2,
  });

  const endpoints = query.data?.endpoints ?? [];
  const enabledEndpoints = endpoints.filter((e) => e.enabled);

  const litellmEndpoints = endpoints.filter((e) => e.type === 'litellm');
  const customEndpoints = endpoints.filter((e) => e.type === 'custom');
  const wrapperEndpoints = endpoints.filter((e) => e.type === 'wrapper');

  const refetch = async () => {
    await query.refetch();
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: cliEndpointsKeys.all });
  };

  return {
    endpoints,
    litellmEndpoints,
    customEndpoints,
    wrapperEndpoints,
    totalCount: endpoints.length,
    enabledCount: enabledEndpoints.length,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch,
    invalidate,
  };
}

export function useToggleCliEndpoint() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ endpointId, enabled }: { endpointId: string; enabled: boolean }) =>
      toggleCliEndpoint(endpointId, enabled),
    onMutate: async ({ endpointId, enabled }) => {
      await queryClient.cancelQueries({ queryKey: cliEndpointsKeys.all });
      const previousEndpoints = queryClient.getQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists());

      queryClient.setQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists(), (old) => {
        if (!old) return old;
        return {
          endpoints: old.endpoints.map((e) => (e.id === endpointId ? { ...e, enabled } : e)),
        };
      });

      return { previousEndpoints };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousEndpoints) {
        queryClient.setQueryData(cliEndpointsKeys.lists(), context.previousEndpoints);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliEndpointsKeys.all });
    },
  });

  return {
    toggleEndpoint: (endpointId: string, enabled: boolean) => mutation.mutateAsync({ endpointId, enabled }),
    isToggling: mutation.isPending,
    error: mutation.error,
  };
}

export function useCreateCliEndpoint() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (endpoint: Omit<CliEndpoint, 'id'>) => createCliEndpoint(endpoint),
    onSuccess: (created) => {
      queryClient.setQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists(), (old) => {
        if (!old) return { endpoints: [created] };
        return { endpoints: [created, ...old.endpoints] };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliEndpointsKeys.all });
    },
  });

  return {
    createEndpoint: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

export function useUpdateCliEndpoint() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ endpointId, updates }: { endpointId: string; updates: Partial<CliEndpoint> }) =>
      updateCliEndpoint(endpointId, updates),
    onMutate: async ({ endpointId, updates }) => {
      await queryClient.cancelQueries({ queryKey: cliEndpointsKeys.all });
      const previous = queryClient.getQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists());

      queryClient.setQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists(), (old) => {
        if (!old) return old;
        return {
          endpoints: old.endpoints.map((e) => (e.id === endpointId ? { ...e, ...updates } : e)),
        };
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(cliEndpointsKeys.lists(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliEndpointsKeys.all });
    },
  });

  return {
    updateEndpoint: (endpointId: string, updates: Partial<CliEndpoint>) =>
      mutation.mutateAsync({ endpointId, updates }),
    isUpdating: mutation.isPending,
    error: mutation.error,
  };
}

export function useDeleteCliEndpoint() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (endpointId: string) => deleteCliEndpoint(endpointId),
    onMutate: async (endpointId) => {
      await queryClient.cancelQueries({ queryKey: cliEndpointsKeys.all });
      const previous = queryClient.getQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists());

      queryClient.setQueryData<CliEndpointsResponse>(cliEndpointsKeys.lists(), (old) => {
        if (!old) return old;
        return {
          endpoints: old.endpoints.filter((e) => e.id !== endpointId),
        };
      });

      return { previous };
    },
    onError: (_err, _endpointId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(cliEndpointsKeys.lists(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliEndpointsKeys.all });
    },
  });

  return {
    deleteEndpoint: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    error: mutation.error,
  };
}

// ========================================
// useCliInstallations Hook
// ========================================

import {
  fetchCliInstallations,
  installCliTool,
  uninstallCliTool,
  upgradeCliTool,
  type CliInstallation,
} from '../lib/api';

export const cliInstallationsKeys = {
  all: ['cliInstallations'] as const,
  lists: () => [...cliInstallationsKeys.all, 'list'] as const,
};

export interface UseCliInstallationsOptions {
  staleTime?: number;
  enabled?: boolean;
}

export interface UseCliInstallationsReturn {
  installations: CliInstallation[];
  installedTools: CliInstallation[];
  totalCount: number;
  installedCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  invalidate: () => Promise<void>;
}

export function useCliInstallations(options: UseCliInstallationsOptions = {}): UseCliInstallationsReturn {
  const { staleTime = STALE_TIME, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: cliInstallationsKeys.lists(),
    queryFn: fetchCliInstallations,
    staleTime,
    enabled,
    retry: 2,
  });

  const installations = query.data?.tools ?? [];
  const installedTools = installations.filter((t) => t.installed);

  const refetch = async () => {
    await query.refetch();
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
  };

  return {
    installations,
    installedTools,
    totalCount: installations.length,
    installedCount: installedTools.length,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch,
    invalidate,
  };
}

export function useInstallCliTool() {
  const queryClient = useQueryClient();
  const formatMessage = useFormatMessage();
  const { success, info, error: errorToast } = useNotifications();

  const mutation = useMutation({
    mutationFn: (toolName: string) => installCliTool(toolName),
    onMutate: () => {
      info(
        formatMessage({ id: 'status.inProgress' }),
        formatMessage({ id: 'common.feedback.cliToolInstall.success' })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
      success(
        formatMessage({ id: 'common.success' }),
        formatMessage({ id: 'common.feedback.cliToolInstall.success' })
      );
    },
    onError: (err) => {
      const sanitized = sanitizeErrorMessage(err, 'cliToolInstall');
      const message = formatMessage({ id: sanitized.messageKey });
      const title = formatMessage({ id: 'common.error' });
      errorToast(title, message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
    },
  });

  return {
    installTool: mutation.mutateAsync,
    isInstalling: mutation.isPending,
    error: mutation.error,
  };
}

export function useUninstallCliTool() {
  const queryClient = useQueryClient();
  const formatMessage = useFormatMessage();
  const { success, info, error: errorToast } = useNotifications();

  const mutation = useMutation({
    mutationFn: (toolName: string) => uninstallCliTool(toolName),
    onMutate: () => {
      info(
        formatMessage({ id: 'status.inProgress' }),
        formatMessage({ id: 'common.feedback.cliToolUninstall.success' })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
      success(
        formatMessage({ id: 'common.success' }),
        formatMessage({ id: 'common.feedback.cliToolUninstall.success' })
      );
    },
    onError: (err) => {
      const sanitized = sanitizeErrorMessage(err, 'cliToolUninstall');
      const message = formatMessage({ id: sanitized.messageKey });
      const title = formatMessage({ id: 'common.error' });
      errorToast(title, message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
    },
  });

  return {
    uninstallTool: mutation.mutateAsync,
    isUninstalling: mutation.isPending,
    error: mutation.error,
  };
}

export function useUpgradeCliTool() {
  const queryClient = useQueryClient();
  const formatMessage = useFormatMessage();
  const { success, info, error: errorToast } = useNotifications();

  const mutation = useMutation({
    mutationFn: (toolName: string) => upgradeCliTool(toolName),
    onMutate: () => {
      info(
        formatMessage({ id: 'status.inProgress' }),
        formatMessage({ id: 'common.feedback.cliToolUpgrade.success' })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
      success(
        formatMessage({ id: 'common.success' }),
        formatMessage({ id: 'common.feedback.cliToolUpgrade.success' })
      );
    },
    onError: (err) => {
      const sanitized = sanitizeErrorMessage(err, 'cliToolUpgrade');
      const message = formatMessage({ id: sanitized.messageKey });
      const title = formatMessage({ id: 'common.error' });
      errorToast(title, message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: cliInstallationsKeys.all });
    },
  });

  return {
    upgradeTool: mutation.mutateAsync,
    isUpgrading: mutation.isPending,
    error: mutation.error,
  };
}

// ========================================
// useHooks Hook
// ========================================

import {
  fetchHooks,
  toggleHook,
  deleteHook,
  type Hook,
  type HooksResponse,
} from '../lib/api';

export const hooksKeys = {
  all: ['hooks'] as const,
  lists: () => [...hooksKeys.all, 'list'] as const,
};

export interface UseHooksOptions {
  staleTime?: number;
  enabled?: boolean;
}

export interface UseHooksReturn {
  hooks: Hook[];
  enabledHooks: Hook[];
  totalCount: number;
  enabledCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  invalidate: () => Promise<void>;
}

export function useHooks(options: UseHooksOptions = {}): UseHooksReturn {
  const { staleTime = STALE_TIME, enabled = true } = options;
  const queryClient = useQueryClient();
  const projectPath = useWorkflowStore(selectProjectPath);

  const queryEnabled = enabled && !!projectPath;

  const query = useQuery({
    queryKey: workspaceQueryKeys.hooksList(projectPath),
    queryFn: () => fetchHooks(projectPath),
    staleTime,
    enabled: queryEnabled,
    retry: 2,
  });

  const hooks = query.data?.hooks ?? [];
  const enabledHooks = hooks.filter((h) => h.enabled);

  const refetch = async () => {
    await query.refetch();
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: hooksKeys.all });
  };

  return {
    hooks,
    enabledHooks,
    totalCount: hooks.length,
    enabledCount: enabledHooks.length,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch,
    invalidate,
  };
}

export function useToggleHook() {
  const queryClient = useQueryClient();
  const projectPath = useWorkflowStore(selectProjectPath);

  const mutation = useMutation({
    mutationFn: ({ hookName, enabled }: { hookName: string; enabled: boolean }) =>
      toggleHook(hookName, enabled),
    onMutate: async ({ hookName, enabled }) => {
      const queryKey = workspaceQueryKeys.hooksList(projectPath || '');
      await queryClient.cancelQueries({ queryKey });
      const previousHooks = queryClient.getQueryData<HooksResponse>(queryKey);

      queryClient.setQueryData<HooksResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          hooks: old.hooks.map((h) => (h.name === hookName ? { ...h, enabled } : h)),
        };
      });

      return { previousHooks };
    },
    onError: (_error, _vars, context) => {
      const queryKey = workspaceQueryKeys.hooksList(projectPath || '');
      if (context?.previousHooks) {
        queryClient.setQueryData(queryKey, context.previousHooks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.hooksList(projectPath || '') });
    },
  });

  return {
    toggleHook: (hookName: string, enabled: boolean) => mutation.mutateAsync({ hookName, enabled }),
    isToggling: mutation.isPending,
    error: mutation.error,
  };
}

export function useDeleteHook() {
  const queryClient = useQueryClient();
  const projectPath = useWorkflowStore(selectProjectPath);

  const mutation = useMutation({
    mutationFn: (hook: { name: string; scope?: 'global' | 'project'; trigger: string; index?: number }) => {
      const scope = hook.scope || 'project';
      const hookIndex = hook.index ?? 0;
      return deleteHook({
        projectPath: projectPath || undefined,
        scope,
        event: hook.trigger,
        hookIndex,
      });
    },
    onMutate: async (hook) => {
      const queryKey = workspaceQueryKeys.hooksList(projectPath || '');
      await queryClient.cancelQueries({ queryKey });
      const previousHooks = queryClient.getQueryData<HooksResponse>(queryKey);

      queryClient.setQueryData<HooksResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          hooks: old.hooks.filter((h) => h.name !== hook.name),
        };
      });

      return { previousHooks };
    },
    onError: (_error, _hook, context) => {
      const queryKey = workspaceQueryKeys.hooksList(projectPath || '');
      if (context?.previousHooks) {
        queryClient.setQueryData(queryKey, context.previousHooks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.hooksList(projectPath || '') });
    },
  });

  return {
    deleteHook: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    error: mutation.error,
  };
}

// ========================================
// useRules Hook
// ========================================

import {
  fetchRules,
  toggleRule,
  createRule as createRuleApi,
  deleteRule as deleteRuleApi,
  type Rule,
  type RulesResponse,
  type RuleCreateInput,
} from '../lib/api';

export const rulesKeys = {
  all: ['rules'] as const,
  lists: () => [...rulesKeys.all, 'list'] as const,
};

export interface UseRulesOptions {
  staleTime?: number;
  enabled?: boolean;
}

export interface UseRulesReturn {
  rules: Rule[];
  enabledRules: Rule[];
  totalCount: number;
  enabledCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  invalidate: () => Promise<void>;
}

export function useRules(options: UseRulesOptions = {}): UseRulesReturn {
  const { staleTime = STALE_TIME, enabled = true } = options;
  const queryClient = useQueryClient();
  const projectPath = useWorkflowStore(selectProjectPath);

  const query = useQuery({
    queryKey: workspaceQueryKeys.rulesList(projectPath),
    queryFn: () => fetchRules(projectPath),
    staleTime,
    enabled: enabled, // Remove projectPath requirement
    retry: 2,
  });

  const rules = query.data?.rules ?? [];
  const enabledRules = rules.filter((r) => r.enabled);

  const refetch = async () => {
    await query.refetch();
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: rulesKeys.all });
  };

  return {
    rules,
    enabledRules,
    totalCount: rules.length,
    enabledCount: enabledRules.length,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch,
    invalidate,
  };
}

export function useToggleRule() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      toggleRule(ruleId, enabled),
    onMutate: async ({ ruleId, enabled }) => {
      await queryClient.cancelQueries({ queryKey: rulesKeys.all });
      const previousRules = queryClient.getQueryData<RulesResponse>(rulesKeys.lists());

      queryClient.setQueryData<RulesResponse>(rulesKeys.lists(), (old) => {
        if (!old) return old;
        return {
          rules: old.rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
        };
      });

      return { previousRules };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousRules) {
        queryClient.setQueryData(rulesKeys.lists(), context.previousRules);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: rulesKeys.all });
    },
  });

  return {
    toggleRule: (ruleId: string, enabled: boolean) => mutation.mutateAsync({ ruleId, enabled }),
    isToggling: mutation.isPending,
    error: mutation.error,
  };
}

export function useCreateRule() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: RuleCreateInput) => createRuleApi(input),
    onSuccess: (newRule) => {
      queryClient.setQueryData<RulesResponse>(rulesKeys.lists(), (old) => {
        if (!old) return { rules: [newRule] };
        return {
          rules: [newRule, ...old.rules],
        };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: rulesKeys.all });
    },
  });

  return {
    createRule: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

export function useDeleteRule() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ ruleId, location }: { ruleId: string; location?: string }) =>
      deleteRuleApi(ruleId, location),
    onMutate: async ({ ruleId }) => {
      await queryClient.cancelQueries({ queryKey: rulesKeys.all });
      const previousRules = queryClient.getQueryData<RulesResponse>(rulesKeys.lists());

      queryClient.setQueryData<RulesResponse>(rulesKeys.lists(), (old) => {
        if (!old) return old;
        return {
          rules: old.rules.filter((r) => r.id !== ruleId),
        };
      });

      return { previousRules };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousRules) {
        queryClient.setQueryData(rulesKeys.lists(), context.previousRules);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: rulesKeys.all });
    },
  });

  return {
    deleteRule: (ruleId: string, location?: string) => mutation.mutateAsync({ ruleId, location }),
    isDeleting: mutation.isPending,
    error: mutation.error,
  };
}
