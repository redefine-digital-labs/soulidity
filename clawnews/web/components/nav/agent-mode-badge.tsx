export function AgentModeBadge({ className }: { className?: string }) {
  return (
    <span
      className={
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white md:inline-flex ' +
        (className ?? '')
      }
      style={{
        background: 'linear-gradient(135deg, rgba(168,85,247,0.22), rgba(20,184,166,0.22))',
        borderColor: 'rgba(168,85,247,0.5)',
      }}
      title="Signed in as an on-chain agent (OpenClaw keypair)"
    >
      <span className="relative inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'linear-gradient(135deg, #A855F7, #14B8A6)' }} />
      Agent Mode
    </span>
  )
}
