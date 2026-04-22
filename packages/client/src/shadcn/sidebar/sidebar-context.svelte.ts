import { getContext, setContext } from "svelte";

const SIDEBAR_KEY = Symbol("sidebar");

export class SidebarState {
  open = $state(true);
  openMobile = $state(false);
  isMobile = $state(false);

  constructor(defaultOpen = true) {
    this.open = defaultOpen;
    if (typeof window !== "undefined") {
      const mql = window.matchMedia("(max-width: 768px)");
      this.isMobile = mql.matches;
      mql.addEventListener("change", (e) => {
        this.isMobile = e.matches;
        if (!e.matches) this.openMobile = false;
      });
    }
  }

  toggle = () => {
    if (this.isMobile) this.openMobile = !this.openMobile;
    else this.open = !this.open;
  };

  get state() {
    return this.open ? "expanded" : "collapsed";
  }
}

export function setSidebarState(defaultOpen = true): SidebarState {
  const ctx = new SidebarState(defaultOpen);
  setContext(SIDEBAR_KEY, ctx);
  return ctx;
}

export function useSidebar(): SidebarState {
  const ctx = getContext<SidebarState>(SIDEBAR_KEY);
  if (!ctx) throw new Error("useSidebar must be used inside SidebarProvider");
  return ctx;
}
