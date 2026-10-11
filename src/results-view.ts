import * as path from 'node:path';
import { t } from './i18n';
import { errorMessage } from './errors';
import { readResultMetadata, readResultSeries, type ResultSeries } from './results';
import { webviewHtml, escapeHtml } from './webview';

export function statisticsCsv(
  files: { label: string; filename?: string; series: ResultSeries[] }[],
  range?: { start: number; end: number },
): string {
  const quote = (value: unknown) =>
    '"' +
    String(value)
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [
    'File,Channel,Column,Unit,StartTime,EndTime,Count,Missing,Mean,StdPopulation,Min,Max',
  ];
  for (const file of files)
    for (const s of file.series)
      rows.push(
        [
          quote(file.filename || file.label),
          quote(s.name),
          s.channel + 1,
          quote(s.unit),
          range?.start ?? '',
          range?.end ?? '',
          s.count,
          s.missing,
          s.mean ?? '',
          s.std ?? '',
          s.min ?? '',
          s.max ?? '',
        ].join(','),
      );
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

export function registerResults(vscode, context) {
  async function open(resource, selected) {
    const supplied = Array.isArray(selected)
      ? selected
      : Array.isArray(resource)
        ? resource
        : resource?.scheme
          ? [resource]
          : undefined;
    const uris =
      supplied ||
      (await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { OpenFAST: ['out', 'outb'] },
        title: t('results.selectFiles'),
      }));
    if (!uris?.length) return;
    if (uris.length > 4 || uris.some((uri) => uri.scheme !== 'file'))
      throw Error(t('results.fileLimit'));
    const readMetadata = async (_progress?, token?) => {
      const controller = new AbortController();
      const cancelled = token?.onCancellationRequested(() => controller.abort());
      if (token?.isCancellationRequested) controller.abort();
      try {
        return await Promise.all(
          uris.map((uri) => readResultMetadata(uri.fsPath, controller.signal)),
        );
      } finally {
        controller.abort();
        cancelled?.dispose();
      }
    };
    const metadata = vscode.window.withProgress
      ? await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('results.loading'),
            cancellable: true,
          },
          readMetadata,
        )
      : await readMetadata();
    const frequencies = metadata.map((m) => {
      const names = new Map<string, number>(),
        pairs = new Map<string, number>();
      m.names.forEach((name, i) => {
        names.set(name, (names.get(name) || 0) + 1);
        const key = JSON.stringify([name, m.units[i]]);
        pairs.set(key, (pairs.get(key) || 0) + 1);
      });
      return { names, pairs };
    });
    const channels = metadata[0].names
      .slice(1)
      .map((name, i) => ({
        name,
        label: frequencies[0].names.get(name) > 1 ? `${name} [#${i + 2}]` : name,
        unit: metadata[0].units[i + 1],
        index: i + 1,
      }))
      .filter(
        (channel) =>
          metadata.length === 1 ||
          frequencies.every((f) => f.pairs.get(JSON.stringify([channel.name, channel.unit])) === 1),
      );
    if (!channels.length) throw Error(t('results.noCommon'));
    const panel = vscode.window.createWebviewPanel(
      'openfast.results',
      t('results.title'),
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [] },
    );
    let controller: AbortController | undefined;
    let sequence = 0;
    let exporting: object | undefined;
    let disposed = false;
    let latest: { label: string; series: ResultSeries[] }[];
    let latestRange: { start: number; end: number };
    const labels = {
      loading: t('results.loading'),
      empty: t('results.empty'),
      file: t('results.file'),
      count: t('results.count'),
      missing: t('results.missing'),
      mean: t('results.mean'),
      std: t('results.std'),
      min: t('results.min'),
      max: t('results.max'),
      time: t('results.time'),
      chart: t('results.chartHelp'),
    };
    panel.webview.html = webviewHtml(
      t('results.title'),
      `<p class="muted">${escapeHtml(t('results.help'))}</p>
      <ul>${uris.map((uri, i) => `<li>${i + 1} · ${escapeHtml(uri.fsPath)}</li>`).join('')}</ul>
      <label for="search">${escapeHtml(t('results.search'))}</label><input id="search" type="search">
      <fieldset><legend>${escapeHtml(t('results.channels'))}</legend><div class="channels" id="channels"></div></fieldset>
      <div class="controls"><label for="start">${escapeHtml(t('results.start'))}<input id="start" type="number" step="any"></label><label for="end">${escapeHtml(t('results.end'))}<input id="end" type="number" step="any"></label></div>
      <div class="actions"><button id="apply">${escapeHtml(t('results.apply'))}</button><button id="export" disabled>${escapeHtml(t('results.export'))}</button></div>
      <div id="status" role="status" aria-live="polite"></div><div id="plots"></div>`,
      resultsScript,
      {
        channels,
        start: Math.min(...metadata.map((m) => m.start)),
        end: Math.max(...metadata.map((m) => m.end)),
        labels,
      },
    );
    const listener = panel.webview.onDidReceiveMessage(async (message) => {
      if (disposed) return;
      const loading = message?.action === 'load';
      if (!loading && (message?.action !== 'export' || controller || exporting || !latest)) return;
      const exportRequest = loading ? undefined : {};
      if (loading) {
        controller?.abort();
        controller = new AbortController();
        sequence++;
        latest = undefined;
      } else exporting = exportRequest;
      const request = sequence;
      const signal = controller?.signal;
      const current = () => !disposed && request === sequence;
      const release = () => {
        if (loading && current()) controller = undefined;
        if (!loading && exporting === exportRequest) exporting = undefined;
      };
      const post = (data) =>
        current()
          ? panel.webview.postMessage({ ...data, requestId: message.requestId })
          : Promise.resolve();
      try {
        if (message?.action === 'load') {
          const selectedChannels = message.channels;
          if (
            !Array.isArray(selectedChannels) ||
            !selectedChannels.length ||
            selectedChannels.length > 4 ||
            new Set(selectedChannels).size !== selectedChannels.length ||
            selectedChannels.some((i) => !Number.isInteger(i) || i < 0 || i >= channels.length)
          )
            throw Error(t('results.selection'));
          const start = message.start,
            end = message.end;
          if (typeof start !== 'number' || typeof end !== 'number')
            throw Error(t('results.selection'));
          const files = [];
          for (let i = 0; i < metadata.length; i++) {
            const m = metadata[i];
            const indices = selectedChannels.map((index) =>
              metadata.length === 1
                ? channels[index].index
                : m.names.findIndex(
                    (name, j) =>
                      name === channels[index].name && m.units[j] === channels[index].unit,
                  ),
            );
            const series = await readResultSeries(m, indices, start, end, signal);
            if (!current()) return;
            files.push({
              label: `${i + 1} · ${path.basename(m.filename)}`,
              filename: m.filename,
              series: series.map((s, j) => ({
                ...s,
                displayName: channels[selectedChannels[j]].label,
              })),
            });
          }
          latest = files;
          latestRange = { start, end };
          release();
          await post({ type: 'series', files, start, end });
        } else if (message?.action === 'export' && latest) {
          const files = latest;
          const range = latestRange;
          const uri = await vscode.window.showSaveDialog({
            filters: { CSV: ['csv'] },
            defaultUri: vscode.Uri.file(
              path.join(path.dirname(metadata[0].filename), 'openfast-statistics.csv'),
            ),
          });
          if (uri && current())
            await vscode.workspace.fs.writeFile(
              uri,
              Buffer.from(statisticsCsv(files, range), 'utf8'),
            );
          release();
          await post({ type: 'idle' });
        }
      } catch (error) {
        release();
        await post({ type: 'error', message: errorMessage(error) });
      } finally {
        release();
      }
    });
    panel.onDidDispose(() => {
      disposed = true;
      sequence++;
      controller?.abort();
      listener.dispose();
    });
    return panel;
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('openfast.previewResults', async (...args) => {
      try {
        return await open(args[0], args[1]);
      } catch (error) {
        void vscode.window.showErrorMessage(t('common.errorMessage', errorMessage(error)));
      }
    }),
  );
}

