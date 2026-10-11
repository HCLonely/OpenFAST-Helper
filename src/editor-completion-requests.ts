/** Coalesce providers for one manual request; never infer emptiness while work is pending. */
export class ManualCompletionRequests {
  private states = new WeakMap<object, any>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(private delay = 200) {}
  begin(document, position, manual: boolean, token, notify, stillCurrent = () => true, requestId?) {
    if (!manual) return () => {};
    const key = `${document.version}:${position.line}:${position.character}:${requestId ?? ''}`;
    let state = this.states.get(document);
    if (requestId !== undefined && state?.key === key && state.done) return () => {};
    if (!state || state.key !== key || state.done) {
      state = {
        key,
        version: document.version,
        pending: 0,
        hasItems: false,
        veto: false,
        done: false,
      };
      this.states.set(document, state);
    }
    if (state.timer) {
      clearTimeout(state.timer);
      this.timers.delete(state.timer);
    }
    state.pending++;
    let finished = false;
    return (result?, failed = false) => {
      if (finished) return;
      finished = true;
      state.pending--;
      state.hasItems ||= (Array.isArray(result) ? result.length : result?.items?.length || 0) > 0;
      state.veto ||= failed || token?.isCancellationRequested;
      if (state.pending || state.done) return;
      state.timer = setTimeout(() => {
        this.timers.delete(state.timer);
        state.done = true;
        if (
          this.states.get(document) !== state ||
          state.hasItems ||
          state.veto ||
          token?.isCancellationRequested ||
          document.isClosed ||
          document.version !== state.version ||
          !stillCurrent()
        )
          return;
        void notify(document, position);
      }, this.delay);
      this.timers.add(state.timer);
    };
  }
  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.states = new WeakMap();
  }
}
