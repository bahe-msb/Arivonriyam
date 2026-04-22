// Top-level lib barrel. Prefer specialised aliases (@components, @mocks) in app code;
// this re-exports them for `import ... from "@lib"` callers.
export * as components from "./components/index.js";
export * as mocks from "./mocks/index.js";
