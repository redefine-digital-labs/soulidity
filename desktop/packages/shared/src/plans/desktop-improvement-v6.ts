export type ImprovementPriority = 'P0' | 'P1' | 'P2'

export interface ImprovementOwner {
  team: 'desktop-main' | 'desktop-renderer' | 'desktop-backend' | 'qa'
  role: string
}

export interface ImprovementMilestone {
  id: string
  priority: ImprovementPriority
  summary: string
  owners: ImprovementOwner[]
  dependsOn: string[]
  targetFiles: string[]
  acceptance: string[]
  rollback: string
}

export interface DesktopImprovementPlanV6 {
  version: 'v6'
  principle: 'stability-first-no-tail'
  milestones: ImprovementMilestone[]
}

/**
 * V6 最终融合版（可执行配置）：
 * - 先稳定链路，再补体验与能力；
 * - 每个里程碑都绑定 owner、文件面、验收与回滚点；
 * - 可直接被脚本/测试消费，避免“只写在文档里”。
 */
export const desktopImprovementPlanV6: DesktopImprovementPlanV6 = {
  version: 'v6',
  principle: 'stability-first-no-tail',
  milestones: [
    {
      id: 'P0-auth-link-hardening',
      priority: 'P0',
      summary: '收口 link/auth 恢复与确认路径，杜绝误判绑定态',
      owners: [
        { team: 'desktop-renderer', role: 'Settings owner' },
        { team: 'desktop-main', role: 'IPC/Web API owner' },
        { team: 'qa', role: 'Regression owner' },
      ],
      dependsOn: [],
      targetFiles: [
        'desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx',
        'desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.test.tsx',
        'desktop/apps/desktop/src/main/web-api.ts',
        'tests/desktop/web-api.test.ts',
        'tests/desktop/main-window.test.tsx',
      ],
      acceptance: [
        '绑定确认前必须通过 getDesktopMe 真实校验',
        '网络抖动场景不会误进入 confirmed',
        '恢复路径可诊断且可恢复（重试/解绑）',
      ],
      rollback: '保留现有 SettingsTab 状态机入口，出现回归时可回退到已上线稳定版本。',
    },
    {
      id: 'P0-presence-minimum-loop',
      priority: 'P0',
      summary: '补齐最小生命感闭环（状态、反馈、强度控制）',
      owners: [
        { team: 'desktop-renderer', role: 'Pet UX owner' },
      ],
      dependsOn: ['P0-auth-link-hardening'],
      targetFiles: [
        'desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx',
        'desktop/apps/desktop/src/renderer/components/FloatingBall/styles.css',
        'desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx',
        'desktop/apps/desktop/src/renderer/hooks/useMood.ts',
        'tests/desktop/floating-ball.test.tsx',
      ],
      acceptance: [
        '悬浮球状态可感知且可关闭增强效果',
        '默认低打扰，不增加额外弹窗打断',
      ],
      rollback: '仅灰度开启动画增强配置，遇到性能问题可一键降级到静态展示。',
    },
    {
      id: 'P1-light-task-closure',
      priority: 'P1',
      summary: '文件驱动任务执行与写入审批形成闭环',
      owners: [
        { team: 'desktop-main', role: 'Task flow owner' },
        { team: 'desktop-renderer', role: 'UX owner' },
      ],
      dependsOn: ['P0-auth-link-hardening'],
      targetFiles: [
        'desktop/apps/desktop/src/main/task-executor.ts',
        'desktop/apps/desktop/src/renderer/components/FloatingBall/styles.css',
        'desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx',
        'desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.tsx',
        'desktop/apps/desktop/src/renderer/components/MainWindow/styles.css',
        'desktop/apps/desktop/src/main/index.ts',
        'desktop/apps/desktop/src/preload/index.ts',
        'desktop/apps/desktop/src/renderer/env.d.ts',
        'desktop/packages/shared/src/index.ts',
        'desktop/packages/shared/src/types/task-execution.ts',
        'tests/desktop/task-executor.test.ts',
        'tests/desktop/floating-ball.test.tsx',
      ],
      acceptance: [
        '写操作默认先过显式审批，可拒绝且无副作用',
        '悬浮球只保留文件驱动任务面板，不再暴露 Quick Capture 入口或 inbox 状态',
      ],
      rollback: '审批开关保持后端可控，异常时可退回只读模式。',
    },
  ],
}
