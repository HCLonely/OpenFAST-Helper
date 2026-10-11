/** VS Code has no public IME composition event. Protect recently changed CJK rows. */
type Quiet = { until: number; ranges: { first: number; last: number }[]; all: boolean };
const quiet = new WeakMap<object, Quiet>();
const resources = new Map<string, Quiet>();
export function noteInput(event, now = Date.now()) {
  const key = event.document.uri?.toString(),
    previous = key ? resources.get(key) : quiet.get(event.document);
  const shifted = event.contentChanges?.some(
    (c) => c.text.includes('\n') || (c.range && c.range.start.line !== c.range.end.line),
  );
  if (shifted) {
    quiet.delete(event.document);
    if (key) resources.delete(key);
  }
  const changes =
    event.contentChanges?.filter((c) =>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c.text),
    ) || [];
  if (!changes.length) return;
  const ranges = changes
    .filter((c) => c.range)
    .map((c) => ({
      first: c.range.start.line,
      last: c.range.start.line + c.text.split('\n').length - 1,
    }));
  const state = {
    until: now + 800,
    ranges: [...(!shifted && previous?.until > now ? previous.ranges : []), ...ranges].slice(-32),
    all:
      changes.some((c) => !c.range) || (!shifted && previous?.until > now && previous.all) || false,
  };
  quiet.set(event.document, state);
  if (key) {
    resources.delete(key);
    resources.set(key, state);
    if (resources.size > 256) resources.delete(resources.keys().next().value);
  }
}
export function replacementPaused(document, now = Date.now(), line?: number) {
  line = document.openfastLineMap?.[line] ?? line;
  const state = resources.get(document.uri?.toString()) || quiet.get(document);
  return (
    !!state &&
    now < state.until &&
    (line === undefined || state.all || state.ranges.some((r) => line >= r.first && line <= r.last))
  );
}
export function currentRevision(document, revision: number) {
  return !document.isClosed && document.version === revision;
}
