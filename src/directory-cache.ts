/** Cache completed listings only: a newer request never waits for an obsolete slow listing. */
export class DirectoryCache<T> {
  private entries = new Map<string, { value: T[]; expires: number }>();
  private pending = new Map<string, object>();
  private retained = 0;
  constructor(
    private ttl = 1500,
    private now = Date.now,
    private maxEntries = 40000,
    private maxDirectories = 24,
  ) {}
  async read(key: string, load: () => Promise<T[]>): Promise<T[]> {
    const old = this.entries.get(key);
    if (old && old.expires > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, old);
      return old.value;
    }
    const request = {};
    this.pending.set(key, request);
    while (this.pending.size > this.maxDirectories)
      this.pending.delete(this.pending.keys().next().value!);
    try {
      const value = await load();
      if (this.pending.get(key) !== request) return [];
      if (value.length <= this.maxEntries) {
        this.remove(key);
        this.entries.set(key, { value, expires: this.now() + this.ttl });
        this.retained += value.length;
        while (this.entries.size > this.maxDirectories || this.retained > this.maxEntries)
          this.remove(this.entries.keys().next().value!);
      }
      return value;
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.retained -= entry.value.length;
    this.entries.delete(key);
  }
  invalidate(key?: string) {
    if (key !== undefined) {
      this.remove(key);
      this.pending.delete(key);
    } else {
      this.entries.clear();
      this.pending.clear();
      this.retained = 0;
    }
  }
}
