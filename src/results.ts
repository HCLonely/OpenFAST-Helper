import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { t } from './i18n';

export interface ResultMetadata {
  filename: string;
  names: string[];
  units: string[];
  start: number;
  end: number;
  size: number;
  modified: number;
  binary?: {
    id: number;
    rows: number;
    columns: number;
    offset: number;
    timeOffset: number;
    timeA: number;
    timeB: number;
    scale: number[];
    shift: number[];
  };
  headerLines?: number;
}
export interface ResultSeries {
  channel: number;
  name: string;
  unit: string;
  count: number;
  missing: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  points: [number, number | null][];
}
const parseNumber = (text: string): number => {
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?|NaN|Inf(?:inity)?)$/i.test(text))
    throw Error(t('results.malformed'));
  return /^[-+]?inf/i.test(text)
    ? text.startsWith('-')
      ? -Infinity
      : Infinity
    : Number(text.replace(/[dD]/, 'e'));
};
const unit = (value: string) => value.replace(/^\(/, '').replace(/\)$/, '');
interface TextIndex {
  anchors: { time: number; offset: number }[];
  channels: Set<number>;
}
const textIndexes = new WeakMap<ResultMetadata, TextIndex>();

/** Byte offsets remain correct with UTF-8, LF, CRLF (including split CRLF), and CR. */
async function* resultLines(
  filename: string,
  offset = 0,
  signal?: AbortSignal,
  maxLineBytes = 32_000_000,
  maxBytes = Infinity,
) {
  if (signal?.aborted) throw Error(t('results.cancelled'));
  const stream = createReadStream(filename, { start: offset });
  const abort = () => stream.destroy(Error(t('results.cancelled')));
  signal?.addEventListener('abort', abort, { once: true });
  let pending: Buffer = Buffer.alloc(0);
  let consumed = 0;
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw Error(t('results.cancelled'));
      consumed += chunk.length;
      if (consumed > maxBytes) throw Error(t('results.malformed'));
      const data = pending.length ? Buffer.concat([pending, chunk]) : (chunk as Buffer);
      let start = 0;
      for (let i = 0; i < data.length; i++) {
        if (i - start > maxLineBytes) throw Error(t('results.malformed'));
        if (data[i] !== 10 && data[i] !== 13) continue;
        if (data[i] === 13 && i + 1 === data.length) break;
        const end = i;
        if (data[i] === 13 && data[i + 1] === 10) i++;
        yield { line: data.toString('utf8', start, end), offset: offset + start };
        start = i + 1;
      }
      pending = data.subarray(start);
      offset += start;
      // A trailing CR may be the first byte of CRLF split across chunks.
      const pendingLineBytes = pending.length - (pending[pending.length - 1] === 13 ? 1 : 0);
      if (pendingLineBytes > maxLineBytes) throw Error(t('results.malformed'));
    }
    if (pending.length) yield { line: pending.toString('utf8').replace(/\r$/, ''), offset };
  } finally {
    signal?.removeEventListener('abort', abort);
    stream.destroy();
  }
}
async function exactRead(handle, size: number, position: number): Promise<Buffer> {
  if (!Number.isSafeInteger(size) || size < 0 || size > 32_000_000)
    throw Error(t('results.malformed'));
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset);
    if (!bytesRead) throw Error(t('results.truncated'));
    offset += bytesRead;
  }
  return buffer;
}
function checkNames(names: string[], units: string[]): void {
  if (
    names.length < 2 ||
    names.length > 10001 ||
    names.some((n) => !n) ||
    names.length !== units.length ||
    !/^time$/i.test(names[0])
  )
    throw Error(t('results.malformed'));
}

