export function SkeletonCards() {
  return (
    <section aria-busy="true" aria-label="正在生成 Hook" className="editorial-panel overflow-hidden">
      <div className="border-b border-[var(--color-line)] px-5 py-4">
        <p className="text-sm font-extrabold">正在分析平台语气并生成候选</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">历史记录不会被覆盖，请稍候。</p>
      </div>
      <div>
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="border-b border-[var(--color-line)] p-5 last:border-b-0" key={index}>
            <div className="soft-pulse h-3 w-24 rounded bg-[var(--color-line)]" />
            <div className="mt-4 space-y-2">
              <div className="soft-pulse h-4 w-full rounded bg-[var(--color-line)]" />
              <div className="soft-pulse h-4 w-3/4 rounded bg-[var(--color-line)]" />
            </div>
            <div className="mt-4 flex gap-2">
              <div className="soft-pulse h-8 w-16 rounded bg-[var(--color-line)]" />
              <div className="soft-pulse h-8 w-16 rounded bg-[var(--color-line)]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
