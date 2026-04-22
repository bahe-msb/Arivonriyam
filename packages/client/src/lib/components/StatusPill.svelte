<script lang="ts">
  import Pill, { type PillTone } from "./Pill.svelte";
  import type { LessonStatus } from "@mocks";

  type Props = { status: LessonStatus };
  let { status }: Props = $props();

  const map: Record<LessonStatus, { tone: PillTone; label: string }> = {
    planned: { tone: "default", label: "Planned" },
    "in-progress": { tone: "cobalt", label: "Live now" },
    done: { tone: "success", label: "Done" },
  };
</script>

<Pill tone={map[status].tone}>{map[status].label}</Pill>
