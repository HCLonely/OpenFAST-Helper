import { randomBytes } from 'node:crypto';
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export function scriptData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
export function webviewHtml(
  title: string,
  body: string,
  script: string,
  data: unknown,
  extraStyle = '',
): string {
  const nonce = randomBytes(24).toString('hex');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
  <title>${escapeHtml(title)}</title><style nonce="${nonce}">
  :root{color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}#dimensions input{width:min(100%,640px)}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,14px);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;margin:auto;max-width:1280px;line-height:1.5}
  h1{font-size:24px;margin:0 0 12px}h2{font-size:18px;margin:24px 0 12px}p,li,.channels label{overflow-wrap:anywhere}.muted{color:var(--vscode-descriptionForeground)}
  button,input,select{font:inherit;min-height:36px;border:1px solid var(--vscode-input-border,var(--vscode-widget-border));border-radius:3px}button{padding:7px 14px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.5;cursor:default}
  input,select{padding:6px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);max-width:100%}input[type=checkbox]{min-height:18px;width:18px;vertical-align:middle}label{display:block;margin:8px 0}.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:end}.controls label{flex:1;min-width:150px}.controls input{width:100%}.actions{display:flex;gap:12px;margin:18px 0;flex-wrap:wrap}.statistics{min-width:680px}
  :focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--vscode-widget-border);overflow-wrap:anywhere}th{font-weight:600}.table-wrap{overflow:auto;max-height:480px}.error{color:var(--vscode-errorForeground)}#status{min-height:24px;white-space:pre-wrap;overflow-wrap:anywhere}
  .channels{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:4px 16px;max-height:240px;overflow:auto;border:1px solid var(--vscode-widget-border);padding:12px}.chart{width:100%;height:auto;display:block;min-height:180px}.chart text{fill:var(--vscode-foreground);font-size:12px}.grid{stroke:var(--vscode-widget-border);stroke-width:1}.series-0{stroke:var(--vscode-charts-blue)}.series-1{stroke:var(--vscode-charts-orange)}.series-2{stroke:var(--vscode-charts-green)}.series-3{stroke:var(--vscode-charts-purple)}.legend{display:flex;gap:16px;flex-wrap:wrap}.swatch{display:inline-block;width:28px;margin-right:6px;vertical-align:middle}
  @media(max-width:600px){body{padding:14px}th,td{padding:6px}.controls label{min-width:120px}h1{font-size:21px}}
  ${extraStyle}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main><script nonce="${nonce}">const initial=${scriptData(data)};const api=acquireVsCodeApi();${script}</script></body></html>`;
}
