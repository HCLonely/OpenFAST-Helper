import * as path from 'node:path';
import { t } from './i18n';
import { errorMessage } from './errors';
import { sweepParameters, planSweep, writeSweep, type SweepDimension } from './sweep';
import { webviewHtml, escapeHtml } from './webview';

export function registerSweep(vscode, context, workbench) {
  async function open(resource, requestedDimensions) {
    if (!vscode.workspace.isTrusted) throw Error(t('runner.trustRequired'));
    if (!vscode.workspace.workspaceFolders?.length) throw Error(t('runner.workspaceRequired'));
    let uri = resource?.uri || resource || vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file' || !/\.(fst|fstf)$/i.test(uri.path))
      uri = (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { OpenFAST: ['fst', 'fstf'] },
        })
      )?.[0];
    if (!uri) return;
    if (uri.scheme !== 'file') throw Error(t('runner.savedLocalFstRequired'));
    const graph = await workbench.graphFor(uri, true);
    if (!graph) throw Error(t('runChecks.changed'));
    let dimensions: SweepDimension[] = requestedDimensions;
    if (!dimensions) {
      const parameters = sweepParameters(graph);
      if (!parameters.length) throw Error(t('sweep.invalidPlan'));
      const picked = await vscode.window.showQuickPick(
        parameters.map((parameter) => ({
          label: `${parameter.module} / ${parameter.name}`,
          description: `${path.basename(vscode.Uri.parse(parameter.uri).fsPath)}:${parameter.line + 1} = ${parameter.value}`,
          detail: parameter.description,
          parameter,
        })),
        { canPickMany: true, title: t('sweep.choose') },
      );
      if (!picked?.length) return;
      if (picked.length > 8) throw Error(t('sweep.limit'));
      dimensions = [];
      for (const item of picked) {
        const value = await vscode.window.showInputBox({
          title: t('sweep.values', item.parameter.name),
          prompt: t('sweep.valuesHelp'),
          value: item.parameter.value,
        });
        if (value === undefined) return;
        dimensions.push({ id: item.parameter.id, values: value.trim().split(/[,;\s]+/) });
      }
    }
    let plan = planSweep(graph, dimensions);
    const panel = vscode.window.createWebviewPanel(
      'openfast.sweep',
      t('sweep.title'),
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [] },
    );
    let operation: object | undefined;
    let generated: string[];
    const data = () => ({
      labels: {
        count: t(
          'sweep.summary',
          plan.cases.length,
          plan.cases[0].files.size,
          (
            plan.cases.reduce(
              (total, entry) =>
                total +
                [...entry.files.values()].reduce((n, text) => n + Buffer.byteLength(text), 0),
              0,
            ) / 1048576
          ).toFixed(1),
        ),
        file: t('sweep.case'),
        shared: t('sweep.shared', plan.shared.length),
        generating: t('sweep.generating'),
        done: t('sweep.done'),
      },
      dimensions: plan.dimensions.map((d) => ({
        id: d.parameter.id,
        name: `${d.parameter.module} / ${d.parameter.name}`,
        original: d.parameter.value,
        values: d.values,
      })),
      cases: plan.cases.map((entry) => ({ name: entry.name, values: entry.values })),
      shared: plan.shared,
    });
    panel.webview.html = webviewHtml(
      t('sweep.title'),
      `<p class="muted">${escapeHtml(t('sweep.snapshot'))}</p>
      <div id="dimensions"></div><div class="actions"><button id="preview">${escapeHtml(t('sweep.preview'))}</button><button id="generate">${escapeHtml(t('sweep.generate'))}</button><button id="run" disabled>${escapeHtml(t('sweep.run'))}</button></div>
      <div id="status" role="status" aria-live="polite"></div><p id="summary"></p><div class="table-wrap"><table id="cases"></table></div>
      <h2 id="sharedHeading"></h2><p class="muted">${escapeHtml(t('sweep.sharedHelp'))}</p><div class="table-wrap"><ul id="shared"></ul></div>`,
      sweepScript,
      data(),
    );
    const listener = panel.webview.onDidReceiveMessage(async (message) => {
      if (operation) return;
      const token = {};
      operation = token;
      const release = () => {
        if (operation === token) operation = undefined;
      };
      let replied = false;
      const reply = (response) => {
        // The webview may send its next action before delivery is acknowledged.
        release();
        replied = true;
        return panel.webview.postMessage(response);
      };
      try {
        if (message?.action === 'preview') {
          plan = planSweep(graph, message.dimensions);
          generated = undefined;
          await reply({ type: 'plan', data: data() });
        } else if (message?.action === 'generate') {
          if (!vscode.workspace.isTrusted) throw Error(t('runner.trustRequired'));
          const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: t('sweep.selectDestination'),
          });
          if (!selected?.[0]) {
            await reply({ type: 'idle' });
            return;
          }
          if (selected[0].scheme !== 'file') throw Error(t('sweep.destination'));
          const destination = path.join(
            selected[0].fsPath,
            'openfast-sweep-' + new Date().toISOString().replace(/[:.]/g, '-'),
          );
          generated = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: t('sweep.generating') },
            () => writeSweep(plan, destination),
          );
          await reply({ type: 'generated', destination });
        } else if (message?.action === 'run' && generated) {
          await vscode.commands.executeCommand(
            'openfast.runBatch',
            generated.map((filename) => vscode.Uri.file(filename)),
          );
          await reply({ type: 'idle' });
        }
      } catch (error) {
        if (!replied) await reply({ type: 'error', message: errorMessage(error) });
      } finally {
        release();
      }
    });
    panel.onDidDispose(() => listener.dispose());
    return panel;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('openfast.createSweep', async (resource, dimensions) => {
      try {
        return await open(resource, dimensions);
      } catch (error) {
        void vscode.window.showErrorMessage(t('common.errorMessage', errorMessage(error)));
      }
    }),
  );
}

