export function SkeletonCards() {
  return (
    <div className="mx-auto mt-10 w-full max-w-5xl border-x border-t border-neutral-300 bg-white">
      <p className="border-b border-neutral-300 px-4 py-4 text-sm font-bold text-[#E4002B] animate-pulse md:px-6">
        正在分析平台风格，生成 10 个 Hook
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="space-y-4 border-b border-neutral-300 p-5 animate-pulse md:odd:border-r"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="h-4 w-24 bg-neutral-200" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-neutral-200" />
              <div className="h-4 w-3/4 bg-neutral-200" />
            </div>
            <div className="h-1.5 w-full bg-neutral-200" />
            <div className="h-3 w-2/3 bg-neutral-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
