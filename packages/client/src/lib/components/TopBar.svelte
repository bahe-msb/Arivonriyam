<script lang="ts">
  import Brand from "./Brand.svelte";
  import OfflineChip from "./OfflineChip.svelte";
  import UserChip from "./UserChip.svelte";
  import { Sidebar } from "@shadcn";
</script>

<header
  class="bg-bg-top-bar flex h-14 shrink-0 items-center gap-3 border-b border-[#1a1d2c]
         px-4 text-white md:px-5"
>
  <div class="md:hidden">
    <Sidebar.Trigger />
  </div>
  <Brand />
  <div class="ml-auto flex items-center gap-3">
    <div class="hidden sm:block">
      <OfflineChip />
    </div>
    <UserChip />
  </div>
</header>
