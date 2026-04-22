class ActiveClassStore {
  id = $state<number>(3);

  set(id: number): void {
    this.id = id;
  }
}

export const activeClass = new ActiveClassStore();
