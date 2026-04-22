export type StudentStatus = "ok" | "struggle";

export interface Student {
  id: string;
  name: string;
  emoji: string;
  streak: number;
  status: StudentStatus;
}

export const STUDENTS_BY_CLASS: Record<number, Student[]> = {
  3: [
    { id: "bala", name: "Bala", emoji: "🦁", streak: 4, status: "ok" },
    { id: "meena", name: "Meena", emoji: "🌻", streak: 3, status: "ok" },
    { id: "arjun", name: "Arjun", emoji: "🦚", streak: 1, status: "struggle" },
    { id: "divya", name: "Divya", emoji: "🌙", streak: 5, status: "ok" },
  ],
};
