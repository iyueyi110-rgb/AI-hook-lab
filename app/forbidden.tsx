import Link from "next/link";
import { ShieldWarning } from "@phosphor-icons/react/dist/ssr";

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <section className="editorial-panel w-full max-w-md p-6 text-center">
        <ShieldWarning className="mx-auto text-[var(--color-accent)]" size={30} weight="bold" />
        <h1 className="mt-4 text-2xl font-black">没有后台访问权限</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">只有管理员账号可以查看数据看板。</p>
        <Link className="button-secondary mt-5" href="/evaluation">返回评测工作区</Link>
      </section>
    </main>
  );
}
