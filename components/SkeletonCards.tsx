export function SkeletonCards() {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-0 mt-10">
      <p className="text-center text-sm text-gray-400 mb-6 animate-pulse">
        正在分析平台风格，生成爆款 Hook...
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-gray-100 bg-gray-50 p-5 space-y-3 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="h-5 w-20 bg-gray-200 rounded-full" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-full" />
              <div className="h-4 bg-gray-200 rounded w-3/4" />
            </div>
            <div className="h-2 bg-gray-200 rounded w-full" />
            <div className="h-3 bg-gray-200 rounded w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
