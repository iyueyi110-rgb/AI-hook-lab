"use client";

export function Header() {
  return (
    <header className="w-full py-6 px-4 md:py-10 md:px-0 text-center">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
        <span className="text-violet-600">AI</span> Hook Lab
      </h1>
      <p className="mt-2 text-sm md:text-base text-gray-500 max-w-md mx-auto hidden md:block">
        一个主题，十个爆款开头。让 AI 帮你找到最抓人的 Hook。
      </p>
    </header>
  );
}
