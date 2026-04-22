export type ClassAccent = "saffron" | "cobalt" | "sage" | "rose" | "slate";

export interface ClassInfo {
  id: number;
  name: string;
  ta: string;
  color: string;
  students: number;
  accent: ClassAccent;
}

export const CLASSES: ClassInfo[] = [
  { id: 1, name: "Class 1", ta: "வகுப்பு ௧", color: "#E6B267", students: 5, accent: "saffron" },
  { id: 2, name: "Class 2", ta: "வகுப்பு ௨", color: "#6B94E7", students: 6, accent: "cobalt" },
  { id: 3, name: "Class 3", ta: "வகுப்பு ௩", color: "#8FB89A", students: 4, accent: "sage" },
  { id: 4, name: "Class 4", ta: "வகுப்பு ௪", color: "#C89BB8", students: 5, accent: "rose" },
  { id: 5, name: "Class 5", ta: "வகுப்பு ௫", color: "#7A8CA8", students: 4, accent: "slate" },
];

export function getClass(id: number): ClassInfo | undefined {
  return CLASSES.find((c) => c.id === id);
}
