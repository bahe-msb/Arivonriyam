export interface SchoolConfig {
  school_name: string;
  location: string;
  state: string;
  teacher_name: string;
  teacher_id: string;
}

export interface StudentRecord {
  id: string;
  class_id: number;
  name: string;
  emoji: string;
}

const EMOJIS = ["🦁", "🌻", "🦚", "🌙", "🐬", "🌈", "🦋", "🐘", "🌺", "🦜", "🐯", "🌸"];

export function pickEmoji(index: number): string {
  return EMOJIS[index % EMOJIS.length];
}

class SchoolConfigStore {
  config = $state<SchoolConfig>({
    school_name: "",
    location: "",
    state: "",
    teacher_name: "",
    teacher_id: "",
  });

  studentsByClass = $state<Record<number, StudentRecord[]>>({});
  loaded = $state(false);
  loading = $state(false);

  async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const [configRes, studentsRes] = await Promise.all([
        fetch("/api/school/config"),
        fetch("/api/school/students"),
      ]);
      const [configData, studentsData] = await Promise.all([
        configRes.json() as Promise<Partial<SchoolConfig>>,
        studentsRes.json() as Promise<{ students: StudentRecord[] }>,
      ]);

      this.config = {
        school_name: configData.school_name ?? "",
        location: configData.location ?? "",
        state: configData.state ?? "",
        teacher_name: configData.teacher_name ?? "",
        teacher_id: configData.teacher_id ?? "",
      };

      const byClass: Record<number, StudentRecord[]> = {};
      for (const s of studentsData.students ?? []) {
        if (!byClass[s.class_id]) byClass[s.class_id] = [];
        byClass[s.class_id].push(s);
      }
      this.studentsByClass = byClass;
    } catch {
      // Non-fatal — keep defaults
    } finally {
      this.loaded = true;
      this.loading = false;
    }
  }

  async saveConfig(data: SchoolConfig): Promise<void> {
    const res = await fetch("/api/school/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      this.config = data;
    }
  }

  async saveStudents(classId: number, students: Array<{ name: string; emoji: string }>): Promise<void> {
    const res = await fetch("/api/school/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, students }),
    });
    if (res.ok) {
      const data = (await res.json()) as { students: StudentRecord[] };
      this.studentsByClass = {
        ...this.studentsByClass,
        [classId]: data.students,
      };
    }
  }

  getStudentsForClass(classId: number): StudentRecord[] {
    return this.studentsByClass[classId] ?? [];
  }

  hasSetup(): boolean {
    return this.loaded && this.config.school_name.trim().length > 0;
  }
}

export const schoolConfig = new SchoolConfigStore();
