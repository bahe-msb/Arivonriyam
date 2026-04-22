export type LessonStatus = "planned" | "in-progress" | "done";

export interface TodayEntry {
  subject: string;
  topic: string;
  mins: number;
  status: LessonStatus;
}

export const TODAY_PLAN: Record<number, TodayEntry> = {
  1: { subject: "Tamil", topic: "Vowels — அ, ஆ, இ, ஈ", mins: 40, status: "planned" },
  2: { subject: "Maths", topic: "Number bonds to 20", mins: 45, status: "in-progress" },
  3: { subject: "Science", topic: "Plants around us", mins: 50, status: "planned" },
  4: { subject: "English", topic: "Simple present tense", mins: 45, status: "done" },
  5: { subject: "Social", topic: "Our freedom fighters", mins: 50, status: "planned" },
};

export interface RhythmEntry {
  t: string;
  c: string;
  s: string;
  tone: "done" | "live" | "next" | "planned";
}

export const TODAYS_RHYTHM: RhythmEntry[] = [
  { t: "09:30", c: "Class 1 · Tamil", s: "Vowels walk-through at the board", tone: "done" },
  { t: "10:00", c: "Class 4 · English", s: "Simple present — tablet Socratic", tone: "done" },
  { t: "10:40", c: "Class 2 · Maths", s: "Number bonds — live at the board", tone: "live" },
  {
    t: "11:25",
    c: "Class 3 · Science",
    s: "Plants around us — AI reteach on tablet",
    tone: "next",
  },
  { t: "12:00", c: "Class 5 · Social", s: "Freedom fighters — read aloud + Q&A", tone: "planned" },
];
