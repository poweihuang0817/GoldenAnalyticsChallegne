const $ = id => document.getElementById('explore-' + id);
async function precisionEvidence() {
  try {
    const response = await fetch('/p75-evidence.json');
    if (!response.ok) throw new Error('Evidence unavailable');
    const evidence = await response.json();
    text('precision-source', `Recorded BigQuery comparison: ${evidence.capturedAt.slice(0, 10)}. Same population and order values, different computation types.`);
    text('precision-query', evidence.query);
    for (const row of evidence.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.country, row.float_raw, row.decimal_raw, row.float_display, row.decimal_display]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      $('precision-values').append(tr);
    }
  } catch { text('precision-source', 'Recorded evidence could not be loaded.'); }
}
precisionEvidence();
let stage = 'all';
let loaded = false;
document.querySelectorAll('[data-explore-page]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-explore-page]').forEach(b => { const selected = b === button; b.setAttribute('aria-pressed', String(selected)); $(`${b.dataset.explorePage}-page`).hidden = !selected; });
}));
document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => {
  stage = button.dataset.stage;
  document.querySelectorAll('[data-stage]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  if (loaded) run();
}));
$('backend').addEventListener('change', () => { if (loaded) run(); });
$('run').addEventListener('click', run);
function busy(value) { document.querySelectorAll('#explore-run, #explore-reject, #explore-page [data-stage], #explore-backend').forEach(el => el.disabled = value); }
function text(id, value) { $(id).textContent = value ?? ''; }
function clearResults() {
  for (const id of ['summary','accuracy','chart','values','count-sql','count-parameters','sales-sql','sales-parameters','rejection']) $(id).replaceChildren();
}
async function run() {
  busy(true); clearResults(); text('query-selection', 'Compiling the selected filter stage…'); text('status', 'Querying the selected backend…');
  try {
    const response = await fetch('/explore/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, backend: $('backend').value, action: 'run' }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    loaded = true;
    text('query-selection', `${data.stage === 'all' ? 'All customers' : data.stage === 'uk' ? 'Country = UK' : 'Country = UK AND city = London'} · ${data.backend}. These are the compiled SQL and bound values for this selection.`);
    text('status', `Executed ${data.stage} on ${data.backend}. ${data.customers} matching customers; ${data.dailyRows} daily sales rows.`);
    text('summary', data.reason ?? `Training period: ${data.history[0].month} through ${data.history.at(-1).month}. Forecast is relative to this historical snapshot.`);
    text('accuracy', data.backtest ? `Rolling one-month backtest: mean absolute error ${data.backtest.mae} across ${data.backtest.periods} months. Each prediction uses only the preceding three months. This is evaluation of a simple baseline, not an accuracy guarantee.` : 'Not enough history for a rolling backtest.');
    text('code', data.code);
    text('count-sql', data.countSQL); text('count-parameters', JSON.stringify(data.countParameters, null, 2));
    text('sales-sql', data.salesSQL); text('sales-parameters', JSON.stringify(data.salesParameters, null, 2));
    const rows = [...data.history.map(r => ({ ...r, kind: 'History' })), ...data.predictions.map(r => ({ ...r, kind: 'Forecast' }))];
    for (const row of rows) { const tr = document.createElement('tr'); for (const value of [row.month, row.kind, row.sales]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } $('values').append(tr); }
    chart(data.history, data.predictions);
  } catch (error) { text('status', error.message); }
  finally { busy(false); }
}
$('reject').addEventListener('click', async () => {
  busy(true);
  try {
    const response = await fetch('/explore/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, backend: $('backend').value, action: 'compile', sql: 'SELECT 1' }) });
    const data = await response.json(); text('rejection', `HTTP ${response.status}: ${data.error ?? 'Unexpected acceptance'}`);
  } catch (error) { text('rejection', error.message); }
  finally { busy(false); }
});
function chart(history, predictions) {
  if (!history.length) return;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1080 350'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Historical monthly sales and three-month moving-average forecast');
  const add = (tag, attrs, label) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v)); if (label !== undefined) el.textContent = label; svg.append(el); return el; };
  const rows = [...history, ...predictions], numbers = rows.map(r => Number(r.sales));
  const min = Math.min(0, ...numbers), max = Math.max(1, ...numbers), span = max - min;
  const x = i => 90 + i * 940 / Math.max(1, rows.length - 1), y = v => 290 - (v - min) * 250 / span;
  for (let i = 0; i <= 4; i++) { const v = min + span * i / 4; add('line', { x1: 90, y1: y(v), x2: 1030, y2: y(v), stroke: '#dce6e1' }); add('text', { x: 80, y: y(v) + 5, 'text-anchor': 'end', fill: '#526471', 'font-size': 15 }, v.toLocaleString('en-US', { maximumFractionDigits: 0 })); }
  const line = (series, start, color, dashed) => add('polyline', { points: series.map((r, i) => `${x(i + start)},${y(Number(r.sales))}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 3, ...(dashed ? { 'stroke-dasharray': '8 6' } : {}) });
  line(history, 0, '#087f6b', false);
  if (predictions.length) line([history.at(-1), ...predictions], history.length - 1, '#c46b13', true);
  rows.forEach((r, i) => { const dot = add('circle', { cx: x(i), cy: y(Number(r.sales)), r: 4, fill: i < history.length ? '#087f6b' : '#c46b13' }); const title = document.createElementNS(ns, 'title'); title.textContent = `${r.month}: ${r.sales}`; dot.append(title); if (i % Math.max(1, Math.ceil(rows.length / 7)) === 0 || i === rows.length - 1) add('text', { x: x(i), y: 325, 'text-anchor': 'middle', fill: '#526471', 'font-size': 15 }, r.month); });
  $('chart').append(svg);
}
