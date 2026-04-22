<script lang="ts">
  type Props = {
    name?: string;
    role?: string;
    initials?: string;
  };
  let {
    name = "Kavitha R.",
    role = "Teacher · Govt. Primary School, Thenkarai",
    initials = "KR",
  }: Props = $props();
</script>

<div class="ml-1.5 flex items-center gap-2.5 border-l border-white/10 pl-4">
  <div
    class="bg-saffron-300 grid size-[30px] place-items-center
           rounded-full border border-white/20 text-xs
           font-semibold text-[#4a2e00]"
  >
    {initials}
  </div>
  <div class="hidden leading-[1.15] md:block">
    <div class="text-[13px] font-medium">{name}</div>
    <div class="text-[11px] text-white/55">{role}</div>
  </div>
</div>
