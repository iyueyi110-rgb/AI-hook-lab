export function DatabaseUnavailablePanel() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <section className="editorial-panel w-full max-w-lg p-6 text-center">
        <p className="text-xs font-black text-[var(--color-accent)]">AI HOOK LAB 后台</p>
        <h1 className="mt-3 text-2xl font-black">生产数据库未配置</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
          请先在 Vercel 为 hookovo 项目连接 Neon PostgreSQL，再重新部署。
        </p>
        <a
          className="button-primary mt-5"
          href="https://vercel.com/yueyyue/hookovo/stores"
          rel="noreferrer"
          target="_blank"
        >
          打开 Vercel Storage
        </a>
      </section>
    </main>
  );
}
