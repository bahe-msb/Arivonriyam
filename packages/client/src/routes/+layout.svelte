<script lang="ts">
  import type { Snippet } from "svelte";
  import { Sidebar } from "@shadcn";
  import { AppSidebar, TopBar } from "@components";
  import "../app.css";

  type Props = { children?: Snippet };
  let { children }: Props = $props();
</script>

<Sidebar.Provider>
  <div class="flex h-full w-full flex-col overflow-hidden">
    <TopBar />
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <AppSidebar />
      <Sidebar.Inset>
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {@render children?.()}
        </div>
      </Sidebar.Inset>
    </div>
  </div>
</Sidebar.Provider>
