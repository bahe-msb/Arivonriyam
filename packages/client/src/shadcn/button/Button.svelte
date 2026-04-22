<script lang="ts" module>
  export type ButtonVariant = "primary" | "secondary" | "ghost" | "warm" | "danger";
  export type ButtonSize = "sm" | "md" | "lg" | "icon";
</script>

<script lang="ts">
  import type { HTMLButtonAttributes, HTMLAnchorAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    href?: string;
    class?: string;
    children?: Snippet;
  } & Omit<HTMLButtonAttributes, "class"> &
    Omit<HTMLAnchorAttributes, "class" | "type">;

  let {
    variant = "primary",
    size = "md",
    href,
    class: className,
    children,
    ...rest
  }: Props = $props();

  const variants: Record<ButtonVariant, string> = {
    primary: "bg-cobalt-500 text-white hover:bg-cobalt-600",
    secondary:
      "bg-white text-text-primary border border-border-default hover:bg-cobalt-25 hover:border-cobalt-500 hover:text-cobalt-600",
    ghost: "bg-transparent text-text-secondary hover:bg-gray-50 hover:text-text-primary",
    warm: "bg-saffron-500 text-white hover:bg-saffron-600",
    danger: "bg-danger-500 text-white hover:bg-danger-500/90",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "px-3 py-1.5 text-xs gap-1.5 rounded-md",
    md: "px-4 py-2 text-[13px] gap-2 rounded-md",
    lg: "px-5 py-3 text-sm gap-2 rounded-md",
    icon: "p-2 rounded-md",
  };

  const base =
    "inline-flex items-center justify-center font-medium transition-colors duration-150 whitespace-nowrap border border-transparent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500/30";
</script>

{#if href}
  <a {href} class={cn(base, variants[variant], sizes[size], className)} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button class={cn(base, variants[variant], sizes[size], className)} {...rest}>
    {@render children?.()}
  </button>
{/if}
