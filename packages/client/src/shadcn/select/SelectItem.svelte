<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { Check } from "lucide-svelte";
  import type { Snippet } from "svelte";
  import { cn } from "@utils";

  type Props = SelectPrimitive.ItemProps & {
    class?: string;
    children?: Snippet;
  };

  let {
    class: className,
    children,
    value,
    label,
    disabled,
    ref = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<SelectPrimitive.Item
  bind:ref
  {value}
  {label}
  {disabled}
  class={cn(
    "relative flex w-full cursor-pointer items-center select-none",
    "rounded-sm py-1.5 pr-2 pl-8 text-[13px] outline-none",
    "data-[highlighted]:bg-cobalt-25 data-[highlighted]:text-cobalt-700",
    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
    className,
  )}
  {...rest}
>
  {#snippet child({ props, selected })}
    <div {...props}>
      <span class="absolute left-2 flex size-4 items-center justify-center">
        {#if selected}
          <Check class="text-cobalt-600 size-3.5" />
        {/if}
      </span>
      {#if children}
        {@render children()}
      {:else}
        {label ?? value}
      {/if}
    </div>
  {/snippet}
</SelectPrimitive.Item>
