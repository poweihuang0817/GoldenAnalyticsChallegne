const el = id => document.getElementById(id);
let examples = [];
function reset() {
  const item = examples.find(e => e.id === el('example').value);
  if (!item) return;
  el('title').textContent = item.title;
  el('description').textContent = item.description;
  el('code').textContent = item.code;
  el('backend-note').textContent = el('backend').value === 'duckdb'
    ? 'DuckDB extension: a separately seeded local Northwind snapshot. Run npm run seed:duckdb first. This is not federation.'
    : 'PostgreSQL and MySQL execute queries remotely in the supplied database server.';
  el('results').replaceChildren();
  el('status').textContent = 'Ready. Compile to inspect SQL, or run to get live results.';
  el('status').className = '';
  el('sql').textContent = 'Compile or run a query to inspect SQL.';
  el('plan').textContent = 'Compile or run a query to inspect the supported plan.';
  el('parameters').textContent = '';
}
function table(rows) {
  el('results').replaceChildren();
  if (!rows.length) { el('results').textContent = 'No rows.'; return; }
  const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody'), keys = Object.keys(rows[0]);
  const header = document.createElement('tr');
  for (const key of keys) { const cell = document.createElement('th'); cell.textContent = key; cell.scope = 'col'; header.append(cell); }
  head.append(header);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const key of keys) { const td = document.createElement('td'); td.textContent = row[key] === null ? 'NULL' : String(row[key]); tr.append(td); }
    body.append(tr);
  }
  table.append(head, body); el('results').append(table);
}
async function submit(action) {
  for (const id of ['compile','run','example','backend']) el(id).disabled = true;
  el('status').className = '';
  el('status').textContent = action === 'run' ? 'Running on the selected database…' : 'Compiling…';
  el('results').replaceChildren();
  try {
    const response = await fetch('/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: el('example').value, backend: el('backend').value, action }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    el('sql').textContent = result.sql;
    el('plan').textContent = JSON.stringify(result.plan, null, 2);
    el('parameters').textContent = `${result.parameterCount} bound parameters`;
    el('status').textContent = action === 'run'
      ? `${result.rowCount} rows · ${result.elapsedMs} ms · ${el('backend').selectedOptions[0].textContent}${result.rowCount > result.rows.length ? ` · showing first ${result.rows.length}` : ''}`
      : `Compiled in ${result.elapsedMs} ms. No query executed.`;
    if (result.rows) table(result.rows);
  } catch (error) {
    el('status').className = 'error'; el('status').textContent = error.message || 'Unable to reach the local server.';
    el('sql').textContent = 'No SQL preview available for this failed request.';
    el('plan').textContent = 'No plan available for this failed request.'; el('parameters').textContent = '';
  } finally { for (const id of ['compile','run','example','backend']) el(id).disabled = false; }
}
for (const button of document.querySelectorAll('[data-page]')) {
  button.onclick = () => {
    for (const other of document.querySelectorAll('[data-page]')) {
      const active = other === button;
      other.setAttribute('aria-pressed', String(active));
      el(`${other.dataset.page}-page`).hidden = !active;
    }
  };
}
el('compile').onclick = () => submit('compile'); el('run').onclick = () => submit('run');
el('example').onchange = reset; el('backend').onchange = reset;
fetch('/examples').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(items => {
  examples = items;
  for (const item of items) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; el('example').append(option); }
  el('api-code').textContent = items.find(item => item.id === 'city').code;
  el('compile').disabled = false; el('run').disabled = false;
  reset();
}).catch(() => { el('status').textContent = 'Unable to load examples. Restart the local demo server.'; });
