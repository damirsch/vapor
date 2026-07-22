"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "dashed";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render a square icon button (no horizontal padding). */
  iconOnly?: boolean;
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const BASE =
  "inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-white text-black hover:bg-white/90 disabled:bg-white/15 disabled:text-text-faint",
  secondary:
    "border border-white/12 bg-white/[0.03] text-text hover:bg-white/8 disabled:text-text-faint disabled:hover:bg-white/[0.03]",
  ghost:
    "border border-white/10 bg-white/[0.02] text-text-dim hover:bg-white/8 hover:text-text disabled:text-text-faint disabled:hover:bg-white/[0.02]",
  dashed:
    "border border-dashed border-white/15 bg-white/[0.02] text-text-faint hover:border-white/30 hover:text-text",
};

const SIZES: Record<ButtonSize, { text: string; icon: string }> = {
  sm: { text: "h-9 px-3.5 text-[13px]", icon: "h-9 w-9" },
  md: { text: "h-11 px-4 text-sm", icon: "h-11 w-11" },
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    iconOnly = false,
    type,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        BASE,
        VARIANTS[variant],
        iconOnly ? SIZES[size].icon : SIZES[size].text,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Button;
