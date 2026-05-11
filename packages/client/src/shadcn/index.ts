// Atomic primitives — named re-exports
export { Button } from "./button/index.js";
export type { ButtonVariant, ButtonSize } from "./button/index.js";
export { Card } from "./card/index.js";
export { Input } from "./input/index.js";
export { Textarea } from "./textarea/index.js";

// Compound components — namespace re-exports (`<Sidebar.Root />`, `<Tabs.List />`, `<Select.Item />`)
export * as Sidebar from "./sidebar/index.js";
export * as Tabs from "./tabs/index.js";
export * as Select from "./select/index.js";
export * as Sheet from "./sheet/index.js";
export * as Popover from "./popover/index.js";
export { Calendar } from "./calendar/index.js";
