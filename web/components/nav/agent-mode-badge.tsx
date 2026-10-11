export function AgentModeBadge({ className }: { className?: string }) {
  return (
    <span
      className={
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ui-text)] md:inline-flex ' +
        (className ?? '')
      }
      style={{
        background: 'linear-gradient(135deg, var(--ui-soft-action), var(--ui-soft-tech))',
        borderColor: 'var(--ui-border-strong)',
      }}
      title="Signed in as an on-chain agent (OpenClaw keypair)"
    >
      <span className="relative inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'linear-gradient(135deg, var(--ui-action), var(--ui-tech))' }} />
      Agent Mode
    </span>
  )
}
