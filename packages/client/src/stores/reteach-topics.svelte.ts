export interface ReteachTopic {
  id: string;
  subject: string;
  topic: string;
  source: "standard" | "custom";
}

const TOPICS_KEY = "arivonriyam.reteach-topics.v1";
const SELECTED_KEY = "arivonriyam.reteach-selected.v2";
const COMPLETED_KEY = "arivonriyam.reteach-completed.v1";

function readTopics(): Record<number, ReteachTopic[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TOPICS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<number, ReteachTopic[]>;
  } catch {
    return {};
  }
}

// selectedTopicByClass: Record<number, ReteachTopic> — one selected topic per class
function readSelectedByClass(): Record<number, ReteachTopic> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SELECTED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<number, ReteachTopic>;
  } catch {
    return {};
  }
}

function readCompleted(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPLETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

class ReteachTopicsStore {
  topicsByClass = $state<Record<number, ReteachTopic[]>>(readTopics());
  selectedTopicByClass = $state<Record<number, ReteachTopic>>(readSelectedByClass());
  completedTopicIds = $state<string[]>(readCompleted());

  private persistTopics(): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOPICS_KEY, JSON.stringify(this.topicsByClass));
  }

  private persistSelected(): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SELECTED_KEY, JSON.stringify(this.selectedTopicByClass));
  }

  private persistCompleted(): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMPLETED_KEY, JSON.stringify(this.completedTopicIds));
  }

  get(classId: number): ReteachTopic[] {
    return this.topicsByClass[classId] ?? [];
  }

  getSelectedTopic(classId: number): ReteachTopic | null {
    const selected = this.selectedTopicByClass[classId] ?? null;
    if (!selected || !this.completedTopicIds.includes(selected.id)) return selected;

    const next = { ...this.selectedTopicByClass };
    delete next[classId];
    this.selectedTopicByClass = next;
    this.persistSelected();
    return null;
  }

  set(classId: number, topics: ReteachTopic[]): void {
    this.topicsByClass[classId] = topics;
    this.persistTopics();
  }

  add(classId: number, topic: ReteachTopic): void {
    this.topicsByClass[classId] = [...(this.topicsByClass[classId] ?? []), topic];
    this.persistTopics();
  }

  remove(classId: number, topicId: string): void {
    this.topicsByClass[classId] = (this.topicsByClass[classId] ?? []).filter(
      (t) => t.id !== topicId,
    );
    this.persistTopics();
  }

  hasTopics(classId: number): boolean {
    return (this.topicsByClass[classId] ?? []).length > 0;
  }

  selectTopic(topic: ReteachTopic, classId: number): void {
    if (this.completedTopicIds.includes(topic.id)) return;
    this.selectedTopicByClass = { ...this.selectedTopicByClass, [classId]: topic };
    this.persistSelected();
  }

  clearSelection(classId: number): void {
    const next = { ...this.selectedTopicByClass };
    delete next[classId];
    this.selectedTopicByClass = next;
    this.persistSelected();
  }

  markCompleted(topicId: string): void {
    if (!this.completedTopicIds.includes(topicId)) {
      this.completedTopicIds = [...this.completedTopicIds, topicId];
      this.persistCompleted();
    }

    const next = Object.fromEntries(
      Object.entries(this.selectedTopicByClass).filter(([, topic]) => topic?.id !== topicId),
    ) as Record<number, ReteachTopic>;

    if (Object.keys(next).length !== Object.keys(this.selectedTopicByClass).length) {
      this.selectedTopicByClass = next;
      this.persistSelected();
    }
  }

  isCompleted(topicId: string): boolean {
    return this.completedTopicIds.includes(topicId);
  }
}

export const reteachTopics = new ReteachTopicsStore();
