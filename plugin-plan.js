import {resolveConflicts} from './conflicts.js';
// Review plugin changes before any Send to OP–1: the plugin list before sending (what stays, what is
// new, updated, removed or switched off) and, when two plugins want the same page, view or key combo, a choice of who
// gets it. op1push.js planPlugins does the work; this only draws it and waits for the choice.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const kb = n => n ? `${Math.max(1, Math.round(n / 1024))} KB` : '';
// "page:t4" -> words for people
export function claimText(c) {
  const [kind, a, b] = c.split(':');
  if (kind === 'page') return `clock page ${a.toUpperCase()}`;
  if (c === 'view') return 'the clock view (Shift + Help)';
  if (kind === 'key') return `${(b || a || '').replace(/shift\+/i, 'Shift + ').toUpperCase().replace('SHIFT', 'Shift')} in ${a} mode`;
  if (kind === 'lfo') return `the LFO slot “${a}”`;
  if (kind === 'seq') return `the sequencer slot “${a}”`;
  if (kind === 'drum') return `the drum slot “${a}”`;
  if (c.startsWith('tape.')) return `the tape ${c.slice(5)} hook`;
  return c;
}
const CHANGE = {install: 'Install', update: 'Update', keep: 'Already installed', 'built-in': 'Built in'};
export const needsChoice = plan => plan.changed || plan.conflicts.length > 0 || !!plan.unknown?.length || plan.entries.some(e => e.path?.startsWith('plugins/'));
export const cancelledPlan = () => new Error('Cancelled before transfer. No device changes were sent; pending selections are saved.');
export function showPlan(box, plan, {ask = needsChoice(plan), pending = [], saved = {}, full = false, coreNote = '', deferredOwn = []} = {}) {
  box.onchange = null;
  const rows = [...plan.entries, ...plan.removed.map(r => ({...r, action: 'remove', on: false}))];
  const unknown = !!plan.unknown?.length, downgrade = rows.some(e => e.downgrade);
  const involved = new Set(plan.conflicts.flatMap(c => c.names));
  const changed = e => !['keep', 'built-in'].includes(e.action) || e.was && (e.on !== (e.was.state === 'loaded') || ['failed', 'skipped'].includes(e.was.state)) || involved.has(e.name);
  const changes = rows.filter(changed), unchanged = rows.filter(e => !changed(e));
  const controls = e => !ask ? '' : e.action !== 'remove' && e.path?.startsWith('plugins/')
    ? `<button type="button" data-remove="${esc(e.path)}">Remove plugin</button>` : '';
  const label = e => e.action === 'remove' ? 'Removal pending' : e.restoration ? 'Restore workshop version' : e.downgrade ? 'Downgrade' : e.action === 'update' && (e.versionOrder === null || e.versionOrder === 0) ? 'Changed file' : CHANGE[e.action];
  const table = list => `<table><thead><tr><th>Plugin</th><th>Version</th><th>Change</th><th>State</th><th></th></tr></thead><tbody>${list.map(e => `<tr${e.action === 'remove' ? '' : ` data-plugin-name="${esc(e.name)}"`}><td>${esc(e.name || e.path)}${e.source === 'own' ? ' (your file)' : ''}${e.replaces ? `<br>Replaces ${esc(e.replaces)}` : ''}</td><td>${esc(e.was?.version && e.was.version !== e.version ? e.was.version + ' → ' : '')}${esc(e.version || 'unknown')}</td><td>${esc(label(e))}${e.size ? ` · ${kb(e.size)}` : ''}</td><td><span data-state>${e.action === 'remove' ? '' : e.on ? 'On' : 'Off'}</span>${['failed', 'skipped'].includes(e.was?.state) ? `<br>Last boot: ${esc(e.was.state)}${e.was.reason ? ' — ' + esc(e.was.reason) : ''}` : ''}${ask && e.name && e.action !== 'remove' ? ` <button type="button" data-toggle="${esc(e.name)}" data-enable="${!e.on}">${e.on ? 'Disable' : 'Enable'} plugin</button>` : ''}</td><td>${controls(e)}</td></tr>`).join('')}</tbody></table>`;
  box.innerHTML = `<h3>${full ? 'Firmware upgrade + plugin changes' : changes.length ? 'Ready to update' : 'Your plugins are up to date'}</h3>
<p>${full ? 'This update also upgrades the firmware. Keep the OP–1 powered on until the tape screen returns. Installation can take a minute or two. No format is needed.' : 'Only changed plugin files and settings will be sent.'}</p>
${deferredOwn.length ? `<p role="status">Your saved uploads (${deferredOwn.map(esc).join(', ')}) are not included in this first firmware upgrade. Once 3.0 is verified, press Update OP–1 again to review and install them.</p>` : ''}
${coreNote && full ? `<p>${esc(coreNote)}</p>` : ''}
${changes.length ? table(changes) : '<p>No plugin file changes.</p>'}
${unchanged.length ? `<details class="unchanged-plugins"><summary>${unchanged.length} plugins unchanged</summary>${table(unchanged)}</details>` : ''}
${plan.restartNeeded ? '<p>The update will restart the OP–1 to apply plugin settings.</p>' : ''}
${ask ? pending.map(r => `<p>Removal pending: ${esc(r.name || r.path)} <button type="button" data-undo="${esc(r.name || r.path)}">Undo</button></p>`).join('') : ''}
${plan.conflicts.map((c, i) => `<fieldset${ask ? '' : ' disabled'}><legend>${esc(c.names.join(' and '))} both want ${esc(claimText(c.claim))}. Choose which whole plugin stays on.</legend>
${c.names.map(n => `<label><input type="radio" name="claim${i}" value="${esc(n)}"${n === c.choice ? ' checked' : ''}> ${esc(n)}</label>`).join('')}<p data-implied="${i}" hidden>Resolved by the plugins switched off above.</p></fieldset>`).join('')}
${unknown ? `<p role="alert">Compatibility is unknown for ${esc(plan.unknown.join(', '))}. Undeclared conflicts cannot be checked.</p>` : ''}
${ask && unknown ? `<label><input type="checkbox" data-unknown${saved.unknownAccepted ? ' checked' : ''}> I understand these plugins may conflict.</label>` : ''}
${ask && downgrade ? '<label><input type="checkbox" data-downgrade> I want to install the older version shown above.</label>' : ''}
${plan.errors?.length ? `<p role="alert">${plan.errors.map(esc).join('<br>')}</p>` : ''}
${ask ? `<p data-consequence role="status"></p>${plan.offChanged ? '<p>Plugin on/off choices are saved before T1. T2 cancels file installation but keeps those choices.</p>' : ''}<button type="button" class="download" data-send disabled>${full ? 'Send firmware + plugins →' : 'Send update →'}</button> <button type="button" data-cancel>Cancel</button>` : ''}`;
  box.hidden = false;
  if (!ask) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const send = box.querySelector('[data-send]');
    const chosen = () => Object.fromEntries(plan.conflicts.flatMap((c, i) => {
      const input = box.querySelector(`input[name=claim${i}]:checked`); return input ? [[c.claim, input.value]] : [];
    }));
    const refresh = () => {
      const live = resolveConflicts(plan.entries, {winners: chosen(), off: plan.initialOff || []});
      send.disabled = !live.resolved || (unknown && !box.querySelector('[data-unknown]').checked) || (downgrade && !box.querySelector('[data-downgrade]').checked);
      for (const e of live.entries) for (const row of box.querySelectorAll('tr[data-plugin-name]')) {
        if (row.dataset.pluginName !== e.name) continue;
        const state = row.querySelector('[data-state]'); if (state) state.textContent = e.on ? 'On' : 'Off';
        const toggle = row.querySelector('[data-toggle]');
        if (toggle) { toggle.dataset.enable = String(!e.on); toggle.textContent = e.on ? 'Disable plugin' : 'Enable plugin'; }
      }
      plan.conflicts.forEach((c, i) => { box.querySelector(`[data-implied="${i}"]`).hidden = !live.conflicts.find(x => x.claim === c.claim)?.implied; });
      box.querySelector('[data-consequence]').textContent = live.errors.length ? live.errors.join('. ') : live.off.length ? `Whole plugins planned off: ${live.off.join(', ')}.` : '';
    };
    box.onchange = refresh; refresh();
    let settled = false;
    const finish = value => { if (settled) return; settled = true; box.onchange = null; box.querySelectorAll('button, input').forEach(e => e.disabled = true); resolve(value); };
    box.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => finish({remove: b.dataset.remove}));
    box.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => finish({undo: b.dataset.undo}));
    box.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => finish({toggle: b.dataset.toggle, on: b.dataset.enable === 'true'}));
    box.querySelector('[data-cancel]').onclick = () => { box.onchange = null; box.hidden = true; reject(cancelledPlan()); };
    send.onclick = () => { if (!send.disabled) finish({winners: chosen(), unknownAccepted: !!box.querySelector('[data-unknown]')?.checked}); };
  });
}
