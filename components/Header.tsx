"use client";

export function Header() {
  return (
    <header className="mx-auto w-full max-w-5xl border-x border-b border-neutral-300 bg-white">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px]">
        <div className="px-4 py-8 md:px-6 md:py-12">
          <p className="mb-4 text-xs font-bold uppercase text-[#E4002B]">
            AI Hook Lab
          </p>
          <h1 className="max-w-3xl text-4xl font-black leading-none text-[#111111] md:text-7xl">
            写出能停住手指的开头。
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-neutral-600 md:text-base">
            输入主题，选择发布平台和内容类型，一次生成 10 个不同角度的 Hook，并保留可复用的评分与记录。
          </p>
        </div>
        <div className="hidden border-l border-neutral-300 p-6 md:flex md:flex-col md:justify-between">
          <span className="text-xs font-bold uppercase text-neutral-500">
            Output
          </span>
          <span className="text-right text-8xl font-black leading-none text-[#E4002B]">
            10
          </span>
        </div>
      </div>
    </header>
  );
}