const resultsScript = `
const $=id=>document.getElementById(id);let hasResults=false;let dirty=false;let lastData;let requestId=0;let reading=false;let edits=0;let loadedEdits=0;
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function busy(value,exporting=false){$('apply').disabled=exporting;$('export').disabled=value||reading||!hasResults||dirty;for(const input of document.querySelectorAll('input:not(#search)'))input.disabled=exporting;}
const format=value=>value===null?'—':Number(value).toLocaleString(undefined,{maximumSignificantDigits:6});
initial.channels.forEach((c,index)=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.value=index;input.checked=index===0;input.onchange=()=>{edits++;dirty=true;busy(false);};label.append(input,document.createTextNode(' '+(c.label||c.name)+' ('+c.unit+')'));$('channels').append(label);});
$('start').value=initial.start;$('end').value=initial.end;
for(const id of ['start','end']) $(id).addEventListener('input',()=>{edits++;dirty=true;busy(false);});
$('search').oninput=()=>{for(const label of $('channels').children)label.hidden=!label.textContent.toLowerCase().includes($('search').value.toLowerCase());};
function load(){requestId++;loadedEdits=edits;reading=true;dirty=true;busy(true);$('status').className='';$('status').textContent=initial.labels.loading;api.postMessage({action:'load',requestId,channels:[...$('channels').querySelectorAll('input:checked')].map(e=>Number(e.value)),start:$('start').value.trim()===''?null:Number($('start').value),end:$('end').value.trim()===''?null:Number($('end').value)});}
$('apply').onclick=load;$('export').onclick=()=>{busy(true,true);api.postMessage({action:'export',requestId});};
function svg(tag,attrs){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs||{}))e.setAttribute(key,String(value));return e;}
function plot(files,channel,start,end){
 const section=document.createElement('section');const sample=files[0].series[channel];section.append(text('h2',(sample.displayName||sample.name)+' ('+sample.unit+')'));
 const legend=document.createElement('div');legend.className='legend';
 files.forEach((file,index)=>{const item=text('span',file.label);const swatch=svg('svg',{width:32,height:12,'aria-hidden':true,class:'swatch'});swatch.append(svg('path',{d:'M0 6 L32 6',class:'series-'+index,fill:'none','stroke-width':3,'stroke-dasharray':index?index*3+' 3':''}));item.prepend(swatch);legend.append(item);});section.append(legend);
 const width=Math.max(320,$('plots').clientWidth),plotWidth=width-104;
 const chart=svg('svg',{viewBox:'0 0 '+width+' 320',class:'chart',role:'img',tabindex:0,'aria-label':sample.name+' '+initial.labels.chart});
 let min=Infinity,max=-Infinity;for(const file of files){const s=file.series[channel];if(s.count){min=Math.min(min,s.min);max=Math.max(max,s.max);}}
 if(!Number.isFinite(min)){section.append(text('p',initial.labels.empty));chart.setAttribute('display','none');min=0;max=1;}
 const pad=(max-min)*.06||Math.abs(max)*.05||1;min-=pad;max+=pad;const x=t=>80+(end===start?.5:(t-start)/(end-start))*plotWidth,y=v=>265-(v-min)/(max-min)*240;
 const axisFormat=value=>(Math.abs(value)>=100000||(Math.abs(value)>0&&Math.abs(value)<.001))?value.toExponential(2):Number(value.toPrecision(4)).toLocaleString();
 const ticks=width<500?2:4;
 for(let i=0;i<=4;i++){const yy=25+i*60;chart.append(svg('line',{x1:80,x2:width-24,y1:yy,y2:yy,class:'grid'}));const label=svg('text',{x:70,y:yy+4,'text-anchor':'end'});label.textContent=axisFormat(max-i*(max-min)/4);chart.append(label);}
 for(let i=0;i<=ticks;i++){const tick=svg('text',{x:80+i*plotWidth/ticks,y:288,'text-anchor':'middle'});tick.textContent=axisFormat(start+i*(end-start)/ticks);chart.append(tick);}
 const axis=svg('text',{x:80+plotWidth/2,y:312,'text-anchor':'middle'});axis.textContent=initial.labels.time;chart.append(axis);
 files.forEach((file,index)=>{let d='',move=true;const points=file.series[channel].points;for(const [time,value]of points){if(value===null){move=true;continue;}d+=(move?'M':'L')+x(time).toFixed(2)+' '+y(value).toFixed(2)+' ';move=false;}const curve=svg('path',{d,fill:'none',class:'series-'+index,'stroke-width':2,'stroke-dasharray':index?index*3+' 3':''});const title=svg('title');title.textContent=file.label;curve.append(title);chart.append(curve);const finite=points.filter(p=>p[1]!==null);if(finite.length===1)chart.append(svg('circle',{cx:x(finite[0][0]),cy:y(finite[0][1]),r:3,fill:'none',class:'series-'+index,'stroke-width':2}));});
 const detail=text('p',initial.labels.chart);detail.className='muted';detail.setAttribute('aria-live','polite');let position=0;
 function describe(time){const descriptions=files.map(file=>{const points=file.series[channel].points;if(!points.length)return file.label+': —';let low=0,high=points.length-1;while(low<high){const mid=Math.floor((low+high)/2);if(points[mid][0]<time)low=mid+1;else high=mid;}if(low>0&&Math.abs(points[low-1][0]-time)<Math.abs(points[low][0]-time))low--;const p=points[low];return file.label+': '+format(p[0])+' s, '+format(p[1])+' '+sample.unit;});detail.textContent=descriptions.join(' | ');}
 chart.addEventListener('pointermove',event=>{const r=chart.getBoundingClientRect();const ratio=Math.max(0,Math.min(1,((event.clientX-r.left)/r.width*width-80)/plotWidth));describe(start+ratio*(end-start));});
 chart.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const points=files[0].series[channel].points;position=Math.max(0,Math.min(points.length-1,position+(event.key==='ArrowRight'?1:-1)));if(points[position])describe(points[position][0]);}});
 section.append(chart,detail);const table=document.createElement('table'),head=document.createElement('thead'),row=document.createElement('tr');table.className='statistics';
 for(const key of ['file','count','missing','mean','std','min','max'])row.append(text('th',initial.labels[key]));head.append(row);const body=document.createElement('tbody');
 for(const file of files){const s=file.series[channel],tr=document.createElement('tr');tr.append(text('td',file.label),...['count','missing','mean','std','min','max'].map(key=>text('td',format(s[key]))));body.append(tr);}table.append(head,body);const wrap=document.createElement('div');wrap.className='table-wrap';wrap.append(table);section.append(wrap);return section;
}
function draw(m){$('plots').replaceChildren(...m.files[0].series.map((_,i)=>plot(m.files,i,m.start,m.end)));}
window.addEventListener('message',event=>{const m=event.data;if(m.requestId!==undefined&&m.requestId!==requestId)return;if(m.type==='series'){reading=false;lastData=m;hasResults=true;dirty=edits!==loadedEdits;draw(m);$('status').textContent='';busy(false);}else if(m.type==='error'){reading=false;$('status').className='error';$('status').textContent=m.message;busy(false);}else if(m.type==='idle')busy(false);});
let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(lastData)draw(lastData);});});load();
`;