const sweepScript = `
let state=initial;let generated=false;let dirty=false;
const $=id=>document.getElementById(id);
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function setBusy(value){for(const id of ['preview','generate','run']) $(id).disabled=value||(id==='run'&&(!generated||dirty))||(id==='generate'&&dirty);for(const input of $('dimensions').querySelectorAll('input'))input.disabled=value;}
function render(){
  $('dimensions').replaceChildren();
  state.dimensions.forEach(d=>{const label=text('label',d.name+' = '+d.original);const input=document.createElement('input');input.value=d.values.join(', ');input.dataset.id=d.id;input.setAttribute('aria-label',d.name);input.addEventListener('input',()=>{dirty=true;setBusy(false);});label.append(document.createElement('br'),input);$('dimensions').append(label);});
  $('summary').textContent=state.labels.count;
  const header=document.createElement('tr');header.append(text('th',state.labels.file),...state.dimensions.map(d=>text('th',d.name)));const head=document.createElement('thead');head.append(header);const body=document.createElement('tbody');
  state.cases.forEach(c=>{const row=document.createElement('tr');row.append(text('td',c.name),...c.values.map(v=>text('td',v)));body.append(row);});$('cases').replaceChildren(head,body);
  $('sharedHeading').textContent=state.labels.shared;$('shared').replaceChildren(...state.shared.map(p=>text('li',p)));dirty=false;setBusy(false);
}
$('preview').onclick=()=>{setBusy(true);api.postMessage({action:'preview',dimensions:[...$('dimensions').querySelectorAll('input')].map(e=>({id:e.dataset.id,values:e.value.trim().split(/[,;\\s]+/)}))});};
$('generate').onclick=()=>{setBusy(true);$('status').textContent=state.labels.generating;api.postMessage({action:'generate'});};
$('run').onclick=()=>{setBusy(true);api.postMessage({action:'run'});};
window.addEventListener('message',event=>{const m=event.data;if(m.type==='plan'){generated=false;state=m.data;render();$('status').className='';$('status').textContent='';}else if(m.type==='generated'){generated=true;$('status').className='';$('status').textContent=state.labels.done+'\\n'+m.destination;setBusy(false);}else if(m.type==='error'){$('status').className='error';$('status').textContent=m.message;setBusy(false);}else if(m.type==='idle'){setBusy(false);$('status').textContent='';}});render();
`;
