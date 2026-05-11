export interface ReteachTopic {
  id: string;
  subject: string;
  topic: string;
  source: "standard" | "custom";
}

const TOPICS_KEY = "arivonriyam.reteach-topics.v1";
const SELECTED_KEY = "arivonriyam.reteach-selected.v2";
const COMPLETED_KEY = "arivonriyam.reteach-completed.v1";

type ApiReteachState = {
  date?: string;
  readOnly?: boolean;
  topicsByClass?: Record<string, ReteachTopic[]>;
  selectedTopicIdsByClass?: Record<string, string>;
  completedTopicIds?: string[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function isReteachTopic(value: unknown): value is ReteachTopic {
  if (!value || typeof value !== "object") return false;

  const topic = value as Partial<ReteachTopic>;
  return (
    typeof topic.id === "string" &&
    typeof topic.subject === "string" &&
    typeof topic.topic === "string" &&
    (topic.source === "standard" || topic.source === "custom")
  );
}

function normalizeTopicsByClass(value: unknown): Record<number, ReteachTopic[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<number, ReteachTopic[]> = {};
  for (const [classId, topics] of Object.entries(value)) {
    const parsedClassId = Number(classId);
    if (!Number.isInteger(parsedClassId) || !Array.isArray(topics)) continue;
    normalized[parsedClassId] = topics.filter(isReteachTopic);
  }

  return normalized;
}

function normalizeSelectedTopicIdsByClass(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<number, string> = {};
  for (const [classId, topicId] of Object.entries(value)) {
    const parsedClassId = Number(classId);
    if (!Number.isInteger(parsedClassId) || typeof topicId !== "string" || !topicId.trim()) {
      continue;
    }
    normalized[parsedClassId] = topicId;
  }

  return normalized;
}

function normalizeCompletedTopicIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (topicId): topicId is string => typeof topicId === "string" && topicId.trim().length > 0,
  );
}

class ReteachTopicsStore {
  currentDate = $state<string>(todayKey());
  topicsByClass = $state<Record<number, ReteachTopic[]>>({});
  selectedTopicIdsByClass = $state<Record<number, string>>({});
  completedTopicIds = $state<string[]>([]);
  loaded = $state(false);
  loading = $state(false);

  private loadedDate: string | null = null;
  private persistQueue: Promise<void> = Promise.resolve();

  get readOnly(): boolean {
    return this.currentDate !== todayKey();
  }

  private clearLegacyStorage(): void {
    if (typeof window === "undefined") return;

    window.localStorage.removeItem(TOPICS_KEY);
    window.localStorage.removeItem(SELECTED_KEY);
    window.localStorage.removeItem(COMPLETED_KEY);
  }

  private applyState(state: ApiReteachState): void {
    this.topicsByClass = normalizeTopicsByClass(state.topicsByClass);
    this.selectedTopicIdsByClass = normalizeSelectedTopicIdsByClass(state.selectedTopicIdsByClass);
    this.completedTopicIds = normalizeCompletedTopicIds(state.completedTopicIds);
    this.pruneInvalidSelections();
  }

  private snapshot(): ApiReteachState {
    return {
      date: this.currentDate,
      topicsByClass: Object.fromEntries(
        Object.entries(this.topicsByClass).map(([classId, topics]) => [classId, topics]),
      ),
      selectedTopicIdsByClass: Object.fromEntries(
        Object.entries(this.selectedTopicIdsByClass).map(([classId, topicId]) => [
          classId,
          topicId,
        ]),
      ),
      completedTopicIds: [...this.completedTopicIds],
    };
  }

  private pruneInvalidSelections(): void {
    const next: Record<number, string> = {};

    for (const [classIdText, topicId] of Object.entries(this.selectedTopicIdsByClass)) {
      const classId = Number(classIdText);
      const topics = this.topicsByClass[classId] ?? [];
      const exists = topics.some((topic) => topic.id === topicId);
      if (!exists || this.completedTopicIds.includes(topicId)) continue;
      next[classId] = topicId;
    }

    this.selectedTopicIdsByClass = next;
  }

  async setDate(date: string): Promise<void> {
    if (this.currentDate === date && this.loaded) return;
    this.currentDate = date;
    await this.load(true);
  }

