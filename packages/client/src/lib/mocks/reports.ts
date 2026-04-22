export interface ReportRow {
  cls: number;
  students: number;
  taught: number;
  retaught: number;
  completed: number;
  struggling: number;
}

export const REPORT_ROWS: ReportRow[] = [
  { cls: 1, students: 5, taught: 2, retaught: 1, completed: 92, struggling: 0 },
  { cls: 2, students: 6, taught: 3, retaught: 2, completed: 88, struggling: 1 },
  { cls: 3, students: 4, taught: 2, retaught: 2, completed: 81, struggling: 1 },
  { cls: 4, students: 5, taught: 3, retaught: 1, completed: 95, struggling: 0 },
  { cls: 5, students: 4, taught: 2, retaught: 1, completed: 86, struggling: 0 },
];
