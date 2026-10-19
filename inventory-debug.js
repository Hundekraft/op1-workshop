// Debug view of what a kennel OP-1 has installed, only with ?push in the URL. Send to OP–1 reads the inventory first
// (op1push.js push() check) and app.js hands it to showInventory; no extra click. Saving the switched-off list opens
// its own session. Not the conflict screen (kennel PLAN phase 7 gets its own design); this only shows the raw data.
import {openWebMidi, session} from './op1push.js?v=3.0-hostile-ui-20261018';

const params = new URLSearchParams(location.search);
export let showInventory = () => {};
if (params.has('push')) {
  const panel = document.querySelector('.build-panel') || document.body;
  const box = document.createElement('details');
  box.id = 'inventory-debug';
  box.innerHTML = `<summary class="panel-label">On the OP–1 (debug)</summary>
<p id="inv-status" role="status" aria-live="polite">Send to OP–1 reads what is on it first; it shows up here.</p>
<div class="inv-scroll"><table id="inv-table" hidden><thead><tr><th>Kind</th><th>Name</th><th>From</th><th>Version</th><th>State</th><th>Claims</th><th>Why</th></tr></thead><tbody></tbody></table></div>
<div id="inv-off" hidden><label>Switch off after the next restart (names, separated by commas)<input name="off" autocomplete="off" spellcheck="false"></label>
<p id="inv-off-boot"></p><button type="button" id="inv-save">Save on OP–1</button></div>`;
  panel.append(box);
  const css = document.createElement('style');
  css.textContent = `#inventory-debug{margin-top:24px;font-size:12px}#inventory-debug p{margin:10px 0}.inv-scroll{overflow-x:auto}
#inv-table{border-collapse:collapse;font:10px/1.4 "SFMono-Regular",Consolas,monospace;white-space:nowrap}#inv-table th,#inv-table td{text-align:left;padding:3px 6px 3px 0;border-bottom:1px solid var(--line)}
#inv-table .lost{color:#9b3026}#inv-table .off,#inv-table .failed,#inv-table .skipped{color:var(--muted)}#inv-off input{display:block;width:100%;margin-top:6px}#inv-status.error{color:#9b3026}`;
  document.head.append(css);
  const $ = sel => box.querySelector(sel);
  const say = (text, error = false) => { $('#inv-status').textContent = text; $('#inv-status').classList.toggle('error', error); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  async function withOp1(work) {                                   // one port per action: the update panel opens its own
    let port;
    box.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      if (!navigator.locks?.request) throw Error('This browser cannot coordinate updater sessions across tabs.');
      await navigator.locks.request('hundekraft-op1-midi', {ifAvailable: true}, async lock => {
        if (!lock) throw Error('The OP–1 updater is already in use. Finish or cancel that operation first.');
        try { port = await openWebMidi(navigator, params.has('debug')); await work(session(port, {log: t => console.log(t)})); }
        finally { port?.close(); port = null; }
      });
    } catch (e) { say(e.message, true); }
    finally { box.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  }
  showInventory = inv => {
    box.open = true;
    if (!inv) { $('#inv-table').hidden = true; $('#inv-off').hidden = true; $('#inv-table tbody').replaceChildren(); say('This OP–1 runs a build without the inventory (only kennel firmware has it).'); return; }
    const recs = inv.records;
    $('#inv-table tbody').innerHTML = recs.map(r => `<tr class="${esc(r.state)}"><td>${esc(r.kind)}</td><td>${esc(r.name || '?')}</td>
<td>${esc(r.source === 'builtin' ? 'built-in' : r.path)}</td><td>${esc(r.version)}</td><td>${esc(r.state)}</td>
<td>${r.claims.map(c => `<span class="${c.state}">${esc(c.name)}${c.state === 'lost' ? ' ✗' : c.state === 'won' ? '' : ' –'}</span>`).join(', ')}</td>
<td>${esc(r.reason)}</td></tr>`).join('');
    $('#inv-table').hidden = false;
    $('#inv-off input[name=off]').value = (inv.off || []).join(',');
    $('#inv-off-boot').textContent = `Off right now: ${inv.offBoot.length ? inv.offBoot.join(', ') : 'nothing'}`;
    $('#inv-off').hidden = false;
    say(`${recs.length} entries, ${recs.filter(r => r.state === 'loaded').length} running.`);
  };
  $('#inv-save').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const names = $('#inv-off input[name=off]').value.split(',').map(n => n.trim()).filter(n => n);
    withOp1(async s => {
      if (!await s.setOff(names)) { say('This OP–1 runs a build without the inventory.'); return; }
      say('Saved. It takes effect when the OP–1 restarts.');
    });
  });
}
