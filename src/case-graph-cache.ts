/** Dependency-aware cache. In-flight reads register dependencies before awaiting I/O. */
export class CaseGraphCache<T> {
  private cached = new Map<string, { value: T; dependencies: Set<string> }>();
  private pending = new Map<
    string,
    { dependencies: Set<string>; controller: AbortController; promise: Promise<T | undefined> }
  >();
  constructor(
    private limit = 12,
    private normalize: (uri: string) => string = (uri) => uri,
  ) {}
  *values() {
    for (const entry of this.cached.values()) yield entry.value;
  }
  get(
    key: string,
    force: boolean,
    build: (track: (uri: string) => void, signal: AbortSignal) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    const pending = this.pending.get(key);
    if (pending) return pending.promise;
    const old = this.cached.get(key);
    if (old && !force) {
      this.cached.delete(key);
      this.cached.set(key, old);
      return Promise.resolve(old.value);
    }
    const entry: {
      dependencies: Set<string>;
      controller: AbortController;
      promise: Promise<T | undefined>;
    } = {
      dependencies: new Set([this.normalize(key)]),
      controller: new AbortController(),
      promise: Promise.resolve(undefined),
    };
    this.pending.set(key, entry);
    entry.promise = Promise.resolve()
      .then(() =>
        build((uri) => entry.dependencies.add(this.normalize(uri)), entry.controller.signal),
      )
      .then((value) => {
        if (entry.controller.signal.aborted) return undefined;
        if (value !== undefined) {
          this.cached.delete(key);
          this.cached.set(key, { value, dependencies: entry.dependencies });
          while (this.cached.size > this.limit)
            this.cached.delete(this.cached.keys().next().value!);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === entry) this.pending.delete(key);
      });
    return entry.promise;
  }
  invalidate(uri?: string): Set<string> {
    uri = uri === undefined ? undefined : this.normalize(uri);
    const affected = new Set<string>();
    for (const [key, entry] of this.cached) {
      if (uri && !entry.dependencies.has(uri)) continue;
      affected.add(key);
      this.cached.delete(key);
    }
    for (const [key, entry] of this.pending) {
      if (uri && !entry.dependencies.has(uri)) continue;
      affected.add(key);
      entry.controller.abort();
      this.pending.delete(key);
    }
    return affected;
  }
}

/** A slow earlier check may return to its caller, but cannot replace the selected case. */
export class CaseSelection {
  key?: string;
  private sequence = 0;
  select(key: string) {
    this.key = key;
    const sequence = ++this.sequence;
    return () => this.key === key && this.sequence === sequence;
  }
}
