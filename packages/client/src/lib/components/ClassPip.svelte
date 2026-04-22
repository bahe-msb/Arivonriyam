<script lang="ts">
  import type { ClassInfo } from "@mocks";
  type Props = { cls: ClassInfo; size?: number };
  let { cls, size = 10 }: Props = $props();
</script>

<span
  class="inline-block rounded-full"
  style="width:{size}px; height:{size}px; background:{cls.color}; box-shadow: 0 0 0 2px #fff, 0 0 0 3px {cls.color}55;"
></span>
