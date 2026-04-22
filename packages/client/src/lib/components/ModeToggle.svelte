<script lang="ts">
  import { cn } from "@utils";

  type Props = {
    value: string;
    onChange: (v: string) => void;
  };
  let { value, onChange }: Props = $props();

  const opts = [
    { id: "summary", label: "Summary only" },
    { id: "qa", label: "Questions only" },
    { id: "summary+qa", label: "Summary + Socratic Q&A" },
  ];
</script>

<div class="border-border-default inline-flex rounded-lg border bg-gray-50 p-0.5">
  {#each opts as o (o.id)}
    <button
      type="button"
      onclick={() => onChange(o.id)}
      class={cn(
        "cursor-pointer rounded-md border-0 px-2.5 py-[5px] text-[11.5px] font-medium transition-colors",
        value === o.id
          ? "text-cobalt-600 bg-white shadow-sm"
          : "text-text-secondary hover:text-text-primary bg-transparent",
      )}
    >
      {o.label}
    </button>
  {/each}
</div>