/** Format IDs 1–4 follow OpenFAST/openfast_toolbox io/fast_output_file.py. */
export async function readResultMetadata(
  filename: string,
  signal?: AbortSignal,
): Promise<ResultMetadata> {
  if (signal?.aborted) throw Error(t('results.cancelled'));
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw Error(t('results.malformed'));
  const metadata: ResultMetadata = {
    filename,
    names: [],
    units: [],
    start: 0,
    end: 0,
    size: stat.size,
    modified: stat.mtimeMs,
  };
  const handle = await fs.open(filename, 'r');
  try {
    const probe = await exactRead(handle, Math.min(4, stat.size), 0);
    const id = probe.length >= 2 ? probe.readInt16LE() : 0;
    if ([1, 2, 3, 4].includes(id)) {
      let position = 2;
      const read = async (n: number) => {
        if (signal?.aborted) throw Error(t('results.cancelled'));
        const b = await exactRead(handle, n, position);
        position += n;
        return b;
      };
      const nameLength = id === 4 ? (await read(2)).readInt16LE() : 10;
      const dimensions = await read(8);
      const columns = dimensions.readInt32LE(0),
        rows = dimensions.readInt32LE(4);
      if (columns < 1 || columns > 10000 || rows < 1 || nameLength < 1 || nameLength > 1024)
        throw Error(t('results.malformed'));
      const times = await read(16);
      const timeA = times.readDoubleLE(0),
        timeB = times.readDoubleLE(8);
      if (
        !Number.isFinite(timeA) ||
        !Number.isFinite(timeB) ||
        (id === 1 ? timeA <= 0 : timeB <= 0)
      )
        throw Error(t('results.malformed'));
      const scale = Array(columns).fill(1),
        shift = Array(columns).fill(0);
      if (id !== 3) {
        const scales = await read(columns * 4),
          shifts = await read(columns * 4);
        for (let i = 0; i < columns; i++) {
          scale[i] = scales.readFloatLE(i * 4);
          shift[i] = shifts.readFloatLE(i * 4);
          if (
            !(Number.isNaN(scale[i]) && Number.isNaN(shift[i])) &&
            (!Number.isFinite(scale[i]) || scale[i] === 0 || !Number.isFinite(shift[i]))
          )
            throw Error(t('results.malformed'));
        }
      }
      const descriptionLength = (await read(4)).readInt32LE();
      if (descriptionLength < 0 || descriptionLength > 1_000_000)
        throw Error(t('results.malformed'));
      await read(descriptionLength);
      const names = await read((columns + 1) * nameLength),
        units = await read((columns + 1) * nameLength);
      for (let i = 0; i <= columns; i++) {
        metadata.names.push(
          names
            .toString('latin1', i * nameLength, (i + 1) * nameLength)
            .replace(/\0/g, '')
            .trim(),
        );
        metadata.units.push(
          unit(
            units
              .toString('latin1', i * nameLength, (i + 1) * nameLength)
              .replace(/\0/g, '')
              .trim(),
          ),
        );
      }
      checkNames(metadata.names, metadata.units);
      const timeOffset = position;
      const offset = position + (id === 1 ? rows * 4 : 0);
      const expected = offset + rows * columns * (id === 3 ? 8 : 2);
      if (!Number.isSafeInteger(expected) || expected > stat.size)
        throw Error(t('results.truncated'));
      metadata.binary = { id, rows, columns, offset, timeOffset, timeA, timeB, scale, shift };
      metadata.start =
        id === 1 ? ((await exactRead(handle, 4, timeOffset)).readInt32LE() - timeB) / timeA : timeA;
      metadata.end =
        id === 1
          ? ((await exactRead(handle, 4, timeOffset + (rows - 1) * 4)).readInt32LE() - timeB) /
            timeA
          : timeA + (rows - 1) * timeB;
    } else {
      if (/\.outb$/i.test(filename)) throw Error(t('results.unsupported', id));
      let lineNumber = 0,
        found = false,
        gotUnits = false;
      for await (const { line } of resultLines(filename, 0, signal, 1_000_000, 4_000_000)) {
        lineNumber++;
        const cells = line
          .trim()
          .replace(/^\uFEFF/, '')
          .split(/\s+/);
        if (!found) {
          if (cells[0]?.toLowerCase() === 'time') {
            metadata.names = cells;
            found = true;
          } else if (lineNumber > 100) throw Error(t('results.malformed'));
        } else if (!gotUnits) {
          metadata.units = cells.map(unit);
          checkNames(metadata.names, metadata.units);
          metadata.headerLines = lineNumber;
          gotUnits = true;
        } else if (line.trim()) {
          if (cells.length !== metadata.names.length) throw Error(t('results.malformed'));
          metadata.start = parseNumber(cells[0]);
          break;
        }
      }
      if (!gotUnits) throw Error(t('results.malformed'));
      const tailLength = Math.min(stat.size, 256_000);
      const tail = (await exactRead(handle, tailLength, stat.size - tailLength))
        .toString('utf8')
        .split(/\r\n|\r|\n/);
      let last: number;
      for (let i = tail.length - 1; i >= (stat.size > tailLength ? 1 : 0); i--) {
        const cells = tail[i].trim().split(/\s+/);
        if (cells.length === metadata.names.length && /^[+-]?(?:\d|\.\d)/.test(cells[0])) {
          last = parseNumber(cells[0]);
          break;
        }
      }
      if (last === undefined) throw Error(t('results.malformed'));
      metadata.end = last;
    }
    if (
      !Number.isFinite(metadata.start) ||
      !Number.isFinite(metadata.end) ||
      metadata.start > metadata.end
    )
      throw Error(t('results.malformed'));
    if (signal?.aborted) throw Error(t('results.cancelled'));
    return metadata;
  } finally {
    await handle.close();
  }
}

