interface CollectionLoreSectionProps {
  description: string
}

export function CollectionLoreSection({ description }: CollectionLoreSectionProps) {
  if (!description.trim()) return null

  return (
    <section>
      <p className="text-[10px] font-bold text-muted uppercase tracking-[0.1em] mb-2">
        Lore / Setting
      </p>
      <div className="bg-card2 border border-border rounded-xl px-5 py-4">
        <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">{description}</p>
      </div>
    </section>
  )
}
