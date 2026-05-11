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

type ApiAlertRecord = {
  id: string;
  session_id: string;
  class_id: number;
  class_name: string;
  student_id: string;
  student_name: string;
  student_emoji: string;
  topic: string;
  subject: string;
  total_questions: number;
  correct_count: number;
  incorrect_count: number;
  score: number;
  missed_questions: unknown;
  created_at: string;
};

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
  loaded = $state(false);
  loading = $state(false);

  private clearLegacyStorage(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
  }

  private todayKey(): string {
    return new Date().toISOString().split("T")[0];
  }

  private normalizeApiRecord(record: ApiAlertRecord): SessionAlertRecord {
    return {
      id: record.id,
      sessionId: record.session_id,
      classId: record.class_id,
      className: record.class_name,
      studentId: record.student_id,
      studentName: record.student_name,
      studentEmoji: record.student_emoji,
      topic: record.topic,
      subject: record.subject,
      totalQuestions: record.total_questions,
      correctCount: record.correct_count,
      incorrectCount: record.incorrect_count,
      score: record.score,
      missedQuestions: Array.isArray(record.missed_questions)
        ? record.missed_questions.filter(isAlertMiss)
        : [],
      createdAt: record.created_at,
    };
  }

  async load(date = this.todayKey(), force = false): Promise<void> {
    if (this.loading) return;
    if (this.loaded && !force && date === this.todayKey()) return;

    this.loading = true;
    this.clearLegacyStorage();

    try {
      const response = await fetch(`/api/alerts?date=${encodeURIComponent(date)}`);
      const data = (await response.json()) as { alerts?: ApiAlertRecord[] };
      this.records = Array.isArray(data.alerts)
        ? data.alerts.map((record) => this.normalizeApiRecord(record)).filter(isAlertRecord)
        : [];
    } catch {
      this.records = [];
    } finally {
      this.loaded = true;
      this.loading = false;
    }
  }

  private async syncToServer(sessionId: string, records: SessionAlertRecord[]): Promise<void> {
    try {
      await fetch("/api/alerts/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, records }),
      });
    } catch {
      // Non-fatal — keep the in-memory snapshot and retry on next session update.
    }
  }

  replaceSession(sessionId: string, nextRecords: SessionAlertRecord[]): void {
    const fresh = nextRecords.filter((record) => record.sessionId === sessionId);
    const preserved = this.records.filter((record) => record.sessionId !== sessionId);

    this.records = [...fresh, ...preserved].sort((left, right) => {
      const byTime = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (byTime !== 0) return byTime;
      return right.incorrectCount - left.incorrectCount;
    });

    void this.syncToServer(sessionId, fresh);
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
