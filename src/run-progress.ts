import { open } from 'node:fs/promises';

export interface SolverProgress {
  current: number;
  total: number;
  percent: number;
  completionClock?: string;
  remainingSeconds?: number;
  reportedAt: number;
  raw: string;
}
export interface SolverEstimate {
  completionClock: string;
  remainingSeconds?: number;
  reportedAt: number;
  raw: string;
}
const number = '[+\\-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eEdD][+\\-]?\\d+)?';
const timePattern = new RegExp(`\\bTime:\\s*(${number})\\s+of\\s+(${number})\\s+seconds\\b`, 'i');
const durationPattern = new RegExp(
  `\\(in\\s+(${number})\\s*(days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|s)\\s*\\)`,
  'i',
);
const numeric = (value: string) => Number(value.replace(/[dD]/, 'e'));

export function parseEstimate(line: string, reportedAt = Date.now()): SolverEstimate | undefined {
  const marker = /Estimated final completion at\s+(\d{2}:\d{2}:\d{2})/gi;
  let latest: SolverEstimate;
  for (const clock of line.matchAll(marker)) {
    const rest = line.slice(clock.index + clock[0].length);
    const duration = durationPattern.exec(rest);
    // A partial new estimate must not erase the last complete one.
    if (/^\s*\(in/i.test(rest) && (!duration || duration.index !== rest.search(/\S/))) continue;
    if (!duration && !/^\s*\.?\s*$/.test(rest)) continue;
    let remainingSeconds: number;
    if (duration) {
      const unit = duration[2].toLowerCase();
      const scale = unit.startsWith('day')
        ? 86400
        : /^(hour|hr)/.test(unit)
          ? 3600
          : /^(minute|min)/.test(unit)
            ? 60
            : 1;
      remainingSeconds = numeric(duration[1]) * scale;
      if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) continue;
    }
    latest = {
      completionClock: clock[1],
      remainingSeconds,
      reportedAt,
      raw: line
        .slice(
          clock.index,
          duration
            ? clock.index + clock[0].length + duration.index + duration[0].length
            : undefined,
        )
        .trim(),
    };
  }
  return latest;
}

/** Parses only solver status lines, never derives ETA from wall time or CPU usage. */
export function parseProgress(line: string, reportedAt = Date.now()): SolverProgress | undefined {
  const clean = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  const match = timePattern.exec(clean);
  if (!match) return;
  const current = numeric(match[1]);
  const total = numeric(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || current < 0 || total <= 0) return;
  const clock = /Estimated final completion at\s+(\d{2}:\d{2}:\d{2})/i.exec(clean);
  const duration = clock && durationPattern.exec(clean.slice(clock.index));
  let remainingSeconds: number;
  if (duration) {
    const unit = duration[2].toLowerCase();
    const multiplier = unit.startsWith('day')
      ? 86400
      : /^(hour|hr)/.test(unit)
        ? 3600
        : /^(minute|min)/.test(unit)
          ? 60
          : 1;
    const seconds = numeric(duration[1]) * multiplier;
    if (Number.isFinite(seconds) && seconds >= 0) remainingSeconds = seconds;
  }
  return {
    current,
    total,
    percent: Math.max(0, Math.min(100, (current / total) * 100)),
    completionClock: clock?.[1],
    remainingSeconds,
    reportedAt,
    raw: clean.slice(-2048),
  };
}

/** CR redraws and arbitrary stdout chunks are supported with bounded memory. */
export class ProgressStream {
  private pending = '';
  latest?: SolverProgress;
  estimate?: SolverEstimate;
  feed(chunk: string, at = Date.now()): SolverProgress | undefined {
    const lines = (this.pending + chunk).split(/[\r\n]/);
    this.pending = lines.pop().slice(-8192);
    for (const line of [...lines, this.pending]) {
      const progress = parseProgress(line, at);
      if (progress && progress.raw !== this.latest?.raw) this.latest = progress;
      const estimate = parseEstimate(line, at);
      if (estimate && estimate.raw !== this.estimate?.raw) this.estimate = estimate;
    }
    return this.latest;
  }
}

/** Read at most 128 KiB, even for multi-gigabyte redirected logs. */
export async function readLogTail(filename: string): Promise<{ text: string; modified: number }> {
  const file = await open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw Error('Not a regular log file');
    const length = Math.min(stat.size, 128 * 1024);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, stat.size - length);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (stat.size > length) text = text.replace(/^[^\r\n]*(?:\r\n?|\n)/, '');
    return { text, modified: stat.mtimeMs };
  } finally {
    await file.close();
  }
}
