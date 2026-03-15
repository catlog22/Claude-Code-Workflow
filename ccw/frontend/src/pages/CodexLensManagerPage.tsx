// ========================================
// CodexLens Manager Page
// ========================================
// Manage CodexLens semantic code search with tabbed interface
// Supports Overview, Settings, Models, and Advanced tabs

import { useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Sparkles,
  RefreshCw,
  Download,
  Trash2,
  Zap,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TabsNavigation } from '@/components/ui/TabsNavigation';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/AlertDialog';
import { OverviewTab } from '@/components/codexlens/OverviewTab';
import { SettingsTab } from '@/components/codexlens/SettingsTab';
import { AdvancedTab } from '@/components/codexlens/AdvancedTab';
import { ModelsTab } from '@/components/codexlens/ModelsTab';
import { SearchTab } from '@/components/codexlens/SearchTab';
import { SemanticInstallDialog } from '@/components/codexlens/SemanticInstallDialog';
import { InstallProgressOverlay } from '@/components/codexlens/InstallProgressOverlay';
import { useCodexLensDashboard, useCodexLensMutations } from '@/hooks';
import { checkCodexLensBuildTools } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function CodexLensManagerPage() {
  const { formatMessage } = useIntl();
  const [activeTab, setActiveTab] = useState('overview');
  const [isUninstallDialogOpen, setIsUninstallDialogOpen] = useState(false);
  const [isSemanticInstallOpen, setIsSemanticInstallOpen] = useState(false);
  const [isInstallOverlayOpen, setIsInstallOverlayOpen] = useState(false);

  const {
    installed,
    status,
    config,
    semantic,
    isLoading,
    isFetching,
    refetch,
  } = useCodexLensDashboard();

  const {
    bootstrap,
    isBootstrapping,
    uninstall,
    isUninstalling,
  } = useCodexLensMutations();

  const handleRefresh = () => {
    refetch();
  };

  const handleBootstrap = async () => {
    // Pre-check: Verify build tools are available before opening dialog
    const buildTools = await checkCodexLensBuildTools();

    if (!buildTools.available) {
      const isWindows = navigator.userAgent.includes('Windows');
      const missingList = buildTools.missing.join(', ');

      let errorMessage = '';

      if (isWindows) {
        if (buildTools.missing.includes('Visual C++ Build Tools')) {
          errorMessage += '• Visual C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/\n';
        }
        if (buildTools.missing.includes('Rust')) {
          errorMessage += '• Rust: https://rustup.rs/\n';
        }
      } else {
        errorMessage += '• Ubuntu/Debian: sudo apt install build-essential\n';
        errorMessage += '• macOS: xcode-select --install\n';
      }

      toast.error(`缺少构建工具 (${missingList})\n\n${errorMessage}安装完成后再试`, {
        duration: 10000,
      });
      return;
    }

    setIsInstallOverlayOpen(true);
  };

  const handleBootstrapInstall = async () => {
    // Environment check is already done in handleBootstrap, but double-check here
    const buildTools = await checkCodexLensBuildTools();

    if (!buildTools.available) {
      const missingList = buildTools.missing.join(', ');
      toast.error(`缺少构建工具: ${missingList}`, {
        description: '请先安装所需的构建工具后再试',
        duration: 10000,
      });
      throw new Error('Missing build tools: ' + missingList);
    }

    const result = await bootstrap();
    return result;
  };

  const handleUninstall = async () => {
    const result = await uninstall();
    if (result.success) {
      refetch();
    }
    setIsUninstallDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            {formatMessage({ id: 'codexlens.title' })}
          </h1>
          <p className="text-muted-foreground mt-1">
            {formatMessage({ id: 'codexlens.description' })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isFetching && 'animate-spin')} />
            {formatMessage({ id: 'common.actions.refresh' })}
          </Button>
          {!installed ? (
            <Button
              onClick={handleBootstrap}
              disabled={isBootstrapping}
            >
              <Download className={cn('w-4 h-4 mr-2', isBootstrapping && 'animate-spin')} />
              {isBootstrapping
                ? formatMessage({ id: 'codexlens.bootstrapping' })
                : formatMessage({ id: 'codexlens.bootstrap' })
              }
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setIsSemanticInstallOpen(true)}
                disabled={!semantic?.available}
              >
                <Zap className="w-4 h-4 mr-2" />
                {formatMessage({ id: 'codexlens.semantic.install' })}
              </Button>
              <AlertDialog open={isUninstallDialogOpen} onOpenChange={setIsUninstallDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={isUninstalling}
                  >
                    <Trash2 className={cn('w-4 h-4 mr-2', isUninstalling && 'animate-spin')} />
                    {isUninstalling
                      ? formatMessage({ id: 'codexlens.uninstalling' })
                      : formatMessage({ id: 'codexlens.uninstall' })
                    }
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {formatMessage({ id: 'codexlens.confirmUninstallTitle' })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {formatMessage({ id: 'codexlens.confirmUninstall' })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isUninstalling}>
                      {formatMessage({ id: 'common.actions.cancel' })}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleUninstall}
                      disabled={isUninstalling}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isUninstalling
                        ? formatMessage({ id: 'codexlens.uninstalling' })
                        : formatMessage({ id: 'common.actions.confirm' })
                      }
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      {/* Installation Status Alert */}
      {!installed && !isLoading && (
        <Card className="p-4 bg-warning/10 border-warning/20">
          <p className="text-sm text-warning-foreground">
            {formatMessage({ id: 'codexlens.notInstalled' })}
          </p>
        </Card>
      )}

      {/* Tabbed Interface */}
      <TabsNavigation
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={[
          { value: 'overview', label: formatMessage({ id: 'codexlens.tabs.overview' }) },
          { value: 'settings', label: formatMessage({ id: 'codexlens.tabs.settings' }) },
          { value: 'models', label: formatMessage({ id: 'codexlens.tabs.models' }) },
          { value: 'search', label: formatMessage({ id: 'codexlens.tabs.search' }) },
          { value: 'advanced', label: formatMessage({ id: 'codexlens.tabs.advanced' }) },
        ]}
      />

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="mt-4">
          <OverviewTab
            installed={installed}
            status={status}
            config={config}
            isLoading={isLoading}
            onRefresh={handleRefresh}
          />
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="mt-4">
          <SettingsTab enabled={installed} />
        </div>
      )}

      {activeTab === 'models' && (
        <div className="mt-4">
          <ModelsTab installed={installed} />
        </div>
      )}

      {activeTab === 'search' && (
        <div className="mt-4">
          <SearchTab enabled={installed} />
        </div>
      )}

      {activeTab === 'advanced' && (
        <div className="mt-4">
          <AdvancedTab enabled={installed} />
        </div>
      )}

      {/* Semantic Install Dialog */}
      <SemanticInstallDialog
        open={isSemanticInstallOpen}
        onOpenChange={setIsSemanticInstallOpen}
        onSuccess={() => refetch()}
      />

      {/* Install Progress Overlay */}
      <InstallProgressOverlay
        open={isInstallOverlayOpen}
        onOpenChange={setIsInstallOverlayOpen}
        onInstall={handleBootstrapInstall}
        onSuccess={() => refetch()}
      />
    </div>
  );
}

export default CodexLensManagerPage;