  async load(force = false): Promise<void> {
    if (this.loading) return;
    const date = this.currentDate;
    if (this.loaded && !force && this.loadedDate === date) return;

    this.loading = true;
    this.clearLegacyStorage();

    try {
      const response = await fetch(`/api/reteach/state?date=${encodeURIComponent(date)}`);
      const data = (await response.json()) as ApiReteachState;
      // Only apply if the user hasn't navigated to a different date mid-flight.
      if (this.currentDate === date) {
        this.applyState(data);
        this.loadedDate = date;
      }
    } catch {
      if (this.currentDate === date) {
        this.applyState({});
        this.loadedDate = date;
      }
    } finally {
      this.loaded = true;
      this.loading = false;
    }
  }

  private queuePersist(): void {
    // Past days are read-only — never write.
    if (this.readOnly) return;
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await fetch("/api/reteach/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(this.snapshot()),
          });
        } catch {
          // Non-fatal — the server is the source of truth when available.
        }
      });
  }

  get(classId: number): ReteachTopic[] {
    return this.topicsByClass[classId] ?? [];
  }

  getSelectedTopic(classId: number): ReteachTopic | null {
    const selectedTopicId = this.selectedTopicIdsByClass[classId];
    if (!selectedTopicId || this.completedTopicIds.includes(selectedTopicId)) {
      if (selectedTopicId) this.clearSelection(classId);
      return null;
    }

    return this.get(classId).find((topic) => topic.id === selectedTopicId) ?? null;
  }

  set(classId: number, topics: ReteachTopic[]): void {
    if (this.readOnly) return;
    this.topicsByClass = { ...this.topicsByClass, [classId]: [...topics] };

    const selectedTopicId = this.selectedTopicIdsByClass[classId];
    if (selectedTopicId && !topics.some((topic) => topic.id === selectedTopicId)) {
      const nextSelected = { ...this.selectedTopicIdsByClass };
      delete nextSelected[classId];
      this.selectedTopicIdsByClass = nextSelected;
    }

    this.queuePersist();
  }

  add(classId: number, topic: ReteachTopic): void {
    if (this.readOnly) return;
    this.topicsByClass = {
      ...this.topicsByClass,
      [classId]: [...(this.topicsByClass[classId] ?? []), topic],
    };
    this.queuePersist();
  }

  remove(classId: number, topicId: string): void {
    if (this.readOnly) return;
    this.topicsByClass = {
      ...this.topicsByClass,
      [classId]: (this.topicsByClass[classId] ?? []).filter((t) => t.id !== topicId),
    };

    if (this.selectedTopicIdsByClass[classId] === topicId) {
      const nextSelected = { ...this.selectedTopicIdsByClass };
      delete nextSelected[classId];
      this.selectedTopicIdsByClass = nextSelected;
    }

    this.queuePersist();
  }

  hasTopics(classId: number): boolean {
    return (this.topicsByClass[classId] ?? []).length > 0;
  }

  selectTopic(topic: ReteachTopic, classId: number): void {
    if (this.readOnly) return;
    if (this.completedTopicIds.includes(topic.id)) return;
    this.selectedTopicIdsByClass = { ...this.selectedTopicIdsByClass, [classId]: topic.id };
    this.queuePersist();
  }

  clearSelection(classId: number): void {
    if (this.readOnly) return;
    const next = { ...this.selectedTopicIdsByClass };
    delete next[classId];
    this.selectedTopicIdsByClass = next;
    this.queuePersist();
  }

  markCompleted(topicId: string): void {
    if (this.readOnly) return;
    if (!this.completedTopicIds.includes(topicId)) {
      this.completedTopicIds = [...this.completedTopicIds, topicId];
    }

    const next = Object.fromEntries(
      Object.entries(this.selectedTopicIdsByClass).filter(
        ([, selectedTopicId]) => selectedTopicId !== topicId,
      ),
    ) as Record<number, string>;

    if (Object.keys(next).length !== Object.keys(this.selectedTopicIdsByClass).length) {
      this.selectedTopicIdsByClass = next;
    }

    this.queuePersist();
  }

  isCompleted(topicId: string): boolean {
    return this.completedTopicIds.includes(topicId);
  }
}

export const reteachTopics = new ReteachTopicsStore();
