<script lang="ts">
  import { Calendar as CalendarPrimitive } from "bits-ui";
  import { ChevronLeft, ChevronRight } from "lucide-svelte";
  import type { DateValue } from "@internationalized/date";
  import { cn } from "@utils";

  type Props = {
    class?: string;
    value?: DateValue;
    placeholder?: DateValue;
    maxValue?: DateValue;
    minValue?: DateValue;
    onValueChange?: (value: DateValue | undefined) => void;
    weekdayFormat?: "narrow" | "short" | "long";
  };

  let {
    class: className,
    value = $bindable(),
    placeholder = $bindable(),
    maxValue,
    minValue,
    onValueChange,
    weekdayFormat = "short",
  }: Props = $props();
</script>

<CalendarPrimitive.Root
  type="single"
  bind:value
  bind:placeholder
  {maxValue}
  {minValue}
  {weekdayFormat}
  {onValueChange}
  class={cn("rounded-xl border border-border-default bg-white p-3 shadow-sm", className)}
>
  {#snippet children({ months, weekdays })}
    <CalendarPrimitive.Header class="mb-2 flex items-center justify-between px-1">
      <CalendarPrimitive.PrevButton
        class="inline-flex size-7 items-center justify-center rounded-md border border-border-default bg-white text-text-secondary transition-colors hover:bg-gray-50 disabled:opacity-40"
      >
        <ChevronLeft class="size-4" />
      </CalendarPrimitive.PrevButton>
      <CalendarPrimitive.Heading class="text-[13px] font-semibold" />
      <CalendarPrimitive.NextButton
        class="inline-flex size-7 items-center justify-center rounded-md border border-border-default bg-white text-text-secondary transition-colors hover:bg-gray-50 disabled:opacity-40"
      >
        <ChevronRight class="size-4" />
      </CalendarPrimitive.NextButton>
    </CalendarPrimitive.Header>

    {#each months as month (month.value)}
      <CalendarPrimitive.Grid class="w-full border-collapse">
        <CalendarPrimitive.GridHead>
          <CalendarPrimitive.GridRow class="flex">
            {#each weekdays as weekday (weekday)}
              <CalendarPrimitive.HeadCell class="w-8 text-center text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                {weekday.slice(0, 2)}
              </CalendarPrimitive.HeadCell>
            {/each}
          </CalendarPrimitive.GridRow>
        </CalendarPrimitive.GridHead>
        <CalendarPrimitive.GridBody>
          {#each month.weeks as week, i (i)}
            <CalendarPrimitive.GridRow class="mt-0.5 flex w-full">
              {#each week as date (date)}
                <CalendarPrimitive.Cell {date} month={month.value} class="relative size-8 p-0 text-center">
                  <CalendarPrimitive.Day
                    class={cn(
                      "inline-flex size-8 items-center justify-center rounded-md text-[12px] font-medium text-text-body transition-colors hover:bg-cobalt-25",
                      "data-[outside-month]:text-text-tertiary data-[outside-month]:opacity-40",
                      "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-30 data-[disabled]:hover:bg-transparent",
                      "data-[unavailable]:cursor-not-allowed data-[unavailable]:line-through data-[unavailable]:opacity-40",
                      "data-[selected]:bg-cobalt-500 data-[selected]:text-white data-[selected]:hover:bg-cobalt-500",
                      "data-[today]:ring-1 data-[today]:ring-cobalt-300",
                    )}
                  />
                </CalendarPrimitive.Cell>
              {/each}
            </CalendarPrimitive.GridRow>
          {/each}
        </CalendarPrimitive.GridBody>
      </CalendarPrimitive.Grid>
    {/each}
  {/snippet}
</CalendarPrimitive.Root>
