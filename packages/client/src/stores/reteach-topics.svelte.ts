export interface ReteachTopic {
  id: string;
  subject: string;
  topic: string;
  source: "standard" | "custom";
}

class ReteachTopicsStore {
  topicsByClass = $state<Record<number, ReteachTopic[]>>({});
  selectedTopic = $state<ReteachTopic | null>(null);

  get(classId: number): ReteachTopic[] {
    return this.topicsByClass[classId] ?? [];
  }

  set(classId: number, topics: ReteachTopic[]): void {
    this.topicsByClass[classId] = topics;
  }

  add(classId: number, topic: ReteachTopic): void {
    this.topicsByClass[classId] = [...(this.topicsByClass[classId] ?? []), topic];
  }

  remove(classId: number, topicId: string): void {
    this.topicsByClass[classId] = (this.topicsByClass[classId] ?? []).filter(
      (t) => t.id !== topicId,
    );
  }

  hasTopics(classId: number): boolean {
    return (this.topicsByClass[classId] ?? []).length > 0;
  }

  selectTopic(topic: ReteachTopic): void {
    this.selectedTopic = topic;
  }
}

export const reteachTopics = new ReteachTopicsStore();
