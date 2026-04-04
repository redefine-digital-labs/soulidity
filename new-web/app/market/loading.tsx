export default function MarketLoading() {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="mb-4">
        <div className="h-3 w-16 bg-card2 rounded animate-pulse mb-2" />
        <div className="h-7 w-48 bg-card2 rounded animate-pulse mb-2" />
        <div className="h-4 w-80 bg-card2 rounded animate-pulse" />
      </div>
      <div className="h-11 w-full bg-card2 rounded-xl animate-pulse mb-6" />
      <div className="flex gap-2 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-20 bg-card2 rounded-full animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="h-[140px] bg-card2 animate-pulse" />
            <div className="p-3.5">
              <div className="h-3 w-16 bg-card2 rounded animate-pulse mb-2" />
              <div className="h-4 w-32 bg-card2 rounded animate-pulse mb-2" />
              <div className="h-3 w-full bg-card2 rounded animate-pulse mb-3" />
              <div className="flex justify-between">
                <div className="h-4 w-20 bg-card2 rounded animate-pulse" />
                <div className="h-7 w-14 bg-card2 rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
