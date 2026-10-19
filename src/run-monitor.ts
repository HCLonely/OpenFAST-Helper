import * as path from 'node:path';
import { t } from './i18n';
import { webviewHtml, escapeHtml } from './webview';
import { ProgressStream } from './run-progress';
import { sampleExternal } from './monitor-sampler';
import {
  discoverProcesses,
  inputArgument,
  resolveInput,
  type DiscoveredProcess,
} from './process-discovery';
import type { RunJob } from './run-queue';

interface MonitorEntry {
  id: string;
  input?: string;
  label: string;
  source: 'managed' | 'external';
  state: string;
  pid?: number;
  startedAt?: number;
  endedAt?: number;
  stream: ProgressStream;
  log?: string;
  logError?: string;
  logModified?: number;
  manualLog?: boolean;
  cwd?: string;
  commandLine?: string;
  parameterError?: string;
  dataSource?: string;
  note?: string;
  logText?: string;
}

export class RunMonitor {
  readonly ready: Promise<void>;
  lastRevealError?: string;
  readonly entries = new Map<string, MonitorEntry>();
  private dismissed = new Set<string>();
  private panel;
  private sidebar;
  private status;
  private disposed = false;
  private scanning = false;
  private scanError = '';
  private lastScan?: number;
  private tick?: ReturnType<typeof setInterval>;
  private scanTick?: ReturnType<typeof setInterval>;
  private visibilityGeneration = 0;
  private subscriptions: { dispose(): void }[] = [];
  constructor(
    private vscode,
    private configured: () => string,
    private enumerate: (configured: string) => Promise<DiscoveredProcess[]> = discoverProcesses,
  ) {
    this.subscriptions.push(
      vscode.commands.registerCommand('openfast.showRunMonitor', () => this.revealSidebar()),
      vscode.commands.registerCommand('openfast.showRunMonitorPanel', () => this.show()),
      vscode.commands.registerCommand('openfast.revealRunMonitorIcon', () => this.revealSidebar()),
    );
    if (vscode.window.registerWebviewViewProvider)
      this.subscriptions.push(
        vscode.window.registerWebviewViewProvider('openfast.monitorView', {
          resolveWebviewView: (view) => {
            this.sidebar = view;
            view.webview.options = { enableScripts: true, localResourceRoots: [] };
            this.connectView(view, false);
          },
        }),
      );
    if (vscode.window.createStatusBarItem) {
      this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 29);
      this.status.command = 'openfast.showRunMonitor';
      this.subscriptions.push(this.status);
      this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => this.publish()));
      // Changing a document's language closes and reopens it in VS Code.
      for (const event of ['onDidOpenTextDocument', 'onDidCloseTextDocument']) {
        if (vscode.workspace[event]) {
          this.subscriptions.push(vscode.workspace[event](() => this.publish()));
        }
      }
    }
    this.publish();
    // Contributed containers are visible by default; do not open a page at startup.
    this.ready = Promise.resolve();
  }
  private isVisible() {
    return !this.disposed && (this.panel?.visible === true || this.sidebar?.visible === true);
  }
  private updateVisibility() {
    this.visibilityGeneration++;
    if (!this.isVisible()) {
      clearInterval(this.tick);
      clearInterval(this.scanTick);
      this.tick = this.scanTick = undefined;
      return;
    }
    if (this.scanTick) return;
    this.tick = setInterval(() => this.publish(), 1000);
    this.scanTick = setInterval(() => void this.scan(), 5000);
    this.tick.unref?.();
    this.scanTick.unref?.();
    this.publish();
    void this.scan();
  }
  sync(jobs: Iterable<RunJob>) {
    for (const job of jobs) {
      if (this.dismissed.has(job.key)) {
        if (!['waiting', 'running'].includes(job.state)) continue;
        this.dismissed.delete(job.key);
      }
      let entry = this.entries.get(job.key);
      if (!entry || (job.state === 'waiting' && !['waiting', 'running'].includes(entry.state))) {
        const input = this.vscode.Uri.parse(job.key).fsPath;
        entry = {
          id: job.key,
          input,
          label: path.basename(input),
          source: 'managed',
          state: job.state,
          stream: new ProgressStream(),
          cwd: path.dirname(input),
        };
        this.entries.set(job.key, entry);
      }
      entry.state = job.state;
      if (!['running', 'waiting'].includes(job.state)) entry.endedAt ??= Date.now();
    }
    this.prune();
    this.publish();
  }
  started(key: string, pid: number) {
    const entry = this.entries.get(key);
    if (!entry || this.disposed) return;
    entry.pid = pid;
    entry.startedAt = Date.now();
    for (const [id, other] of this.entries)
      if (other.source === 'external' && other.pid === pid) this.entries.delete(id);
    this.publish();
  }
  output(key: string, value: string) {
    this.entries.get(key)?.stream.feed(value);
  }
  private localTrusted() {
    return (
      this.vscode.workspace.isTrusted &&
      !this.vscode.env?.remoteName &&
      !this.vscode.workspace.workspaceFolders?.some((folder) => folder.uri.scheme !== 'file')
    );
  }
  async scan() {
    if (!this.isVisible() || this.scanning || !this.localTrusted()) return;
    const generation = this.visibilityGeneration;
    const current = () => this.isVisible() && generation === this.visibilityGeneration;
    if (process.platform !== 'win32' && this.enumerate === discoverProcesses) {
      this.scanError = t('monitor.windowsOnly');
      this.publish();
      return;
    }
    this.scanning = true;
    try {
      const processes = await this.enumerate(this.configured() || '');
      if (!current() || !this.localTrusted()) return;
      const relative = processes.some((item) => {
        const arg = inputArgument(item.commandLine);
        return !item.input && !item.cwd && arg && !path.isAbsolute(arg);
      });
      const files = relative
        ? await this.vscode.workspace.findFiles(
            '**/*.{fst,fstf}',
            '**/{node_modules,.git}/**',
            2000,
          )
        : [];
      if (!current()) return;
      const active = new Set<string>();
      const managedPids = new Set(
        [...this.entries.values()]
          .filter((entry) => entry.source === 'managed' && entry.state === 'running')
          .map((entry) => entry.pid),
      );
      const filenames = files.map((file) => file.fsPath);
      for (const item of processes) {
        if (managedPids.has(item.pid)) continue;
        const id = 'pid:' + item.identity;
        active.add(id);
        let entry = this.entries.get(id);
        if (!entry) {
          const argument = inputArgument(item.commandLine);
          const input = item.input || resolveInput(argument, filenames, item.cwd);
          entry = {
            id,
            input,
            label: input ? path.basename(input) : argument || path.basename(item.executable),
            source: 'external',
            state: 'running',
            pid: item.pid,
            startedAt: item.startedAt,
            stream: new ProgressStream(),
            cwd: item.cwd,
            commandLine: item.commandLine,
            parameterError: item.parameterError,
          };
          this.entries.set(id, entry);
        }
        entry.cwd = item.cwd || entry.cwd;
        entry.commandLine = item.commandLine || entry.commandLine;
        entry.parameterError = item.parameterError;
        entry.input =
          item.input ||
          resolveInput(inputArgument(item.commandLine), filenames, item.cwd) ||
          entry.input;
        if (entry.input) entry.label = path.basename(entry.input);
        entry.state = 'running';
        entry.endedAt = undefined;
      }
      for (const entry of this.entries.values()) {
        if (!current()) return;
        if (entry.source === 'external' && entry.state === 'running' && !active.has(entry.id)) {
          if (entry.input) await this.sampleEntry(entry);
          if (!current()) return;
          entry.state =
            entry.note === 'fatal' ? 'failed' : entry.note === 'normal' ? 'success' : 'ended';
          entry.endedAt = Date.now();
        }
      }
      for (const entry of this.entries.values()) {
        if (!current()) return;
        if (entry.source !== 'external' || entry.state !== 'running') continue;
        // A single output root shared by multiple live processes is ambiguous.
        const ambiguous =
          entry.input &&
          [...this.entries.values()].filter(
            (other) => other.state === 'running' && other.input === entry.input,
          ).length > 1;
        if (ambiguous && entry.log && !entry.manualLog) {
          entry.log = undefined;
          entry.logModified = undefined;
          entry.stream = new ProgressStream();
          entry.dataSource = undefined;
        }
        const sharedDirectory =
          entry.input &&
          [...this.entries.values()].filter(
            (other) =>
              other.state === 'running' &&
              other.input &&
              path.dirname(other.input).toLowerCase() === path.dirname(entry.input).toLowerCase(),
          ).length > 1;
        if (sharedDirectory && entry.log && !entry.manualLog) {
          const stem = entry.input.replace(/\.(fst|fstf)$/i, '').toLowerCase();
          if (
            ![stem + '.log', stem + '.stdout.log', stem + '.stdout'].includes(
              entry.log.toLowerCase(),
            )
          ) {
            entry.log = undefined;
            entry.stream = new ProgressStream();
            entry.dataSource = undefined;
          }
        }
        if (entry.input && (!ambiguous || entry.manualLog))
          await this.sampleEntry(entry, !sharedDirectory);
      }
      if (!current()) return;
      this.lastScan = Date.now();
      this.scanError = '';
      this.prune();
    } catch (error) {
      if (!current()) return;
      // A failed query says nothing about whether the previously observed tasks ended.
      this.scanError = t(
        'monitor.scanFailed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.scanning = false;
      this.publish();
      // If a hidden scan was discarded and the page reopened meanwhile, refresh now.
      if (this.isVisible() && generation !== this.visibilityGeneration) void this.scan();
    }
  }
  private async sampleEntry(entry: MonitorEntry, allowDirectoryLogs = false) {
    if (!this.isVisible()) return;
    const generation = this.visibilityGeneration;
    const sample = await sampleExternal({
      input: entry.input,
      pid: entry.pid,
      startedAt: entry.startedAt,
      manualLog: entry.manualLog ? entry.log : undefined,
      linkedLog: entry.manualLog ? undefined : entry.log,
      allowDirectoryLogs,
    });
    if (!this.isVisible() || generation !== this.visibilityGeneration) return;
    const previous = entry.stream.latest;
    if (sample.progress)
      entry.stream.latest = previous?.raw === sample.progress.raw ? previous : sample.progress;
    const estimate = entry.stream.estimate;
    if (sample.estimate)
      entry.stream.estimate = estimate?.raw === sample.estimate.raw ? estimate : sample.estimate;
    entry.logError = entry.manualLog && !sample.log ? t('monitor.logUnavailable') : '';
    if (sample.log) entry.log = sample.log;
    entry.logText = sample.logText;
    entry.dataSource = sample.source;
    entry.note =
      sample.fatal || sample.stateStatus === 'failed'
        ? 'fatal'
        : sample.normal || sample.stateStatus === 'succeeded'
          ? 'normal'
          : undefined;
  }
  private prune() {
    const finished = [...this.entries.values()].filter(
      (entry) => !['running', 'waiting'].includes(entry.state),
    );
    for (const entry of finished.slice(0, Math.max(0, finished.length - 100))) {
      if (entry.source === 'managed') this.dismissed.add(entry.id);
      this.entries.delete(entry.id);
    }
  }
  snapshot() {
    return {
      entries: [...this.entries.values()].map((entry) => ({
        id: entry.id,
        input: entry.input,
        cwd: entry.cwd,
        commandLine: entry.commandLine,
        note:
          entry.parameterError ||
          (entry.note === 'fatal' && entry.state === 'running' ? t('monitor.fatalRunning') : ''),
        dataSource: t(
          entry.source === 'managed' || entry.dataSource === 'log'
            ? 'monitor.logSource'
            : entry.dataSource === 'output'
              ? 'monitor.outputSource'
              : 'monitor.noSource',
        ),
        solverEstimate: entry.state === 'running' ? entry.stream.estimate : undefined,
        monitorEta:
          entry.state === 'running' &&
          entry.startedAt &&
          entry.stream.latest?.current > 0 &&
          entry.stream.latest.current < entry.stream.latest.total
            ? (((Date.now() - entry.startedAt) / 1000) *
                (entry.stream.latest.total - entry.stream.latest.current)) /
              entry.stream.latest.current
            : undefined,
        label: entry.label,
        pid: entry.pid,
        source: t(entry.source === 'managed' ? 'monitor.managed' : 'monitor.external'),
        external: entry.source === 'external',
        running: entry.state === 'running',
        stateCode: entry.state,
        state:
          entry.state === 'ended'
            ? t('monitor.ended')
            : t(`queue.${entry.state}` as Parameters<typeof t>[0]),
        progress: entry.stream.latest,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        log: entry.log,
        logError: entry.logError,
      })),
      error: !this.localTrusted() ? t('monitor.localTrusted') : this.scanError,
      lastScan: this.lastScan,
      labels: {
        empty: t('monitor.empty'),
        progress: t('monitor.progress'),
        remaining: t('monitor.remaining'),
        completion: t('monitor.completion'),
        unknown: t('monitor.unknown'),
        waiting: t('monitor.waitingOutput'),
        noLog: t('monitor.noLog'),
        attach: t('monitor.attach'),
        reported: t('monitor.reported'),
        raw: t('monitor.raw'),
        lastScan: t('monitor.lastScan'),
        log: t('monitor.log'),
        seconds: t('monitor.seconds'),
        elapsed: t('monitor.elapsed'),
        stale: t('monitor.stale'),
        name: t('monitor.name'),
        state: t('monitor.state'),
        source: t('monitor.source'),
        estimated: t('monitor.estimated'),
        search: t('monitor.search'),
        filter: t('monitor.filter'),
        all: t('monitor.all'),
        active: t('monitor.active'),
        finished: t('monitor.finished'),
        failed: t('queue.failed'),
        cwd: t('monitor.cwd'),
        command: t('monitor.command'),
        directory: t('monitor.directory'),
        details: t('monitor.details'),
        expand: t('monitor.expand'),
      },
    };
  }
  private publish() {
    if (this.disposed) return;
    const count = [...this.entries.values()].filter((entry) => entry.state === 'running').length;
    if (this.status) {
      this.status.text = '$(pulse) ' + t('monitor.status', count);
      this.status.tooltip = t('monitor.title');
      const document = this.vscode.window.activeTextEditor?.document;
      if (
        document &&
        (document.languageId === 'openfast' || /\.(fst|fstf)$/i.test(document.uri.path))
      ) {
        this.status.show();
      } else {
        this.status.hide();
      }
    }
    const views = [this.panel, this.sidebar].filter((view) => view?.visible);
    if (views.length) {
      const message = { type: 'snapshot', data: this.snapshot() };
      for (const view of views) void view.webview.postMessage(message);
    }
  }
  show() {
    if (this.disposed) return;
    if (this.panel) {
      this.panel.reveal();
      void this.scan();
      return;
    }
    const panel = this.vscode.window.createWebviewPanel(
      'openfast.runMonitor',
      t('monitor.title'),
      this.vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
    );
    this.panel = panel;
    this.connectView(panel, true);
  }
  async revealSidebar(reportMissing = true): Promise<boolean> {
    if (this.disposed) return false;
    // Opening the contributed container also exposes an unpinned activity-bar entry.
    if (!this.vscode.window.registerWebviewViewProvider) {
      this.show();
      return true;
    }
    try {
      await this.vscode.commands.executeCommand('workbench.view.extension.openfast-monitor');
      await this.vscode.commands.executeCommand('openfast.monitorView.focus');
      return true;
    } catch (error) {
      this.lastRevealError = String(error);
      if (reportMissing) void this.vscode.window.showWarningMessage(t('monitor.reloadRequired'));
      return false;
    }
  }
  private connectView(panel, editor: boolean) {
    panel.webview.html = webviewHtml(
      t('monitor.title'),
      `<p class="muted intro">${escapeHtml(t('monitor.help'))}</p>
      <div class="actions"><button id="refresh">${escapeHtml(t('monitor.refresh'))}</button><button id="clear">${escapeHtml(t('monitor.clear'))}</button><button id="expand">${escapeHtml(t('monitor.expand'))}</button></div>
      <div class="controls"><label>${escapeHtml(t('monitor.search'))}<input id="search" type="search"></label><label>${escapeHtml(t('monitor.filter'))}<select id="filter"><option value="all">${escapeHtml(t('monitor.all'))}</option><option value="running">${escapeHtml(t('monitor.active'))}</option><option value="finished">${escapeHtml(t('monitor.finished'))}</option><option value="failed">${escapeHtml(t('queue.failed'))}</option></select></label></div>
      <p id="status" role="status" aria-live="polite"></p><p id="scan" class="muted"></p><div id="tasks" class="table-wrap"></div><div id="detail"></div>`,
      monitorScript,
      { ...this.snapshot(), compact: !editor },
      monitorStyles +
        (editor
          ? ''
          : 'body{padding:10px}.intro{display:none}.actions{gap:6px}.actions button{font-size:12px;padding:4px 8px}.controls{gap:8px}.controls label{min-width:90px}'),
    );
    const listener = panel.webview.onDidReceiveMessage(async (message) => {
      if (!panel.visible) return;
      try {
        if (message?.action === 'refresh') await this.scan();
        else if (message?.action === 'expand') this.show();
        else if (message?.action === 'directory' && this.localTrusted()) {
          const entry = this.entries.get(message.id);
          if (entry?.input)
            await this.vscode.commands.executeCommand(
              'revealFileInOS',
              this.vscode.Uri.file(entry.input),
            );
        } else if (message?.action === 'clear') {
          for (const [id, entry] of this.entries)
            if (!['running', 'waiting'].includes(entry.state)) {
              if (entry.source === 'managed') this.dismissed.add(id);
              this.entries.delete(id);
            }
          this.publish();
        } else if (message?.action === 'attach' && this.localTrusted()) {
          const entry = this.entries.get(message.id);
          if (!entry || entry.source !== 'external' || entry.state !== 'running') return;
          const selected = await this.vscode.window.showOpenDialog({
            canSelectMany: false,
            title: t('monitor.selectLog'),
            filters: { Logs: ['log', 'txt', 'stdout', 'out'], All: ['*'] },
          });
          if (!selected?.[0] || selected[0].scheme !== 'file' || this.disposed) return;
          entry.log = selected[0].fsPath;
          entry.manualLog = true;
          entry.logModified = undefined;
          await this.sampleEntry(entry);
          this.publish();
        }
      } catch (error) {
        this.scanError = t('monitor.scanFailed', String(error));
        this.publish();
      }
    });
    const visibility = editor
      ? panel.onDidChangeViewState(() => this.updateVisibility())
      : panel.onDidChangeVisibility(() => this.updateVisibility());
    const closed = panel.onDidDispose(() => {
      listener.dispose();
      visibility.dispose();
      closed.dispose();
      if (this.panel === panel) this.panel = undefined;
      if (this.sidebar === panel) this.sidebar = undefined;
      this.updateVisibility();
    });
    this.updateVisibility();
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.tick);
    clearInterval(this.scanTick);
    this.panel?.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

const monitorStyles = `#tasks{max-height:65vh}#tasks table{min-width:1080px}#tasks th{position:sticky;top:0;background:var(--vscode-editor-background);white-space:nowrap}#tasks td{vertical-align:middle}#tasks .name{min-width:180px}#tasks .name button{background:transparent;color:var(--vscode-textLink-foreground);border:0;padding:0;min-height:24px;text-align:left}#tasks progress{width:90px;accent-color:var(--vscode-progressBar-background)}#tasks .selected{background:var(--vscode-list-inactiveSelectionBackground)}#tasks .sub{display:block;font-size:12px;color:var(--vscode-descriptionForeground)}#tasks.compact table{min-width:340px}#tasks.compact .wide{display:none}#tasks.compact td,#tasks.compact th{padding:6px}#detail{margin-top:18px;border-top:1px solid var(--vscode-panel-border)}#detail pre{white-space:pre-wrap;overflow-wrap:anywhere}#detail th{width:30%}#detail h2{overflow-wrap:anywhere}`;

export const monitorScript = `
let latest=initial,selected;const compact=initial.compact;
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el}
function clock(value){return value?new Date(value).toLocaleString():'—'}
function duration(seconds){if(seconds===undefined||seconds===null)return '—';seconds=Math.max(0,Math.round(seconds));const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
function render(data){latest=data;const focusId=document.activeElement?.id,l=data.labels,root=document.getElementById('tasks');root.replaceChildren();root.className=compact?'table-wrap compact':'table-wrap';
 document.getElementById('status').textContent=data.error||'';document.getElementById('scan').textContent=data.lastScan?l.lastScan+' · '+clock(data.lastScan):'';
 const query=(document.getElementById('search').value||'').toLowerCase(),filter=document.getElementById('filter').value||'all';
 const entries=data.entries.filter(e=>(e.label+' '+(e.input||'')+' '+(e.pid||'')).toLowerCase().includes(query)&&(filter==='all'||filter==='running'&&['running','waiting'].includes(e.stateCode)||filter==='finished'&&!['running','waiting'].includes(e.stateCode)||filter==='failed'&&e.stateCode==='failed'));
 const table=node('table'),head=node('thead'),heading=node('tr');for(const [text,cls] of [[l.name,'name'],[l.state,'wide'],['PID','wide'],[l.progress,''],[l.elapsed,'wide'],[l.estimated,'wide'],[l.remaining,''],[l.source,'wide']])heading.append(node('th',text,cls));head.append(heading);table.append(head);const body=node('tbody');
 for(const e of entries){const row=node('tr',undefined,e.id===selected?'selected':''),name=node('td',undefined,'name'),button=node('button',e.label);button.id='task-'+e.id;button.onclick=()=>{selected=e.id;render(latest)};name.append(button,node('span',compact?e.state:e.input||e.source,'sub'));row.append(name,node('td',e.state,'wide'),node('td',e.pid||'—','wide'));
 const p=e.progress,cell=node('td');if(p){const bar=node('progress');bar.max=100;bar.value=p.percent;bar.setAttribute('aria-label',l.progress);bar.setAttribute('aria-valuetext',p.percent.toFixed(1)+'%');cell.append(bar,node('span',' '+p.percent.toFixed(1)+'%'),node('span',p.current+' / '+p.total+' '+l.seconds,'sub'))}else cell.textContent=l.unknown;row.append(cell);
 row.append(node('td',e.startedAt?duration(((e.endedAt||Date.now())-e.startedAt)/1000):'—','wide'),node('td',duration(e.monitorEta),'wide'),node('td',duration(e.solverEstimate?.remainingSeconds)),node('td',e.dataSource,'wide'));body.append(row)}table.append(body);root.append(table);if(!entries.length)root.append(node('p',l.empty,'muted'));
 const detail=document.getElementById('detail');detail.replaceChildren();const e=data.entries.find(e=>e.id===selected);if(e){detail.append(node('h2',e.label));const properties=node('table');for(const [key,value] of [[l.state,e.state],[l.source,e.dataSource],[l.cwd,e.cwd],[l.command,e.commandLine],[l.completion,e.solverEstimate?.completionClock],[l.reported,clock(e.progress?.reportedAt)],[l.log,e.log]]){const tr=node('tr');tr.append(node('th',key),node('td',value||'—'));properties.append(tr)}detail.append(properties);if(e.note)detail.append(node('p',e.note,'error'));if(e.logError)detail.append(node('p',e.logError,'error'));if(e.running&&e.progress&&Date.now()-e.progress.reportedAt>30000)detail.append(node('p',l.stale,'muted'));
 if(!e.progress)detail.append(node('p',e.external?l.noLog:l.waiting,'muted'));if(e.input){const open=node('button',l.directory);open.id='directory-'+e.id;open.onclick=()=>api.postMessage({action:'directory',id:e.id});detail.append(open)}if(e.external&&e.running){const attach=node('button',l.attach);attach.id='attach-'+e.id;attach.onclick=()=>api.postMessage({action:'attach',id:e.id});detail.append(attach)}const raw=e.solverEstimate?.raw||e.progress?.raw;if(raw)detail.append(node('h2',l.raw),node('pre',raw));}
 if(focusId)document.getElementById(focusId)?.focus(); }
for(const action of ['refresh','clear','expand'])document.getElementById(action).onclick=()=>api.postMessage({action});
document.getElementById('search').oninput=()=>render(latest);document.getElementById('filter').onchange=()=>render(latest);
window.addEventListener('message',event=>{if(event.data.type==='snapshot')render(event.data.data)});render(initial);
`;
