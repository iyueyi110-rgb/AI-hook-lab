"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Flask, LockKey, ShieldCheck } from "@phosphor-icons/react";

export function EvaluationLoginClient({
  setupRequired,
  nextPath,
}: {
  setupRequired: boolean;
  nextPath: string;
}) {
  const endpoint = setupRequired ? "/api/evaluation/setup" : "/api/evaluation/auth/login";
  const action = `${endpoint}?next=${encodeURIComponent(nextPath)}`;
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        displayName: form.get("displayName"),
        password: form.get("password"),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "登录失败");
      setLoading(false);
      return;
    }
    router.replace(nextPath);
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[10px] bg-[var(--color-accent)] text-white"><Flask size={22} weight="bold" /></span>
          <div><p className="text-xs font-black text-[var(--color-accent)]">AI HOOK LAB</p><h1 className="text-2xl font-black tracking-[-0.035em]">离线评测工作区</h1></div>
        </div>
        <section className="editorial-panel overflow-hidden">
          <div className="border-b border-[var(--color-line)] p-5">
            <div className="flex items-center gap-2 text-sm font-black"><ShieldCheck size={18} weight="bold" />{setupRequired ? "创建首个管理员" : "内部账号登录"}</div>
            <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">评分、盲评和裁决均记录账号身份。系统不会把人工意向或模拟数据包装成真实行为。</p>
          </div>
          <form action={action} className="space-y-4 p-5" method="post" onSubmit={submit}>
            <label className="block text-xs font-bold">用户名<input autoComplete="username" className="control-base mt-2 min-h-11 w-full px-3" minLength={3} name="username" required /></label>
            {setupRequired && <label className="block text-xs font-bold">显示名称<input className="control-base mt-2 min-h-11 w-full px-3" name="displayName" required /></label>}
            <label className="block text-xs font-bold">密码<input autoComplete={setupRequired ? "new-password" : "current-password"} className="control-base mt-2 min-h-11 w-full px-3" minLength={12} name="password" required type="password" /></label>
            {error && <p className="rounded-[8px] bg-[var(--color-danger-soft)] p-3 text-xs font-bold text-[var(--color-danger)]" role="alert">{error}</p>}
            <button className="button-primary w-full" disabled={loading} type="submit"><LockKey size={17} weight="bold" />{loading ? "处理中" : setupRequired ? "创建并进入" : "登录评测工作区"}</button>
          </form>
        </section>
      </div>
    </main>
  );
}
