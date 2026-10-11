import { execFile } from 'node:child_process';
import * as path from 'node:path';

export interface DiscoveredProcess {
  pid: number;
  identity: string;
  commandLine: string;
  executable: string;
  startedAt?: number;
  cwd?: string;
  input?: string;
  parameterError?: string;
}

export function normalizeProcesses(rows: any[], configured = ''): DiscoveredProcess[] {
  const expected = configured.trim().replace(/^"|"$/g, '').toLowerCase();
  return rows
    .filter(
      (row) =>
        (/openfast/i.test(row.Name || '') &&
          (!/monitor|probe/i.test(row.Name || '') || /fixture/i.test(row.Name || ''))) ||
        (expected && String(row.ExecutablePath || '').toLowerCase() === expected),
    )
    .filter((row) => Number.isInteger(Number(row.ProcessId)) && Number(row.ProcessId) > 0)
    .map((row) => {
      const startedAt = row.StartedAt > 0 ? Number(row.StartedAt) : Date.parse(row.CreationDate);
      return {
        pid: Number(row.ProcessId),
        identity: `${row.ProcessId}:${row.CreationDate || (Number.isFinite(startedAt) ? startedAt : '')}`,
        commandLine: String(row.CommandLine || ''),
        executable: String(row.ExecutablePath || row.Name || ''),
        startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
        cwd: row.Cwd || undefined,
        input: row.InputPath || undefined,
        parameterError: row.ParameterError || undefined,
      };
    });
}

/** A fixed script, no user input is interpolated into PowerShell source. */
function discoverCim(configured = ''): Promise<DiscoveredProcess[]> {
  if (process.platform !== 'win32') return Promise.reject(Error('Windows process discovery only'));
  const script =
    "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $items=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -like 'openfast*' -or ($env:OPENFAST_MONITOR_EXE -and $_.ExecutablePath -eq $env:OPENFAST_MONITOR_EXE)} | Select-Object ProcessId,Name,ExecutablePath,CommandLine,@{Name='CreationDate';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}}}); ConvertTo-Json -InputObject $items -Compress";
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, OPENFAST_MONITOR_EXE: configured.trim().replace(/^"|"$/g, '') },
      },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const rows = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
          resolve(normalizeProcesses(Array.isArray(rows) ? rows : [rows], configured));
        } catch (failure) {
          reject(failure);
        }
      },
    );
  });
}

/** Bundled read-only PEB reader follows OpenFAST_Monitor; CIM is a degraded fallback. */
export async function discoverProcesses(configured = ''): Promise<DiscoveredProcess[]> {
  if (process.platform !== 'win32') throw Error('Windows process discovery only');
  if (process.arch === 'x64') {
    try {
      const rows = await new Promise<any[]>((resolve, reject) => {
        execFile(
          path.join(__dirname, '..', 'bin', 'openfast-probe.exe'),
          [],
          {
            windowsHide: true,
            timeout: 8000,
            maxBuffer: 8 * 1024 * 1024,
            encoding: 'utf8',
            env: { ...process.env, OPENFAST_MONITOR_EXE: configured.trim().replace(/^"|"$/g, '') },
          },
          (error, stdout) => {
            if (error) return reject(error);
            try {
              const parsed = JSON.parse(stdout);
              if (!Array.isArray(parsed)) throw Error('Invalid probe response');
              resolve(parsed);
            } catch (failure) {
              reject(failure);
            }
          },
        );
      });
      return normalizeProcesses(rows, configured);
    } catch {
      /* CIM retains discovery when the native helper cannot run. */
    }
  }
  return discoverCim(configured);
}

export function inputArgument(commandLine: string): string | undefined {
  const tokens = [...commandLine.matchAll(/"([^"]*)"|([^\s"]+)/g)].map(
    (match) => match[1] ?? match[2],
  );
  return tokens.slice(1).find((token) => /\.(fst|fstf)$/i.test(token));
}

/** Relative arguments resolve only against a unique workspace match, never the extension cwd. */
export function resolveInput(
  argument: string,
  workspaceFiles: string[],
  cwd?: string,
): string | undefined {
  if (!argument) return;
  if (path.win32.isAbsolute(argument) || path.posix.isAbsolute(argument)) return argument;
  if (cwd && path.win32.isAbsolute(cwd)) return path.win32.resolve(cwd, argument);
  if (cwd && path.posix.isAbsolute(cwd)) return path.posix.resolve(cwd, argument);
  const suffix = argument
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .toLowerCase();
  if (suffix.split('/').includes('..')) return;
  const matches = workspaceFiles.filter((file) =>
    file
      .replace(/\\/g, '/')
      .toLowerCase()
      .endsWith('/' + suffix),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
