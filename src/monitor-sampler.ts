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
}
const numeric = (value: string) => Number(value.replace(/[dD]/g, 'e'));
export function outputTime(text: string, columns?: number): number | undefined {
  // Only complete data rows: the writer may currently be flushing the last row.
  const complete = text.slice(0, Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1);
  for (const line of complete.split(/\r\n|\r|\n/).reverse()) {
    const values = line.trim().split(/\s+/);
    const time = numeric(values[0]);
    if (
      values.length >= 2 &&
      (columns === undefined || values.length === columns) &&
      Number.isFinite(time) &&
      time >= 0 &&
      (Number.isFinite(numeric(values[1])) || /^\*+$/.test(values[1]))
    )
      return time;
  }
}
/** Only case-root module outputs with an explicit leading Time column are eligible. */
async function moduleOutputs(stem: string): Promise<string[]> {
  const results: string[] = [];
  const prefix = path.basename(stem).toLowerCase() + '.';
  let count = 0;
  try {
    const folder = await opendir(path.dirname(stem));
    for await (const item of folder) {
      if (++count > 1000 || results.length >= 32) break;
      const name = item.name.toLowerCase();
      if (
        item.isFile() &&
        name.startsWith(prefix) &&
        name !== prefix + 'out' &&
        /\.(out|dbg\d*)$/.test(name)
      )
        results.push(path.join(path.dirname(stem), item.name));
    }
  } catch {
    /* Module output files are optional. */
  }
  return results;
}
async function timeColumns(filename: string): Promise<number | undefined> {
  const file = await open(filename, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const match = /^\s*Time[ \t]+([^\r\n]+)[\r\n]/im.exec(header);
    return match ? 1 + match[1].trim().split(/\s+/).length : undefined;
  } finally {
    await file.close();
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
async function listLogs(dir: string): Promise<string[]> {
  const results: string[] = [];
  const folders = [{ directory: dir, depth: 0 }];
  let count = 0;
  // 不依赖启动器文件或特定目录名；整个扫描共享数量与深度限制。
  for (let index = 0; index < folders.length && count < 1000 && results.length < 100; index++) {
    const { directory, depth } = folders[index];
    try {
      const folder = await opendir(directory);
      for await (const item of folder) {
        if (++count > 1000 || results.length >= 100) break;
        const filename = path.join(directory, item.name);
        if (item.isFile() && /\.(log|stdout|stderr|txt)$/i.test(item.name)) results.push(filename);
        else if (
          depth < 2 &&
          folders.length < 100 &&
          item.isDirectory() &&
          !item.isSymbolicLink() &&
          !['.git', 'node_modules'].includes(item.name.toLowerCase())
        )
          folders.push({ directory: filename, depth: depth + 1 });
      }
    } catch {
      /* A log directory is optional or may disappear while scanning. */
    }
  }
  return results;
}

/** Samples solver reports and fresh text result records; never infers progress from file size. */
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
  if (request.allowDirectoryLogs) {
    for (const file of await listLogs(dir)) candidates.add(file);
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
    const total = await totalTime(request.input);
    const outputs = [stem + '.out', ...(await moduleOutputs(stem))];
    for (const filename of outputs) {
      if (!total) break;
      try {
        const tail = await readLogTail(filename);
        if (!fresh(tail.modified)) continue;
        // 模块输出必须有 Time 列；按表头列数排除正在写入的不完整数据行。
        const columns = await timeColumns(filename);
        if (!columns) continue;
        const current = outputTime(tail.text, columns);
        if (current === undefined || current > total || current <= (result.progress?.current ?? -1))
          continue;
        result.progress = {
          current,
          total,
          percent: Math.min(100, (current / total) * 100),
          reportedAt: tail.modified,
          raw: path.basename(filename) + ': ' + current + ' / ' + total,
        };
        result.source = 'output';
      } catch {
        /* One absent or buffered output must not hide another module's records. */
      }
    }
  } catch {
    /* Output may be absent, buffered or binary only. */
  }
  return result;
}
