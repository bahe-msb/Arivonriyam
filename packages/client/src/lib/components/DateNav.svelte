<script lang="ts">
  import { CalendarDate, getLocalTimeZone, today, type DateValue } from "@internationalized/date";
  import { CalendarDays, ChevronLeft, ChevronRight, Eye } from "lucide-svelte";
  import { Calendar, Popover } from "@shadcn";

  type Props = {
    value: string;
    onChange: (next: string) => void;
    /** Optional label like "Reteach for" shown before the date chip. */
    label?: string;
  };

  let { value, onChange, label }: Props = $props();

  function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function shift(base: string, days: number): string {
    const d = new Date(base + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function format(key: string): string {
    const t = todayKey();
    if (key === t) return "Today";
    if (key === shift(t, -1)) return "Yesterday";
    return new Date(key + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function toCalendarDate(key: string): CalendarDate {
    const [y, m, d] = key.split("-").map(Number);
    return new CalendarDate(y, m, d);
  }

  const todayDV = today(getLocalTimeZone());
  let calendarValue = $state<DateValue | undefined>(undefined);

  $effect(() => {
    calendarValue = toCalendarDate(value);
  });

  let open = $state(false);

  const isToday = $derived(value === todayKey());
  const canForward = $derived(value < todayKey());

  function pickDate(dv: DateValue | undefined): void {
    if (!dv) return;
    const key = `${dv.year.toString().padStart(4, "0")}-${dv.month.toString().padStart(2, "0")}-${dv.day.toString().padStart(2, "0")}`;
    onChange(key);
    open = false;
  }
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if label}
    <span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
      {label}
    </span>
  {/if}

  <button
    type="button"
    onclick={() => onChange(shift(value, -1))}
    class="flex items-center gap-1 rounded-lg border border-border-default bg-white px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-50"
    aria-label="Previous day"
  >
    <ChevronLeft class="size-3.5" />
  </button>

  <Popover.Root bind:open>
    <Popover.Trigger
      class="flex items-center gap-2 rounded-lg border border-border-default bg-white px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-gray-50"
    >
      <CalendarDays class="size-3.5 text-text-secondary" />
      <span>{format(value)}</span>
      {#if !isToday}
        <span class="text-[10px] font-normal text-text-secondary">{value}</span>
        <span class="inline-flex items-center gap-1 rounded-full bg-clay-50 px-2 py-0.5 text-[10px] font-semibold text-[#b45309]">
          <Eye class="size-2.75" /> view only
        </span>
      {/if}
    </Popover.Trigger>
    <Popover.Content class="p-3">
      <Calendar
        bind:value={calendarValue}
        maxValue={todayDV}
        onValueChange={pickDate}
      />
      <div class="mt-2 flex justify-between gap-2">
        <button
          type="button"
          onclick={() => { onChange(shift(todayKey(), -1)); open = false; }}
          class="flex-1 rounded-md border border-border-default bg-white px-2 py-1.5 text-[11px] font-medium hover:bg-gray-50"
        >
          Yesterday
        </button>
        <button
          type="button"
          onclick={() => { onChange(todayKey()); open = false; }}
          class="flex-1 rounded-md border border-cobalt-200 bg-cobalt-25 px-2 py-1.5 text-[11px] font-semibold text-cobalt-600 hover:bg-cobalt-50"
        >
          Today
        </button>
      </div>
    </Popover.Content>
  </Popover.Root>

  <button
    type="button"
    onclick={() => onChange(shift(value, 1))}
    disabled={!canForward}
    class="flex items-center gap-1 rounded-lg border border-border-default bg-white px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
    aria-label="Next day"
  >
    <ChevronRight class="size-3.5" />
  </button>
</div>
