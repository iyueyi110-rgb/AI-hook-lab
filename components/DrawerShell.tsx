"use client";

import { X } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function DrawerShell({
  open,
  onClose,
  title,
  description,
  actions,
  children,
}: DrawerShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previousFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="关闭面板"
        className="absolute inset-0 h-full w-full cursor-default bg-black/32"
        onClick={onClose}
        type="button"
      />
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="drawer-enter absolute bottom-0 right-0 flex max-h-[88dvh] w-full flex-col rounded-t-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-panel)] md:top-0 md:h-full md:max-h-none md:max-w-[520px] md:rounded-none md:border-y-0 md:border-r-0"
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4 md:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-[-0.02em]" id={titleId}>
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              aria-label="关闭"
              className="button-secondary h-9 min-h-9 w-9 px-0"
              onClick={onClose}
              ref={closeRef}
              type="button"
            >
              <X aria-hidden="true" size={18} weight="bold" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
