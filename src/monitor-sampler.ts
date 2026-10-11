import { open, opendir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProgressStream,
  readLogTail,
  type SolverProgress,
  type SolverEstimate,
} from './run-progress';

export interface SampleInput {
  input?: string;
  pid: number;
  startedAt?: number;
  manualLog?: string;
  linkedLog?: string;
  allowDirectoryLogs?: boolean;
}
export interface ExternalSample {
  progress?: SolverProgress;
  estimate?: SolverEstimate;
  source: 'log' | 'output' | 'none';
  log?: string;
  logText: string;
  modified?: number;
  fatal: boolean;
  normal: boolean;
  stateStatus?: string;
}
const numeric = (value: string) => Number(value.replace(/[dD]/g, 'e'));
export function outputTime(text: string): number | undefined {
  // Only complete data rows: the writer may currently be flushing the last row.
  const complete = text.slice(0, text.lastIndexOf('\n') + 1);
  for (const line of complete.split(/\r?\n/).reverse()) {
    const values = line.trim().split(/\s+/);
    const time = numeric(values[0]);
    if (
      values.length >= 2 &&
      Number.isFinite(time) &&
      time >= 0 &&
      (Number.isFinite(numeric(values[1])) || /^\*+$/.test(values[1]))
    )
      return time;
  }
}
async function totalTime(filename: string) {
  const file = await open(filename, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const text = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/^\uFEFF/, '');
    const match = /^\s*(\S+)\s+TMax\b/im.exec(text);
    const value = match && numeric(match[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } finally {
    await file.close();
  }
}
async function listLogs(dir: string, limit = 100): Promise<string[]> {
  const results: string[] = [];
  let count = 0;
  try {
    const folder = await opendir(dir);
    for await (const item of folder) {
      if (++count > 1000 || results.length >= limit) break;
      if (item.isFile() && /\.(log|stdout)$/i.test(item.name))
        results.push(path.join(dir, item.name));
    }
  } catch {
    /* A log directory is optional. */
  }
  return results;
}

/** Mirrors OpenFAST_Monitor's fresh-log/text-output sampling; never reads binary .outb. */
export async function sampleExternal(request: SampleInput): Promise<ExternalSample> {
  const result: ExternalSample = { source: 'none', logText: '', fatal: false, normal: false };
  if (!request.input) {
    if (request.manualLog) {
      try {
        const tail = await readLogTail(request.manualLog),
          stream = new ProgressStream();
        stream.feed(tail.text, tail.modified);
        result.progress = stream.latest;
        result.estimate = stream.estimate;
        result.log = request.manualLog;
        result.logText = tail.text;
        result.modified = tail.modified;
        result.source = stream.latest ? 'log' : 'none';
      } catch {
        /* A manually selected log can become unavailable. */
      }
    }
    return result;
  }
  const dir = path.dirname(request.input),
    stem = request.input.replace(/\.(fst|fstf)$/i, '');
  const fresh = (modified: number) => !!request.startedAt && modified >= request.startedAt - 1000;
  const candidates = new Set<string>([stem + '.log', stem + '.stdout.log', stem + '.stdout']);
  if (request.manualLog) candidates.add(request.manualLog);
  if (request.linkedLog) candidates.add(request.linkedLog);
  try {
    const stateTail = await readLogTail(path.join(dir, 'run_status.json'));
    const state = JSON.parse(stateTail.text);
    if (state.engine_pid === request.pid && fresh(stateTail.modified)) {
      result.stateStatus = state.status;
      if (typeof state.stdout_log === 'string')
        candidates.add(path.resolve(dir, '..', state.stdout_log));
      if (typeof state.stderr_log === 'string')
        candidates.add(path.resolve(dir, '..', state.stderr_log));
    }
  } catch {
    /* A state file is optional and may be in the middle of a write. */
  }
  if (request.allowDirectoryLogs) {
    for (const file of await listLogs(dir)) candidates.add(file);
    try {
      const runs = await opendir(path.join(dir, 'runs'));
      let count = 0;
      for await (const attempt of runs) {
        if (++count > 100) break;
        if (attempt.isDirectory() && !attempt.isSymbolicLink()) {
          candidates.add(path.join(dir, 'runs', attempt.name, 'stdout.log'));
          candidates.add(path.join(dir, 'runs', attempt.name, 'stderr.log'));
        }
      }
    } catch {
      /* Attempt directories are optional. */
    }
  }
  const ranked: { file: string; modified: number }[] = [];
  for (const file of candidates) {
    if (request.manualLog && file !== request.manualLog) continue;
    try {
      const metadata = await stat(file);
      if (metadata.isFile() && (file === request.manualLog || fresh(metadata.mtimeMs)))
        ranked.push({ file, modified: metadata.mtimeMs });
    } catch {
      /* Missing candidate. */
    }
  }
  ranked.sort((a, b) => b.modified - a.modified);
  for (const candidate of ranked.slice(0, 16)) {
    try {
      const tail = await readLogTail(candidate.file),
        stream = new ProgressStream();
      stream.feed(tail.text, tail.modified);
      result.fatal ||= /FATAL ERROR|Aborting OpenFAST|forrtl: severe|Fortran runtime error/i.test(
        tail.text,
      );
      result.normal ||= /OpenFAST terminated normally/i.test(tail.text);
      if (!result.log) {
        result.log = candidate.file;
        result.logText = tail.text;
        result.modified = tail.modified;
      }
      if (stream.latest && (!result.progress || stream.latest.current > result.progress.current)) {
        result.progress = stream.latest;
        result.source = 'log';
        result.log = candidate.file;
        result.logText = tail.text;
        result.modified = tail.modified;
      }
      if (
        stream.estimate &&
        (!result.estimate || stream.estimate.reportedAt > result.estimate.reportedAt)
      )
        result.estimate = stream.estimate;
    } catch {
      /* A disappearing log must not erase process state. */
    }
  }
  try {
    const total = await totalTime(request.input),
      tail = await readLogTail(stem + '.out');
    if (total && fresh(tail.modified)) {
      const current = outputTime(tail.text);
      if (current !== undefined && (!result.progress || current > result.progress.current)) {
        result.progress = {
          current,
          total,
          percent: Math.min(100, (current / total) * 100),
          reportedAt: tail.modified,
          raw: path.basename(stem + '.out') + ': ' + current + ' / ' + total,
        };
        result.source = 'output';
      }
    }
  } catch {
    /* Output may be absent, buffered or binary only. */
  }
  return result;
}
