import { Select as SelectPrimitive } from "bits-ui";
import Trigger from "./SelectTrigger.svelte";
import Content from "./SelectContent.svelte";
import Item from "./SelectItem.svelte";

const Root = SelectPrimitive.Root;
const Value = SelectPrimitive.Trigger; // trigger exposes selected value via snippet

export { Root, Trigger, Content, Item, Value };
