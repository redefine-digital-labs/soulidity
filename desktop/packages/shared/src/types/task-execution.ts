export type TaskExecutionMode = 'read' | 'write'

export interface TaskWriteApprovalGrant {
  ok: true
  token: string
}

export interface TaskWriteApprovalDenied {
  ok: false
  reason: 'denied' | 'invalid-paths' | 'no-window' | 'instruction-too-long'
}

export type TaskWriteApprovalResult = TaskWriteApprovalGrant | TaskWriteApprovalDenied
