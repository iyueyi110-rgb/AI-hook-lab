"use client";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6 md:px-2 md:py-8">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#E4002B] text-xl font-black leading-none text-white shadow-[0_10px_25px_rgba(228,0,43,0.18)]">
          H
        </div>
        <span className="text-xl font-black tracking-tight text-[#E4002B]">
          AI HOOK LAB
        </span>
      </div>

      <div className="hidden items-center gap-3 text-sm text-neutral-500 md:flex">
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white text-sm font-black text-[#111111] shadow-sm">
          AI
        </span>
        <span>让好内容，从好开头开始。</span>
      </div>
    </header>
  );
}
