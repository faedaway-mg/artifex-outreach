"use client";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ActionButton({
  onRun,
  children,
  variant = "secondary",
  className,
  disabled,
  confirm,
}: {
  onRun: () => Promise<void>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const cls =
    variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <button
      type="button"
      disabled={pending || disabled}
      className={cn(cls, className)}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(() => void onRun());
      }}
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}
