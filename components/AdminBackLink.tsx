import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

export function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      className="inline-flex items-center gap-2 text-xs font-bold text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
      href={href}
    >
      <ArrowLeft aria-hidden="true" size={15} weight="bold" />
      {label}
    </Link>
  );
}
