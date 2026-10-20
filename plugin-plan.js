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
  const stateChanged = e => e.was && e.on !== (e.was.state === 'loaded');
  const failed = e => ['failed', 'skipped'].includes(e.was?.state);
  // A plain file update needs no decision: it folds into one "N updated" line. Everything else gets its own row.
  const routine = e => e.action === 'update' && !e.restoration && !e.downgrade && !e.replaces && e.source !== 'own' && !stateChanged(e) && !failed(e) && !involved.has(e.name);
  const key = changes.filter(e => !routine(e)), updated = changes.filter(routine);
  const ver = e => e.was?.version && e.version && e.was.version !== e.version ? `${e.was.version} → ${e.version}` : e.version ? `v${e.version}` : '';
  const sign = e => e.action === 'remove' ? '−' : e.action === 'install' ? '+' : e.downgrade || e.restoration || failed(e) ? '!' : e.action === 'update' ? '↻' : '·';
  const tag = e => e.action === 'remove' ? 'removed' : e.action === 'install' ? 'new' : e.restoration ? 'workshop version' : e.downgrade ? 'older version' : stateChanged(e) ? (e.on ? 'turned on' : 'turned off') : e.action === 'update' ? 'updated' : '';
  const warn = e => e.downgrade || e.restoration || failed(e);
  const toggle = e => ask && e.name && e.action !== 'remove' ? `<button type="button" class="plan-switch" role="switch" aria-checked="${!!e.on}" aria-label="${esc(e.name)}" data-toggle="${esc(e.name)}" data-enable="${!e.on}"><span data-state>${e.on ? 'On' : 'Off'}</span></button>` : e.action === 'remove' ? '' : `<span class="plan-state" data-state>${e.on ? 'On' : 'Off'}</span>`;
  const row = e => `<li class="plan-row${warn(e) ? ' plan-warn' : ''}"${e.action === 'remove' ? '' : ` data-plugin-name="${esc(e.name)}"`}><span class="plan-sign" aria-hidden="true">${sign(e)}</span><span class="plan-name">${esc(e.name || e.path)}${e.source === 'own' ? ' <small>your file</small>' : ''}${e.replaces ? `<small>replaces ${esc(e.replaces)}</small>` : ''}${failed(e) ? `<small>last boot ${esc(e.was.state)}${e.was.reason ? ': ' + esc(e.was.reason) : ''}</small>` : ''}</span><span class="plan-meta">${esc([tag(e), ver(e), kb(e.size)].filter(Boolean).join(' · '))}</span>${toggle(e)}${controls(e)}</li>`;
  const brief = e => `<li data-plugin-name="${esc(e.name)}">${esc(e.name || e.path)}${ver(e) ? ` <span>${esc(ver(e))}</span>` : ''}${e.source === 'own' ? ' <span>your file</span>' : ''}${controls(e)}</li>`;
  const total = list => kb(list.reduce((n, e) => n + (e.size || 0), 0));
  const count = n => `${n} plugin${n === 1 ? '' : 's'}`;
  box.innerHTML = `<h3>${full ? 'Firmware upgrade' : changes.length ? 'Ready to update' : 'Your plugins are up to date'}</h3>
<p class="plan-sub">${full ? `Firmware${changes.length ? ` + ${count(changes.length)}` : ''} · takes a minute or two · no format. Keep the OP–1 on until the tape screen returns.` : changes.length ? 'Only changed plugins are sent.' : 'Nothing to send.'}</p>
${deferredOwn.length ? `<p role="status">Your saved uploads (${deferredOwn.map(esc).join(', ')}) are not included in this first firmware upgrade. Once 3.0 is verified, press Update OP–1 again to review and install them.</p>` : ''}
<ul class="plan-list">${key.map(row).join('')}
${updated.length ? `<li class="plan-group"><details><summary><span class="plan-sign" aria-hidden="true">↻</span><span class="plan-name">${updated.length} updated</span><span class="plan-meta">${total(updated)}</span></summary><ul class="plan-brief">${updated.map(brief).join('')}</ul></details></li>` : ''}
${unchanged.length ? `<li class="plan-group"><details class="unchanged-plugins"><summary><span class="plan-sign" aria-hidden="true">=</span><span class="plan-name">${unchanged.length} unchanged</span></summary><ul class="plan-brief">${unchanged.map(brief).join('')}</ul></details></li>` : ''}
${coreNote && full ? `<li class="plan-row plan-note"><span class="plan-sign" aria-hidden="true">·</span><span class="plan-name">${esc(coreNote)}</span></li>` : ''}</ul>
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
      for (const e of live.entries) for (const row of box.querySelectorAll('.plan-row[data-plugin-name]')) {
        if (row.dataset.pluginName !== e.name) continue;
        const state = row.querySelector('[data-state]'); if (state) state.textContent = e.on ? 'On' : 'Off';
        const toggle = row.querySelector('[data-toggle]');
        if (toggle) { toggle.dataset.enable = String(!e.on); toggle.setAttribute('aria-checked', String(!!e.on)); }
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
