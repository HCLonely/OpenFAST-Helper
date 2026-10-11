import { ManualCompletionRequests } from './editor-completion-requests';
const manualRequests = new ManualCompletionRequests();
let emptyHandler;
let manualIntent;
let manualSequence = 0;
let manualTimer: ReturnType<typeof setTimeout>;
export function armManualCompletion(document, position) {
  manualIntent = {
    id: ++manualSequence,
    document,
    version: document.version,
    line: position.line,
    character: position.character,
    until: Date.now() + 1000,
  };
  clearTimeout(manualTimer);
  manualTimer = setTimeout(() => {
    manualIntent = undefined;
  }, 1000);
  manualTimer.unref?.();
}
export function setEmptyCompletionHandler(handler) {
  emptyHandler = handler;
  return {
    dispose() {
      if (emptyHandler === handler) {
        emptyHandler = undefined;
        manualIntent = undefined;
        clearTimeout(manualTimer);
        manualRequests.dispose();
      }
    },
  };
}
const metrics = new Map<
  string,
  { count: number; failures: number; totalMs: number; maxMs: number; samples: number[] }
>();
export function recordTiming(name: string, elapsed: number, failed = false) {
  if (!metrics.has(name)) {
    if (metrics.size >= 24) metrics.delete(metrics.keys().next().value);
    metrics.set(name, { count: 0, failures: 0, totalMs: 0, maxMs: 0, samples: [] });
  }
  const metric = metrics.get(name);
  const duration = Math.max(0, elapsed);
  metric.count++;
  metric.failures += Number(failed);
  metric.totalMs += duration;
  metric.maxMs = Math.max(metric.maxMs, duration);
  metric.samples.push(duration);
  if (metric.samples.length > 128) metric.samples.shift();
}
export function timed<T>(name: string, run: () => T): T {
  const start = performance.now();
  try {
    const result = run();
    if (result && typeof (result as any).then === 'function')
      return (result as any).then(
        (value) => {
          recordTiming(name, performance.now() - start);
          return value;
        },
        (error) => {
          recordTiming(name, performance.now() - start, true);
          throw error;
        },
      );
    recordTiming(name, performance.now() - start);
    return result;
  } catch (error) {
    recordTiming(name, performance.now() - start, true);
    throw error;
  }
}
export function performanceSummary() {
  return [...metrics].map(([name, m]) => {
    const sorted = [...m.samples].sort((a, b) => a - b);
    return {
      name,
      count: m.count,
      failures: m.failures,
      meanMs: m.totalMs / m.count,
      maxMs: m.maxMs,
      p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0,
      samples: sorted.length,
    };
  });
}
let providerIndex = 0;
export function registerTimedCompletion(vscode, selector, provider, ...triggers) {
  const name = 'completion.' + ++providerIndex;
  return vscode.languages.registerCompletionItemProvider(
    selector,
    {
      ...provider,
      provideCompletionItems(...args) {
        const [document, position, token, context] = args;
        // Invoke also includes automatic identifier suggestions. Only our explicit command arms feedback.
        const manual =
          !!emptyHandler &&
          context?.triggerKind === 0 &&
          manualIntent?.document === document &&
          manualIntent.version === document.version &&
          manualIntent.line === position.line &&
          manualIntent.character === position.character &&
          Date.now() < manualIntent.until;
        const finish = manualRequests.begin(
          document,
          position,
          manual,
          token,
          (doc, pos) => emptyHandler?.(doc, pos),
          () => {
            const editor = vscode.window?.activeTextEditor;
            return (
              editor?.document === document &&
              editor.selection.active.line === position.line &&
              editor.selection.active.character === position.character
            );
          },
          manualIntent?.id,
        );
        try {
          const result = timed(name, () => provider.provideCompletionItems(...args));
          if (result?.then)
            return result.then(
              (items) => {
                finish(items);
                return items;
              },
              (error) => {
                finish(undefined, true);
                throw error;
              },
            );
          finish(result);
          return result;
        } catch (error) {
          finish(undefined, true);
          throw error;
        }
      },
    },
    ...triggers,
  );
}