export async function readResultSeries(
  metadata: ResultMetadata,
  channels: number[],
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<ResultSeries[]> {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    !channels.length ||
    channels.length > 4 ||
    new Set(channels).size !== channels.length ||
    channels.some((i) => !Number.isInteger(i) || i < 1 || i >= metadata.names.length)
  )
    throw Error(t('results.selection'));
  if (signal?.aborted) throw Error(t('results.cancelled'));
  const stat = await fs.stat(metadata.filename);
  if (stat.size !== metadata.size || stat.mtimeMs !== metadata.modified)
    throw Error(t('results.changed'));
  const accumulators = channels.map((channel) => ({
    channel,
    count: 0,
    missing: 0,
    mean: 0,
    m2: 0,
    min: Infinity,
    max: -Infinity,
    buckets: new Map<number, { first: any; last: any; min: any; max: any; missing?: any }>(),
  }));
  const lower = Math.max(start, metadata.start),
    upper = Math.min(end, metadata.end);
  let previous = -Infinity,
    sequence = 0;
  let builtIndex: TextIndex;
  const accept = (time: number, values: number[]) => {
    if (!Number.isFinite(time) || time <= previous) throw Error(t('results.timeOrder'));
    previous = time;
    sequence++;
    if (time < lower || time > upper) return;
    const bucketIndex = Math.min(399, Math.floor(((time - lower) / (upper - lower || 1)) * 400));
    accumulators.forEach((a, i) => {
      const value = values[i];
      const point = { time, value: Number.isFinite(value) ? value : null, sequence };
      let bucket = a.buckets.get(bucketIndex);
      if (!bucket) {
        bucket = { first: point, last: point, min: point, max: point };
        a.buckets.set(bucketIndex, bucket);
      }
      bucket.last = point;
      if (!Number.isFinite(value)) {
        a.missing++;
        bucket.missing ||= point;
        return;
      }
      if (bucket.min.value === null || value < bucket.min.value) bucket.min = point;
      if (bucket.max.value === null || value > bucket.max.value) bucket.max = point;
      a.count++;
      const delta = value - a.mean;
      a.mean += delta / a.count;
      a.m2 += delta * (value - a.mean);
      a.min = Math.min(a.min, value);
      a.max = Math.max(a.max, value);
    });
  };
  if (metadata.binary) {
    const b = metadata.binary;
    const handle = await fs.open(metadata.filename, 'r');
    try {
      const width = b.id === 3 ? 8 : 2,
        rowWidth = b.columns * width;
      const rowsPerChunk = Math.max(1, Math.floor(1_000_000 / rowWidth));
      // Explicit packed times (ID 1) retain the full time-order validation pass.
      // Fixed-step formats can seek directly, including a margin for floating-point boundaries.
      const firstRow =
        b.id === 1
          ? 0
          : lower > upper
            ? b.rows
            : Math.max(0, Math.min(b.rows, Math.floor((lower - b.timeA) / b.timeB) - 1));
      const endRow =
        b.id === 1
          ? b.rows
          : lower > upper
            ? b.rows
            : Math.max(0, Math.min(b.rows, Math.ceil((upper - b.timeA) / b.timeB) + 2));
      if (
        b.id !== 1 &&
        b.timeB <=
          Number.EPSILON * (Math.max(Math.abs(metadata.start), Math.abs(metadata.end)) + b.timeB)
      ) {
        let lastTime = -Infinity;
        for (let row = 0; row < b.rows; row++) {
          const time = b.timeA + row * b.timeB;
          if (!Number.isFinite(time) || time <= lastTime) throw Error(t('results.timeOrder'));
          lastTime = time;
          if (row % 65536 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (signal?.aborted) throw Error(t('results.cancelled'));
          }
        }
      }
      for (let row = firstRow; row < endRow; row += rowsPerChunk) {
        if (signal?.aborted) throw Error(t('results.cancelled'));
        const count = Math.min(rowsPerChunk, endRow - row);
        const data = await exactRead(handle, count * rowWidth, b.offset + row * rowWidth);
        const times =
          b.id === 1 ? await exactRead(handle, count * 4, b.timeOffset + row * 4) : undefined;
        for (let j = 0; j < count; j++) {
          const time =
            b.id === 1
              ? (times.readInt32LE(j * 4) - b.timeB) / b.timeA
              : b.timeA + (row + j) * b.timeB;
          const values = channels.map((channel) => {
            const col = channel - 1,
              at = j * rowWidth + col * width;
            return b.id === 3
              ? data.readDoubleLE(at)
              : Number.isNaN(b.scale[col]) && Number.isNaN(b.shift[col])
                ? 0
                : (data.readInt16LE(at) - b.shift[col]) / b.scale[col];
          });
          accept(time, values);
        }
      }
    } finally {
      await handle.close();
    }
  } else {
    const cached = textIndexes.get(metadata);
    const validated = cached && channels.every((channel) => cached.channels.has(channel));
    const anchors: TextIndex['anchors'] = [];
    let stride = 2048,
      rows = 0;
    let offset = 0;
    if (validated) {
      let low = 0,
        high = cached.anchors.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (cached.anchors[mid].time <= lower) low = mid + 1;
        else high = mid;
      }
      offset = cached.anchors[Math.max(0, low - 1)]?.offset || 0;
    }
    let lineNumber = 0;
    for await (const { line, offset: lineOffset } of resultLines(
      metadata.filename,
      offset,
      signal,
    )) {
      if (signal?.aborted) throw Error(t('results.cancelled'));
      if (
        (++lineNumber <= metadata.headerLines && !offset) ||
        !line.trim() ||
        /^\s*This\b/.test(line)
      )
        continue;
      const cells = line.trim().split(/\s+/);
      if (cells.length !== metadata.names.length) throw Error(t('results.malformed'));
      const time = parseNumber(cells[0]);
      if (!validated && rows++ % stride === 0) {
        anchors.push({ time, offset: lineOffset });
        if (anchors.length >= 65536) {
          for (let i = 0; i < anchors.length / 2; i++) anchors[i] = anchors[i * 2];
          anchors.length /= 2;
          stride *= 2;
        }
      }
      if (validated && time > upper) break;
      accept(
        time,
        channels.map((i) => parseNumber(cells[i])),
      );
    }
    if (!validated)
      builtIndex = { anchors, channels: new Set([...(cached?.channels || []), ...channels]) };
  }
  const after = await fs.stat(metadata.filename);
  if (after.size !== metadata.size || after.mtimeMs !== metadata.modified)
    throw Error(t('results.changed'));
  if (signal?.aborted) throw Error(t('results.cancelled'));
  if (builtIndex) textIndexes.set(metadata, builtIndex);
  return accumulators.map((a) => {
    const points: [number, number | null][] = [];
    for (const bucket of a.buckets.values()) {
      const unique = new Map(
        [bucket.first, bucket.min, bucket.max, bucket.last, bucket.missing]
          .filter(Boolean)
          .map((p) => [p.sequence, p]),
      );
      for (const p of [...unique.values()].sort((a, b) => a.sequence - b.sequence))
        points.push([p.time, p.value]);
    }
    return {
      channel: a.channel,
      name: metadata.names[a.channel],
      unit: metadata.units[a.channel],
      count: a.count,
      missing: a.missing,
      mean: a.count ? a.mean : null,
      std: a.count ? Math.sqrt(Math.max(0, a.m2 / a.count)) : null,
      min: a.count ? a.min : null,
      max: a.count ? a.max : null,
      points,
    };
  });
}
