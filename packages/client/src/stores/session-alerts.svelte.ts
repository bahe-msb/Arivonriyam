export interface SessionAlertMiss {
  id: string;
  question: string;
  selectedOption: string;
  correctOption: string;
  explain: string;
}

export interface SessionAlertRecord {
  id: string;
  sessionId: string;
  classId: number;
  className: string;
  studentId: string;
  studentName: string;
  studentEmoji: string;
  topic: string;
  subject: string;
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  score: number;
  missedQuestions: SessionAlertMiss[];
  createdAt: string;
}

const STORAGE_KEY = "arivonriyam.session-alerts.v1";

function isAlertMiss(value: unknown): value is SessionAlertMiss {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<SessionAlertMiss>;
  return (
    typeof record.id === "string" &&
    typeof record.question === "string" &&
    typeof record.selectedOption === "string" &&
    typeof record.correctOption === "string" &&
    typeof record.explain === "string"
  );
}

function isAlertRecord(value: unknown): value is SessionAlertRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<SessionAlertRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.classId === "number" &&
    typeof record.className === "string" &&
    typeof record.studentId === "string" &&
    typeof record.studentName === "string" &&
    typeof record.studentEmoji === "string" &&
    typeof record.topic === "string" &&
    typeof record.subject === "string" &&
    typeof record.totalQuestions === "number" &&
    typeof record.correctCount === "number" &&
    typeof record.incorrectCount === "number" &&
    typeof record.score === "number" &&
    typeof record.createdAt === "string" &&
    Array.isArray(record.missedQuestions) &&
    record.missedQuestions.every(isAlertMiss)
  );
}

class SessionAlertsStore {
  records = $state<SessionAlertRecord[]>([]);

  constructor() {
    if (typeof window === "undefined") return;

    this.records = this.read();
    window.addEventListener("storage", this.handleStorage);
  }

  private handleStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    this.records = this.read();
  };

  private read(): SessionAlertRecord[] {
    if (typeof window === "undefined") return [];

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isAlertRecord);
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
  }

  replaceSession(sessionId: string, nextRecords: SessionAlertRecord[]): void {
    const fresh = nextRecords.filter((record) => record.sessionId === sessionId);
    const preserved = this.records.filter((record) => record.sessionId !== sessionId);

    this.records = [...fresh, ...preserved].sort((left, right) => {
      const byTime = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (byTime !== 0) return byTime;
      return right.incorrectCount - left.incorrectCount;
    });

    this.persist();
  }

  count(): number {
    return this.records.length;
  }

  countForClass(classId: number): number {
    return this.records.filter((record) => record.classId === classId).length;
  }

  getByClass(classId: number): SessionAlertRecord[] {
    return this.records.filter((record) => record.classId === classId);
  }
}

export const sessionAlerts = new SessionAlertsStore();
