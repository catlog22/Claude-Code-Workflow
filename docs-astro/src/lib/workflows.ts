export type Locale = 'en' | 'zh';

export type WorkflowComplexity = 'low' | 'medium' | 'high';

export type WorkflowType =
  | 'execution'
  | 'planning'
  | 'debugging'
  | 'testing'
  | 'analysis'
  | 'brainstorm'
  | 'issue';

export interface WorkflowDefinition {
  id: string;
  name: string;
  complexity: WorkflowComplexity;
  type: WorkflowType;
  description: Record<Locale, string>;
  command: Record<Locale, string>;
}

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'lite-lite-lite',
    name: 'Lite-Lite-Lite',
    complexity: 'low',
    type: 'execution',
    description: {
      en: 'Instant execution for tiny changes (no artifacts).',
      zh: '即时执行，适合小改动（无产物）。',
    },
    command: {
      en: '/workflow:lite-lite-lite "Fix a typo in README"',
      zh: '/workflow:lite-lite-lite "修复 README 拼写错误"',
    },
  },
  {
    id: 'lite-plan',
    name: 'Lite-Plan',
    complexity: 'low',
    type: 'planning',
    description: {
      en: 'Lightweight planning for clear, single-module work.',
      zh: '轻量规划，适合需求明确的单模块开发。',
    },
    command: {
      en: '/workflow:lite-plan "Add JWT authentication"\n/workflow:lite-execute',
      zh: '/workflow:lite-plan "添加 JWT 认证"\n/workflow:lite-execute',
    },
  },
  {
    id: 'lite-fix',
    name: 'Lite-Fix',
    complexity: 'low',
    type: 'debugging',
    description: {
      en: 'Bug diagnosis and fix with lightweight artifacts.',
      zh: 'Bug 诊断与修复（轻量产物）。',
    },
    command: {
      en: '/workflow:lite-fix "Upload fails with 413"\n/workflow:lite-execute',
      zh: '/workflow:lite-fix "用户上传失败返回 413"\n/workflow:lite-execute',
    },
  },
  {
    id: 'multi-cli-plan',
    name: 'Multi-CLI-Plan',
    complexity: 'medium',
    type: 'analysis',
    description: {
      en: 'Collaborative planning with multiple CLIs/perspectives.',
      zh: '多 CLI / 多视角协作规划。',
    },
    command: {
      en: '/workflow:multi-cli-plan "Design a caching strategy"\n/workflow:lite-execute',
      zh: '/workflow:multi-cli-plan "设计缓存策略"\n/workflow:lite-execute',
    },
  },
  {
    id: 'plan',
    name: 'Plan',
    complexity: 'medium',
    type: 'planning',
    description: {
      en: 'Standard session planning for multi-module development.',
      zh: '标准 Session 规划，适合多模块开发。',
    },
    command: {
      en: '/workflow:plan "Implement payment gateway integration"\n/workflow:plan-verify\n/workflow:execute',
      zh: '/workflow:plan "实现支付网关集成"\n/workflow:plan-verify\n/workflow:execute',
    },
  },
  {
    id: 'tdd-plan',
    name: 'TDD-Plan',
    complexity: 'medium',
    type: 'testing',
    description: {
      en: 'Test-driven development planning (Red-Green-Refactor).',
      zh: '测试驱动开发规划（Red-Green-Refactor）。',
    },
    command: {
      en: '/workflow:tdd-plan "Implement user registration"\n/workflow:plan-verify\n/workflow:execute\n/workflow:tdd-verify',
      zh: '/workflow:tdd-plan "实现用户注册"\n/workflow:plan-verify\n/workflow:execute\n/workflow:tdd-verify',
    },
  },
  {
    id: 'test-fix-gen',
    name: 'Test-Fix-Gen',
    complexity: 'medium',
    type: 'testing',
    description: {
      en: 'Generate tests + run automated test-fix execution cycle.',
      zh: '生成测试 + 执行自动化 test-fix 循环。',
    },
    command: {
      en: '/workflow:test-fix-gen "Test the auth API"\n/workflow:test-cycle-execute',
      zh: '/workflow:test-fix-gen "为认证 API 生成测试"\n/workflow:test-cycle-execute',
    },
  },
  {
    id: 'debug-with-file',
    name: 'Debug-with-File',
    complexity: 'medium',
    type: 'debugging',
    description: {
      en: 'Hypothesis-driven debugging with documented understanding.',
      zh: '假设驱动调试，理解过程文档化。',
    },
    command: {
      en: '/workflow:debug-with-file "Service crashes randomly under load"',
      zh: '/workflow:debug-with-file "系统在负载下随机崩溃"',
    },
  },
  {
    id: 'analyze-with-file',
    name: 'Analyze-with-File',
    complexity: 'medium',
    type: 'analysis',
    description: {
      en: 'Collaborative analysis with exploration + recorded conclusions.',
      zh: '协作分析：探索 + 结论沉淀。',
    },
    command: {
      en: '/workflow:analyze-with-file "Understand authentication architecture decisions"',
      zh: '/workflow:analyze-with-file "理解认证架构设计决策"',
    },
  },
  {
    id: 'brainstorm-auto-parallel',
    name: 'Brainstorm',
    complexity: 'high',
    type: 'brainstorm',
    description: {
      en: 'Multi-role brainstorming to explore architecture and new features.',
      zh: '多角色头脑风暴：适合新功能/架构设计探索。',
    },
    command: {
      en: '/workflow:brainstorm:auto-parallel "Design a real-time collaboration system" --count 5\n/workflow:plan --session WFS-xxx\n/workflow:plan-verify\n/workflow:execute',
      zh: '/workflow:brainstorm:auto-parallel "设计实时协作系统" --count 5\n/workflow:plan --session WFS-xxx\n/workflow:plan-verify\n/workflow:execute',
    },
  },
  {
    id: 'issue-discover',
    name: 'Issue:Discover',
    complexity: 'high',
    type: 'issue',
    description: {
      en: 'Batch issue discovery from the codebase (multi-perspective).',
      zh: '批量 Issue 发现（多视角）。',
    },
    command: {
      en: '/issue:discover',
      zh: '/issue:discover',
    },
  },
  {
    id: 'issue-execute',
    name: 'Issue:Execute',
    complexity: 'high',
    type: 'issue',
    description: {
      en: 'Execute queued issues in parallel (worktree isolation optional).',
      zh: '并行执行队列中的 Issue（可选 worktree 隔离）。',
    },
    command: {
      en: '/issue:execute',
      zh: '/issue:execute',
    },
  },
];

