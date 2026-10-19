import {sameCore, matchesUpdate, updateDifferences} from './update-state.js?v=3.0-update-review-20261019';
import {saveSelection, loadSelection, loadPlugins, savePlugins, providerSignature, reviewSignature, newPluginState} from './plugin-state.js?v=3.0-hostile-ui-20261018';
import {push, openWebMidi, readInventory, planPlugins, planFullUpdate, assertResolvedPlan, pluginInfo, pluginPath, ldrRangeCrc, checkPlugin, session, ABORT, OK} from './op1push.js?v=3.0-update-review-20261019';
import {showPlan, claimText} from './plugin-plan.js?v=3.0-update-review-20261019';                       // kennel OP-1, same core: single plugin files
import {resolveConflicts} from './conflicts.js';
import {showInventory} from './inventory-debug.js?v=3.0-hostile-ui-20261018';           // ?push only: what a kennel OP-1 has installed
import {CATEGORIES} from './categories.js?v=3.0.1-release-20261019';                  // the front page: what's in a build, by category
const $ = id => document.getElementById(id);
let release, file, worker, busy = false, urls = [], fileCheck = 0, pushFiles = [], pushBuild = '', pushResume = {}, installingUntil = 0, pushCap = 300;
let ownState = newPluginState(), selectionsReady = false, pluginStorageReady = false, selectionStorageReady = false, storageBlocked = false, storageError = '';
let ownFiles = [];                                              // your own plugin files: [[plugins/ path, bytes, file name]]
let stopConnectionWatch = null, deviceInventory = null, firmwareWait = null, stopVerification = false, verificationController = null, retryAction = 'connect';
let devicePending = false;                                    // includes the asynchronous Web Lock acquisition
const pendingUpdate = () => !!ownState.verification;
const editingLocked = () => busy || devicePending || storageBlocked || pendingUpdate();
const inputKey = i => i.dataset.core ? 'core:' + i.dataset.core : i.dataset.plugin ? 'plugin:' + i.dataset.plugin : i.dataset.group + ':' + i.value;
function rememberSelection() {
  if (!selectionsReady || !selectionStorageReady || storageBlocked || !release) return;
  try {
    saveSelection(release.catalog.base, Object.fromEntries([...document.querySelectorAll('#catalog input[type=checkbox]')].map(i => [inputKey(i), i.checked])), choices().preset_cap);
  } catch (e) { if (e.name === 'StateConflictError') storageBlocked = true; storageError = 'Could not save selections: ' + e.message; ownStatus(storageError, true); }
}
async function rememberOwn(required = false) {
  rememberSelection();
  if (storageBlocked) throw Error('Saved selections changed in another tab. Reload this tab before continuing.');
  ownState.files = ownFiles;
  if (!pluginStorageReady) { ownStatus(storageError || 'Plugin storage is unavailable; changes are only held in this tab.', true); if (required) throw Error('Cannot save the pending update. Nothing has been sent. Restore browser storage or download firmware instead.'); return; }
  try { await savePlugins(release.catalog.base, ownState); }
  catch (e) {
    storageError = e.name === 'StateConflictError' ? e.message : 'Could not save your plugins. Keep this tab open; these changes may be lost: ' + e.message;
    ownStatus(storageError, true);
    if (e.name === 'StateConflictError') storageBlocked = true;
    if (required || e.name === 'StateConflictError') throw e;
  }
}
const removalMatches = (r, e) => r.path === e.path || !!e.name && r.name === e.name;
const removalId = r => r.name || r.path;
async function removeOwn(name, path) {
  if (pendingUpdate()) throw Error('Verify the previous update or cancel its pending files before changing plugins.');
  name = name || '';
  if (!name && !path?.startsWith('plugins/')) throw Error('This plugin has no removable identity');
  const file = ownFiles.find(([p, d]) => pluginInfo(p, d).name === name);
  const unsent = file && deviceInventory && !deviceInventory.records.some(r => r.path?.startsWith('plugins/') && removalMatches({name, path: path || file[0]}, r));
  if (!unsent && !ownState.removals.some(r => removalId(r) === (name || path))) ownState.removals.push({name, path: path || file?.[0] || null, file: file || null});
  ownFiles = ownFiles.filter(([p, d]) => pluginInfo(p, d).name !== name);
  delete ownState.toggles[name];
  ownState.reviews = {}; ownState.verification = null;
  await rememberOwn(); showOwn();
  ownStatus(storageError || (unsent ? 'Unsent plugin removed from your selection.' : 'Removal saved. Press Update OP–1 to review it; Undo cancels.'), !!storageError);
}
async function undoRemoval(name) {
  if (pendingUpdate()) throw Error('Verify the previous update or cancel its pending files before Undo.');
  const removal = ownState.removals.find(r => removalId(r) === name);
  if (removal?.file && !ownFiles.some(([p, d]) => pluginInfo(p, d).name === removal.name)) ownFiles.push(removal.file);
  ownState.removals = ownState.removals.filter(r => removalId(r) !== name);
  ownState.reviews = {}; ownState.verification = null;
  await rememberOwn(); showOwn();
  ownStatus(storageError || 'Removal undone. Your plugin selection is saved.', !!storageError);
}
// Selected workshop files come from the same hash-checked variant used by the firmware builder.
let workshopManifest;
const digestBytes = async b => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('');
async function checkedAsset(path, expected) {
  if (!expected) throw Error('Missing release checksum. Reload the workshop.');
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) throw Error('Could not load update files. Check your connection and retry.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await digestBytes(bytes) !== expected) throw Error('The update release changed. Reload the workshop.');
  return bytes;
}
async function workshopFiles() {
  const c = validateChoices(choices()), id = configId(variantChoices(c), false);
  const variant = release.variants[id];
  if (!variant) throw Error('This selection is unavailable. Reload the workshop.');
  if (workshopManifest?.id !== id) {
    const data = JSON.parse(new TextDecoder().decode(await checkedAsset(`variants/${id}/manifest.json`, variant.sha256)));
    if (data.release?.id !== release.release.id) throw Error('Mixed update release. Reload the workshop.');
    workshopManifest = {id, data};
  }
  const paths = new Set();
  for (const group of ['synths', 'effects', 'utilities', 'op1r_plugins']) for (const f of release.catalog[group] || []) {
    if (f.reserved || !(f.always || (group === 'op1r_plugins' ? !c.hidden?.includes(f.id) : c[group].includes(f.id)))) continue;
    for (const name of [f.file, ...(f.files || [])].filter(Boolean)) paths.add('content/' + name);
  }
  const result = [];
  for (const path of paths) {
    const entry = workshopManifest.data.added_files.find(e => e.path === path);
    if (!entry || !pluginPath(path) || !/^[a-zA-Z0-9_.-]+$/.test(entry.blob)) throw Error('Invalid or missing plugin asset: ' + path);
    result.push([path, await checkedAsset(`variants/${id}/${entry.blob}`, entry.sha256)]);
  }
  return result;
}
function confirmInventory(inv) {
  const v = ownState.verification;
  if (!v) return false;
  if (!matchesUpdate(inv, v)) return false;
  installingUntil = 0;
  ownState.removals = ownState.removals.filter(r => !v.removals.includes(removalId(r)));
  ownState.verification = null; ownState.toggles = {}; ownStatus('');
  observedOwn = (inv.records || []).filter(r => r.path?.startsWith('plugins/'));
  return true;
}
// Send to OP-1 (SysEx update, docs/sysex-update.md): only for releases whose builds have it, or ?push for testing.
const pushEnabled = () => !!release?.devupd || new URLSearchParams(location.search).has('push');
// Exact original R246 bytes; the worker and Python runtime independently check again.
const ORIGINAL_R246_SHA256 = 'c5315218f825f143b415ca554516541898abee843d3a236df0b54c04e1fb13a9';
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const hiddenPlugins = () => (release.catalog.op1r_plugins || []).map(f => f.id).filter(id => document.querySelector(`input[data-plugin="${id}"]`)?.checked === false);
const targetMetadata = () => Object.fromEntries((release?.plugin_metadata?.plugins || []).map(p => [p.name, p]));
const targetBuiltins = () => release?.plugin_metadata?.builtins || [];
const targetCore = () => {
  const core = release?.variants[configId(variantChoices(choices()), false)]?.core;
  if (release?.catalog.core_options?.length && !core) throw Error('Core option information is missing. Reload the workshop before sending.');
  return core || release?.core;
};
const kennel = () => release.catalog.base.startsWith('kennel');
// Maiko's tools: single plugin files on kennel bases; on 2.x bases one #249 image, so all or none
const utilities = () => kennel() ? selected('utilities') : selected('utilities').length ? release.catalog.utilities.map(f => f.id) : [];
const choices = () => ({ schema: 1, base: release.catalog.base, synths: selected('synths'), effects: selected('effects'), utilities: utilities(), preset_cap: $('expanded').checked ? 300 : 100, ...(hiddenPlugins().length ? {hidden: hiddenPlugins()} : {}), ...(document.querySelector('input[data-core=lander]')?.checked ? {lander: true} : {}) });
const selected = group => [...document.querySelectorAll(`#catalog input[type=checkbox][data-group="${group}"]:checked`)].map(input => input.value);
const baseLabel = () => release.catalog.base.replace(/^op1r(\d+).*$/, 'op1r $1');
// Same bits as runtime.config_id; op1r plugins hidden from the lists sit at a fixed position (op1r_plugins_bit).
function configId(c, withHidden = true) {
  const flags = [...release.catalog.synths.map(f => c.synths.includes(f.id)), ...release.catalog.effects.map(f => c.effects.includes(f.id)), c.preset_cap === 300, ...release.catalog.utilities.map(f => c.utilities.includes(f.id))];
  let id = flags.reduce((sum, flag, i) => sum + (flag ? 1n << BigInt(i) : 0n), 0n);
  if (withHidden) (release.catalog.op1r_plugins || []).forEach((f, i) => { if (c.hidden?.includes(f.id)) id += 1n << BigInt(release.catalog.op1r_plugins_bit + i); });
  if (c.lander) id |= 1n << 64n;
  return id.toString(16).padStart(2, '0');
}
// Match runtime.variant_config: only file-backed choices are forced into the source variant.
function variantChoices(c) {
  const v = {...c}; delete v.hidden;
  if (!kennel()) return {...v, utilities: c.utilities.length ? release.catalog.utilities.map(f => f.id) : []};
  for (const group of ['synths', 'effects', 'utilities'])
    v[group] = release.catalog[group].filter(f => f.file || f.files?.length || c[group].includes(f.id)).map(f => f.id);
  return v;
}
function validateChoices(c) {
  const keys = ['base', 'effects', 'preset_cap', 'schema', 'synths'];
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).filter(k => !['utilities', 'hidden', 'lander'].includes(k)).sort().join() !== keys.join() ||
      c.schema !== 1 || c.base !== release.catalog.base || !release.catalog.preset_caps.includes(c.preset_cap)) throw Error('These choices do not match this firmware base or preset capacity.');
  if (Object.hasOwn(c, 'lander') && (typeof c.lander !== 'boolean' || !release.catalog.core_options?.some(f => f.id === 'lander'))) throw Error('Unsupported Lander option.');
  const out = {...c, utilities: Object.hasOwn(c, 'utilities') ? c.utilities : [], hidden: Object.hasOwn(c, 'hidden') ? c.hidden : []};
  for (const group of ['synths', 'effects', 'utilities', 'hidden']) {
    const entries = group === 'hidden' ? release.catalog.op1r_plugins || [] : release.catalog[group];
    if (!Array.isArray(out[group]) || out[group].some(id => typeof id !== 'string') || new Set(out[group]).size !== out[group].length ||
        out[group].some(id => !entries.some(f => f.id === id))) throw Error('Unknown or duplicate ' + group + '.');
  }
  if (out.hidden.some(id => (release.catalog.op1r_plugins || []).some(f => f.id === id && (f.always || f.reserved)))) throw Error('Always-in or removed plugins cannot be hidden.');
  if (!kennel() && out.utilities.length !== 0 && out.utilities.length !== release.catalog.utilities.length) throw Error('Maiko features are included as one bundle. Select the full bundle or none.');
  const entries = ['synths', 'effects', 'utilities', 'op1r_plugins'].flatMap(g => release.catalog[g] || []);
  const on = new Set(['synths', 'effects', 'utilities'].flatMap(g => out[g]).concat((release.catalog.op1r_plugins || []).filter(f => !f.reserved && !out.hidden.includes(f.id)).map(f => f.id)));
  for (const f of entries.filter(f => on.has(f.id))) if ((f.needs || []).some(id => !on.has(id))) throw Error(f.id + ' needs ' + f.needs.join(', '));
  return out;
}

function clearDownloads() { urls.forEach(URL.revokeObjectURL); urls = []; $('downloads').hidden = true; $('push').hidden = true; pushFiles = []; pushResume = {}; if ($('push-plan')) $('push-plan').hidden = true; }
// The Manual tab shows only what this selection contains (manual.html reads it; see tools/manual/page.html).
function shareWithManual() {
  if (!release || !selectionsReady || storageBlocked) return;
  const c = choices();
  const without = [...new Set([...(release.catalog.core_options || []).filter(f => !c[f.id]).map(f => f.id),...['synths', 'effects', 'utilities'].flatMap(group => release.catalog[group].filter(f => !c[group].includes(f.id)).map(f => f.id)), ...(c.hidden || [])])].sort();
  const snapshot = {base: c.base, version: '3.0', without, plugins: (release.catalog.op1r_plugins || []).filter(f => !c.hidden?.includes(f.id) && !f.reserved).map(f => f.id), synths: c.synths, effects: c.effects, utilities: c.utilities, hidden: c.hidden || []};
  try { if (selectionStorageReady) localStorage.setItem('hundekraft-build', JSON.stringify(snapshot)); } catch (e) { /* private mode: the link below still carries it */ }
  const query = kennel() ? '?version=3.0' + (without.length ? '&without=' + without.map(encodeURIComponent).join(',') : '') : '';
  document.querySelectorAll('a[href^="manual.html"]').forEach(a => { a.href = 'manual.html' + query + (a.hash || ''); });
}
// any change in the form (the Maiko bundle too) reaches the manual
document.addEventListener('change', e => { if (e.target.closest('#workshop')) shareWithManual(); });
// Selection review uses the same resource resolver as the final device inventory check.
// Applying a choice removes optional files from the actual configuration and matching preset pack.
function selectionReview() {
  if (!release || !kennel()) return {conflicts: []};
  let box = $('selection-plan');
  if (!box) { box = document.createElement('div'); box.id = 'selection-plan'; box.setAttribute('role', 'status'); $('cat-panels').after(box); }
  const meta = release.plugin_metadata;
  if (!meta?.complete) { box.textContent = 'Compatibility cannot be checked for this release: plugin control information is missing.'; return {conflicts: [], blocked: true}; }
  const c = choices();
  const selectedNames = new Set(['synths', 'effects', 'utilities'].flatMap(g => release.catalog[g].filter(f => f.always || c[g].includes(f.id)).map(f => f.id))
    .concat((release.catalog.op1r_plugins || []).filter(f => !f.reserved && (f.always || !c.hidden?.includes(f.id))).map(f => f.id)));
  const entries = [...meta.plugins.filter(p => selectedNames.has(p.name)), ...meta.builtins];
  const plan = resolveConflicts(entries);
  const own = ownFiles.map(([p, d]) => pluginInfo(p, d));
  const ownNames = new Set(own.map(p => p.name));
  const sending = resolveConflicts([...entries.filter(e => !ownNames.has(e.name)), ...own]);
  box.innerHTML = plan.conflicts.map((conflict, i) => `<fieldset><legend>${conflict.names.map(escapeText).join(' and ')} both use ${escapeText(claimText(conflict.claim))}. Choose which plugin to include.</legend>${conflict.names.map(n => {
    const others = conflict.names.filter(x => x !== n);
    const possible = others.every(x => catalogInput(x));
    return `<label><input type="radio" name="selection-claim${i}" value="${escapeText(n)}" ${possible && !editingLocked() ? '' : 'disabled'}> ${escapeText(n)}${possible ? '' : ' (would remove a plugin that is always included)'}</label>`;
  }).join('')}</fieldset>`).join('') + (plan.conflicts.length ? '<p>The other whole plugin is left out of your firmware and preset pack.</p><button type="button" data-apply disabled>Apply choices</button>' : '')
    + (own.length ? `<p>Your own files are added when you send; they are not part of the firmware download.${sending.conflicts.length ? ` Before sending, choose which whole plugin stays on: ${sending.conflicts.map(x => `${x.names.join(' / ')} (${claimText(x.claim)})`).map(escapeText).join('; ')}.` : ''}${sending.unknown.length ? ` Compatibility could not be checked for ${sending.unknown.map(escapeText).join(', ')}.` : ''} The OP–1’s installed plugins are checked again before sending.</p>` : '');
  const apply = box.querySelector('[data-apply]');
  if (apply) {
    const chosen = () => Object.fromEntries(plan.conflicts.flatMap((x, i) => { const input = box.querySelector(`input[name=selection-claim${i}]:checked`); return input ? [[x.claim, input.value]] : []; }));
    box.onchange = () => { apply.disabled = editingLocked() || !resolveConflicts(entries, {winners: chosen()}).resolved; };
    apply.onclick = () => {
      if (editingLocked()) return;
      const winners = chosen();
      const resolved = resolveConflicts(entries, {winners});
      if (resolved.errors.length || resolved.unresolved.length) { status('These choices disagree. Choose a consistent set of plugins.', true); return; }
      for (const name of resolved.off) { const input = catalogInput(name); if (input) input.checked = false; }
      clearDownloads(); update(); status('Choices applied to your firmware, manual and preset pack.');
    };
  }
  return plan;
}
function catalogInput(name) {
  return [...document.querySelectorAll('#catalog input[type=checkbox]')].find(i => i.value === name || i.dataset.plugin === name);
}
const escapeText = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function update() {
  rememberSelection();
  shareWithManual();
  countTabs();
  const selection = selectionReview();
  updateSummary();
  $('cap-warning').hidden = $('expanded').checked;               // R246 asserts at boot with more presets than the cap
  document.querySelector('.capacity-number').textContent = $('cap-count').textContent;
  $('build').disabled = busy || devicePending || storageBlocked || !release || !file || (selection.blocked || !!selection.conflicts.length);
  for (const id of ['export', 'import', 'expanded']) $(id).disabled = editingLocked() || !release;
  if (release) {
    const c = choices();
    if ($('build-upstreams')) $('build-upstreams').textContent = `Original R246 · ${kennel() ? 'op1r + kennel' : baseLabel()}${c.utilities?.length ? (kennel() ? ` · ${c.utilities.length} of Maiko’s tools` : ' · Maiko #249') : ''}`;
    // the prebuilt variant: on kennel bases every file choice on (the build leaves files out); on 2.x Maiko's tools all or none
    const all = g => release.catalog[g].map(f => f.id);
    const v = variantChoices(c), id = configId(v, false);
    const presets = release.variants[id]?.presets;
    if (presets) {
      // presets of engines not in this build are left out of the pack (kennel: at build time; 2.x: by the variant)
      // left out, by saved name: presets store type names (the id with spaces, or an entry's 'saved')
      const saved = new Map(['synths', 'effects', 'op1r_plugins'].flatMap(g => release.catalog[g] || []).map(f => [f.id, f.saved || f.id]));
      const out = new Set([...all('synths').filter(x => !c.synths.includes(x)), ...all('effects').filter(x => !c.effects.includes(x)), ...(c.hidden || [])]
        .map(x => saved.get(x) || x));
      // items: [engine, fx] per preset (kennel releases): a preset goes when its engine or its FX is left out
      const kept = kennel() && presets.items ? presets.items.filter(([e, fx]) => !out.has(e) && !(fx && out.has(fx))) : null;
      const counts = {};
      if (kept) for (const [e] of kept) counts[e] = (counts[e] || 0) + 1;
      const by = kept ? Object.entries(counts) : Object.entries(presets.by_engine).filter(([engine]) => !kennel() || !out.has(engine));
      const count = by.reduce((n, [, k]) => n + k, 0), exact = !kennel() || (kept ? kept.length === presets.items.length : (!c.hidden?.length && ['synths', 'effects', 'utilities'].every(g => c[g].length === v[g].length && c[g].every(id => v[g].includes(id)))));
      $('preset-total').textContent = count;
      $('preset-intro-total').textContent = count;
      $('preset-breakdown').replaceChildren();
      for (const [engine, n] of by) {
        const item = document.createElement('span'); item.textContent = `${engine} / ${n}`; $('preset-breakdown').append(item);
      }
      // Drum/tools choices do not change synth presets. Offer the static pack whenever every preset survives.
      $('preset-pack-download').hidden = !exact;
      $('preset-pack-later').hidden = exact;
      $('preset-pack-download').href = `variants/${id}/presets.zip`;
      $('preset-pack-download').dataset.sha256 = presets.sha256;
      $('preset-pack-later').textContent = 'Your matching pack comes with your build: the selection differs from the complete pack.';
      $('preset-pack-download').download = `${release.release.product?.slug || "op1-hundekraft"}-${id}.presets.zip`;
      $('preset-warning').hidden = count <= ($('expanded').checked ? 300 : 100);
      $('preset-warning').textContent = `This pack has ${count} presets; your selected limit is 100. Enable 300 presets below, or install a subset. Existing user presets also count toward the limit.`;
    } else {
      $('preset-pack-download').hidden = true; $('preset-pack-download').removeAttribute('href');
      $('preset-pack-later').hidden = false; $('preset-pack-later').textContent = 'This selection is unavailable in this release. Reload the workshop or choose another selection.'; $('preset-breakdown').replaceChildren();
      $('preset-total').textContent = '—'; $('preset-intro-total').textContent = '—';
      $('preset-warning').hidden = true; $('build').disabled = true;
    }
    try { validateChoices(c); }
    catch (e) { $('build').disabled = true; status(e.message, true); }
  }
}
function setControls() {
  document.querySelectorAll('#catalog input[type=checkbox], #export, #import, #own-files').forEach(el => el.disabled = editingLocked());
  if (editingLocked()) document.querySelectorAll('#selection-plan input, #selection-plan button').forEach(el => el.disabled = true);
  $('firmware').disabled = busy || devicePending;
  document.querySelectorAll('#own-list button, #own-check, #own-send, #push-send').forEach(el => el.disabled = busy || devicePending || storageBlocked);
  if (firmwareWait) $('firmware').disabled = false;
}
function lock(value) {
  busy = value;
  $('cancel').hidden = !value || !worker;
  update(); setControls();
}
async function chooseFile(candidate) {
  if (((busy || devicePending) && !firmwareWait) || !candidate) return;
  const check = ++fileCheck;
  file = null;
  clearDownloads();
  update();
  $('file-name').textContent = 'Checking original R246…';
  status('Checking firmware contents…');
  try {
    if (!candidate.name.toLowerCase().endsWith('.op1') || candidate.size >= 15000000 || candidate.size < 8) {
      throw Error('Only the original, unmodified R246 firmware is accepted. Choose op1_246.op1.');
    }
    const bytes = await candidate.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (check !== fileCheck) return;
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== ORIGINAL_R246_SHA256) {
      throw Error('Rejected: this is not the original, unmodified R246 firmware. Other releases, op1r and already-patched files cannot be used.');
    }
    file = candidate;
    $('file-name').textContent = `${file.name} · ${(file.size / 1000000).toFixed(2)} MB · Original R246 verified`;
    status('Original R246 verified. Ready to build.');
  } catch (error) {
    if (check !== fileCheck) return;
    file = null; $('firmware').value = '';
    $('file-name').textContent = 'No valid firmware selected';
    status(error.message || 'Could not verify the firmware. Please choose the original R246 again.', true);
  }
  update();
  if (firmwareWait && file) { const ready = firmwareWait; firmwareWait = null; ready.resolve(); }
}
function link(id, blob, filename) {
  const url = URL.createObjectURL(blob); urls.push(url);
  $(id).href = url; $(id).download = filename;
}
function fail(error) {
  worker?.terminate(); worker = null; clearDownloads(); lock(false);
  status(String(error?.message || error || 'The build failed. Please try again.'), true);
}
$('firmware').addEventListener('change', e => chooseFile(e.target.files[0]));
for (const event of ['dragenter', 'dragover']) $('drop-zone').addEventListener(event, e => { e.preventDefault(); if (!busy || firmwareWait) $('drop-zone').classList.add('dragover'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragover'));
$('drop-zone').addEventListener('drop', e => { e.preventDefault(); $('drop-zone').classList.remove('dragover'); chooseFile(e.dataTransfer.files[0]); });
$('workshop').addEventListener('change', e => { if (e.target.matches('#expanded, #catalog input[type=checkbox][data-group], #catalog input[type=checkbox][data-plugin], #catalog input[type=checkbox][data-core]')) { clearDownloads(); updateStage(null); $('push-progress').hidden = true; pushStatus('Selections changed. Press Update OP–1 to review.'); update(); status(file ? 'Choices updated. Ready to build.' : 'Choose your original R246 firmware to continue.'); } });
$('cancel').addEventListener('click', () => {
  if (!worker) return;
  worker.cancelBuild?.(); worker.terminate(); worker = null; clearDownloads();
  status('Build cancelled. You can change your choices and try again.');
});
// Shared local build for the Build button and an automatic core upgrade during plugin Send.
async function buildFirmware(forSend = false) {
  const config = validateChoices(choices()), source = file, snapshot = release;
  if (!source) throw Error('A full firmware update is needed. Choose your original op1_246.op1 to prepare the firmware update. Nothing has been sent.');
  const selection = selectionReview();
  if (selection.blocked || selection.conflicts.length) throw Error('Resolve the plugin choices above before building. Nothing has been sent.');
  clearDownloads();
  if (!forSend) $('log').textContent = '';
  status('Starting the local patcher…');
  const active = new Worker('worker.js?v=3.0-hostile-ui-20261018', {type: 'module'});
  worker = active;
  $('cancel').hidden = false;
  try {
    const data = await new Promise((resolve, reject) => {
      active.onerror = e => reject(Error(e.message || 'The patcher could not start. Try again.'));
      active.onmessageerror = () => reject(Error('Could not read the build result. Please try again.'));
      active.onmessage = ({data}) => {
        if (worker !== active) return;
        if (data.type === 'log') {
          status(data.text); $('log').textContent += data.text + '\n';
          if (forSend) pushStatus('Preparing full firmware update: ' + data.text);
        }
        if (data.type === 'error') reject(Error(data.text));
        if (data.type === 'done') resolve(data);
      };
      // Cancel settles the pending build too; no abandoned promise or updater lock.
      active.cancelBuild = () => reject(Error('Cancelled before transfer. Nothing has been sent.'));
      source.arrayBuffer().then(bytes => {
        if (worker === active) active.postMessage({bytes, config, release: snapshot, push: forSend || pushEnabled()}, [bytes]);
      }).catch(reject);
    });
    const report = JSON.parse(data.report);
    if (data.id !== configId(config)) throw Error('The build result does not match your selection. Build again.');
    const stem = `${snapshot.release.product?.slug || 'op1_246-' + snapshot.catalog.base}${config.lander ? '-lander' : ''}`;
    // Keep the exact selection identity in the report, not in user-facing download names.
    report.config_id = data.id;
    report.filename = stem + '.op1';
    data.report = JSON.stringify(report, null, 2) + '\n';
    link('download-firmware', new Blob([data.out], {type:'application/octet-stream'}), stem + '.op1');
    link('download-presets', new Blob([data.presets], {type:'application/zip'}), stem + '.presets.zip');
    link('download-report', new Blob([data.report], {type:'application/json'}), stem + '.build.json');
    $('downloads').hidden = false; status('Verified. Your firmware is ready to download.');
    pushFiles = data.pushFiles || []; pushBuild = `${snapshot.release.id} / ${data.id}`; pushCap = config.preset_cap; pushResume = {};
    $('push').hidden = true;
    if ((forSend || pushEnabled()) && !pushFiles.some(([p]) => p === 'OP1_vdk.ldr')) throw Error('The build has no firmware core. Reload the page and build again.');
  } catch (e) { clearDownloads(); throw e; }
  finally { active.terminate(); if (worker === active) worker = null; }
}
$('workshop').addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target !== $('workshop') || busy || storageBlocked || !release || !file) return;
  lock(true);
  try { await buildFirmware(); }
  catch (error) { status(String(error.message || error), true); }
  finally { lock(false); }
});
const pushStatus = (text, error = false) => { $('push-status').textContent = text; $('push-status').classList.toggle('error', error); };
// A fixed device card owns connection, review, progress and recovery for every update.
function deviceContext() {
  $('device-feedback').hidden = false;
  pushStatus('');
  $('push-hint').hidden = true; $('push-hint').textContent = '';
  $('push-recovery').hidden = true;
  $('push-progress').hidden = true;
  $('device-actions').hidden = true; $('device-cancel-pending').hidden = true;
  if ($('push-plan')) $('push-plan').hidden = true;
}
function updateStage(stage) {
  $('update-steps').hidden = !stage;
  const steps = ['prepare', 'send', 'confirm', 'restart', 'verified'];
  for (const li of $('update-steps').children) {
    li.classList.toggle('current', li.dataset.step === stage);
    li.classList.toggle('complete', steps.indexOf(li.dataset.step) < steps.indexOf(stage));
    if (li.dataset.step === stage) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
}
function observeConnection(port) {
  stopConnectionWatch?.();
  stopConnectionWatch = port.watchConnection?.(connected => {
    if (!connected && !installingUntil) {
      deviceInventory = null; observedOwn = []; showOwn();
      $('device-state').textContent = 'OP–1 disconnected · reconnect USB to continue';
      $('own-check').textContent = 'Connect OP–1';
    }
  });
}
function connectionState(inv, name = 'OP–1') {
  deviceInventory = inv;
  $('device-state').textContent = `${name} connected · ${inv?.plugins ? 'installed plugins checked' : 'firmware update available'}`;
  $('own-check').textContent = 'Refresh';
}
function recoveryActions(action, label) {
  retryAction = action;
  $('device-actions').hidden = false;
  $('device-retry').textContent = label;
}
function deviceError(error, suffix = '', failed = true) {
  pushStatus(String(error.message || error) + suffix, failed);
  if (failed && /No OP|MIDI access|talk to MIDI|no answer/i.test(error.message || '')) { $('device-state').textContent = 'Connection not confirmed'; $('own-check').textContent = 'Connect OP–1'; }
  $('push-hint').textContent = error.hint || '';
  $('push-hint').hidden = !error.hint;
  if (failed) recoveryActions(retryAction, retryAction === 'verify' ? 'Retry verification' : retryAction === 'update' ? 'Resume update' : 'Retry connection');
}
function unresolvedUpdate(inv = null) {
  if (!pendingUpdate()) return;
  recoveryActions('verify', 'Retry verification');
  $('device-cancel-pending').hidden = Date.now() < installingUntil;
  pushStatus(Date.now() < installingUntil
    ? 'Installation is still awaiting verification. Wait for the tape screen, then Refresh. Plugin edits and Undo wait until the result is known.'
    : 'The previous update is not verified. Retry verification, resume the update, or cancel its pending files before using Remove / Undo.');
  if (inv) pushStatus($('push-status').textContent + ' ' + updateDifferences(inv, ownState.verification).slice(0, 3).join('; ') + '.');
}
async function openDevice() {
  const controller = new AbortController(), button = document.createElement('button');
  button.type = 'button'; button.className = 'connection-cancel'; button.textContent = 'Cancel connection';
  button.onclick = () => controller.abort(); $('device-feedback').append(button);
  pushStatus('Allow MIDI access if asked. Looking for your OP–1…');
  try { return await openWebMidi(navigator, new URLSearchParams(location.search).has('debug'), {signal: controller.signal}); }
  finally { button.remove(); }
}
function requestFirmware() {
  if (file) return Promise.resolve();
  $('download-option').open = true;
  $('firmware-reason').textContent = 'This update also needs a firmware upgrade. Choose original R246 here; preparation continues automatically. Nothing has been sent.';
  pushStatus('Firmware upgrade needed. Choose original R246 below to continue.');
  $('firmware').disabled = false;
  $('firmware').focus();
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel update';
  $('device-feedback').append(cancel);
  return new Promise((resolve, reject) => {
    firmwareWait = {resolve: () => { cancel.remove(); $('firmware').disabled = true; resolve(); }};
    cancel.onclick = () => { fileCheck++; firmwareWait = null; cancel.remove(); $('firmware').disabled = true; reject(Error('Cancelled before transfer. Your selections are saved.')); };
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function verifyRestart(full) {
  stopVerification = false;
  const controller = new AbortController(); verificationController = controller;
  $('verification-stop').hidden = false; $('verification-stop').disabled = false;
  const deadline = Date.now() + (full ? 240000 : 90000);
  let lastInventory = null;
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    while (Date.now() < deadline && !controller.signal.aborted) {
      await pause(2500);
      if (controller.signal.aborted) break;
      let port, inv;
      try {
        port = await openWebMidi(navigator, false, {signal: controller.signal});
        inv = await readInventory(port, {timeoutMs: 800, tries: 1, signal: controller.signal});
      } catch {
        // Only connection/read failures are transient. Storage/state errors must escape.
        continue;
      } finally { port?.close(); }
      if (controller.signal.aborted) break;
      if (inv) lastInventory = inv;
      if (inv && confirmInventory(inv)) {
        observeConnection(port); connectionState(inv, port.name); await rememberOwn(); showOwn(inv);
        updateStage('verified'); $('push-label').textContent = 'UPDATE VERIFIED'; $('push-eta').textContent = 'installed';
        pushStatus('Update installed and verified. Your OP–1 is ready.' + (ownFiles.some(([path]) => !inv.records.some(r => r.path === path)) ? ' Your saved uploads still need installing: press Update OP–1 again to review them.' : ''));
        $('device-actions').hidden = true;
        const box = $('push-plan');
        if (box && !box.hidden) {
          const receipt = document.createElement('details'), title = document.createElement('summary');
          title.textContent = 'View installed changes'; receipt.append(title, ...box.childNodes); box.replaceChildren(receipt);
        }
        return true;
      }
    }
  } finally {
    clearTimeout(timer); verificationController = null; $('verification-stop').hidden = true;
  }
  // Check later releases the session but keeps the persisted installation guard.
  if (lastInventory) showOwn(lastInventory);
  unresolvedUpdate(lastInventory);
  return false;
}
const mb = n => (n / 1e6).toFixed(2);
const duration = s => s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
const timeLeft = s => s > 90 ? `about ${Math.round(s / 60)} min left` : `about ${Math.max(5, Math.round(s / 5) * 5)} s left`;
function pushBar(label, sent, total, right, stopped = false) {
  $('push-progress').hidden = false;
  $('push-label').textContent = label;
  const percent = Math.min(100, Math.floor(sent * 100 / Math.max(1, total)));
  $('push-fill').style.width = `${percent}%`;
  $('push-fill').classList.toggle('stopped', stopped);
  $('push-amount').textContent = sent >= total ? `100% · ${mb(total)} MB sent` : `${percent}% · ${mb(sent)} of ${mb(total)} MB`;
  $('push-eta').textContent = right;
}
function planBox() {                                           // the plugin list, under the progress bar
  let box = $('push-plan');
  if (!box) { box = document.createElement('div'); box.id = 'push-plan'; $('push-progress').after(box); }
  return box;
}
// Plan for a kennel OP-1: ask when two plugins want the same control, and once when there are your own files on it
// that could be removed. Draws the final list under the progress bar.
async function settlePlan(inv, wanted, opts, full = false) {
  const box = planBox(), planner = full ? planFullUpdate : planPlugins;
  let winners = {}, asked = false, unknownAccepted = false, acceptedSignature = null;
  for (;;) {
    rememberSelection();
    if (storageBlocked) throw Error(storageError);
    const manageOwn = opts.includeOwn !== false;
    const drop = manageOwn ? inv.records.filter(r => r.path?.startsWith('plugins/') && ownState.removals.some(x => removalMatches(x, r))).map(r => r.path) : [];
    // Refresh desired files after every Remove/Undo, keeping workshop selections independent.
    const own = manageOwn ? ownFiles.map(([p, d]) => [p, d]) : [];
    const desired = wanted;
    const preliminary = planner(inv, desired, {...opts, own, drop});
    const forceOn = [], forceOff = [];
    for (const e of preliminary.entries) {
      const t = ownState.toggles[e.name];
      if (t?.signature === providerSignature(e)) (t.on ? forceOn : forceOff).push(e.name);
    }
    let plan = planner(inv, desired, {...opts, own, drop, forceOn, forceOff});
    const signature = reviewSignature(inv, plan.entries);
    const saved = ownState.reviews[signature] || {};
    if (acceptedSignature !== signature) { winners = saved.winners || {}; unknownAccepted = !!saved.unknownAccepted; asked = false; }
    plan = planner(inv, desired, {...opts, own, drop, forceOn, forceOff, winners});
    const needsReview = full || plan.changed || !plan.resolved || (plan.unknown.length && !unknownAccepted);
    if (needsReview && (!asked || !plan.resolved || (plan.unknown.length && !unknownAccepted))) {
      pushStatus(full ? 'Full firmware update required: review the core update and plugin changes. Nothing has been sent.' : 'Review installs, replacements, removals and whole-plugin on/off choices. Nothing has been sent.');
      const r = await showPlan(box, plan, {ask: true, pending: manageOwn ? ownState.removals : [], saved, full, deferredOwn: opts.deferredOwn || [], coreNote: release.catalog.core_options?.length ? `Lander: ${choices().lander ? 'enabled' : 'disabled'}. Changing this option requires full firmware.` : ''});
      if (r.remove) { const e = plan.entries.find(e => e.path === r.remove); await removeOwn(e.name, e.path); acceptedSignature = null; continue; }
      if (r.undo) { await undoRemoval(r.undo); acceptedSignature = null; continue; }
      if (r.toggle) {
        const e = plan.entries.find(e => e.name === r.toggle);
        ownState.toggles = {...ownState.toggles, [e.name]: {signature: providerSignature(e), on: r.on}};
        ownState.reviews = {}; await rememberOwn(); acceptedSignature = null; continue;
      }
      winners = r.winners; unknownAccepted = r.unknownAccepted; asked = true; acceptedSignature = signature;
      ownState.reviews[signature] = {winners, unknownAccepted};
      if (Object.keys(ownState.reviews).length > 30) delete ownState.reviews[Object.keys(ownState.reviews)[0]];
      await rememberOwn();
      continue;
    }
    const current = await opts.recheck() || {records: [], off: []};
    if ((current?.core || inv?.core) && !sameCore(current?.core, inv?.core)) throw Error('Your OP–1’s firmware changed during review. Press Send again.');
    if (JSON.stringify(current) !== JSON.stringify(inv)) {
      inv = current; acceptedSignature = null; continue;
    }
    assertResolvedPlan(plan);
    await showPlan(box, plan, {ask: false, full, deferredOwn: opts.deferredOwn || [], coreNote: release.catalog.core_options?.length ? `Lander: ${choices().lander ? 'enabled' : 'disabled'}. Changing this option requires full firmware.` : ''});
    return {...plan, reviewedInventory: current, managesOwn: manageOwn};
  }
}
// Plugin management remains build-free with a matching core; otherwise prepare and review a full update.
async function sendToOp1() {
  let ownOnly = true;
  if (storageBlocked) { ownStatus(storageError || 'Reload this tab to restore the latest saved selections.', true); return; }
  if (busy || (ownOnly ? !release || !kennel() : !pushFiles.length)) return;
  if (Date.now() < installingUntil) {                        // after T1 the OP-1 restarts and writes its firmware: leave it alone
    unresolvedUpdate();
    return;
  }
  const own = ownFiles.map(([p, d]) => [p, d]);
  let expectedPlan = null;
  let files = ownOnly ? own : pushFiles, total = files.reduce((n, [, d]) => n + d.length, 0), port, sent = 0, extra = {}, pluginsOnly = false;
  let t0 = performance.now(); let base = null, rate = 0;   // bytes per second, smoothed; time left from it
  retryAction = 'update'; updateStage('prepare');
  $('push-send').hidden = true;
  lock(true); $('cancel').hidden = true; $('push-send').disabled = true; $('own-send').disabled = true;
  try {
    pushStatus('Looking for your OP–1…');
    port = await openDevice();
    // What the OP-1 has (kennel; null on 2.x). With the same core as this build, only plugin files go over: the
    // changed ones, removals and the switched-off list, after claim conflicts are settled. Otherwise the whole update.
    pushStatus('Checking what’s on your OP–1…');
    const log = text => { $('log').textContent += text + '\n'; };
    const inv = await readInventory(port, {log});
    if (inv && confirmInventory(inv)) await rememberOwn();
    if (inv) showOwn(inv);
    observeConnection(port); connectionState(inv, port.name);
    const recheck = () => readInventory(port, {log});
    showInventory(inv);
    if (ownOnly) {
      const target = targetCore();
      const coreMatches = sameCore(target, inv?.core);
      if (!coreMatches) {
        pushStatus('A full firmware update is needed. Preparing it locally before review…');
        await requestFirmware();
        await buildFirmware(true);
        files = pushFiles;
        ownOnly = false;
      } else {
        pushStatus('Preparing your selected plugin updates…');
        files = await workshopFiles();
      }
    }
    const ldr = files.find(([p]) => p === 'OP1_vdk.ldr')?.[1];
    // R246 stops at startup when it holds more user synth presets than the firmware's limit
    if (!ownOnly && inv?.presets && inv.presets.count > pushCap)
      throw Error(`Your OP–1 holds ${inv.presets.count} user synth presets, more than this build's limit of ${pushCap}. It would stop at startup. Build with 300 presets, or delete some presets first.`);
    if (ownOnly) {
      if (!inv?.plugins) throw Error('Your own plugins need hundekraft 3.0 on the OP–1. Build and send 3.0 first, then add them.');
      const plan = await settlePlan(inv, files, {own, metadata: targetMetadata(), recheck});
      if (!plan.changed) {
        const reviewed = plan.reviewedInventory;
        ownState.removals = ownState.removals.filter(r => reviewed.records.some(e => e.path?.startsWith('plugins/') && removalMatches(r, e)));
        if (ownState.verification) confirmInventory(reviewed);
        await rememberOwn(); showOwn(reviewed);
        if (!ownState.verification) updateStage('verified');
        pushStatus(ownState.verification ? 'Files match, but previous changes still await device confirmation. Refresh after restart to verify.' : 'Your OP–1 is up to date. No changes to send.'); return;
      }
      expectedPlan = plan;
      log(`selected plugin changes: ${plan.send.length} files to send, ${plan.deletes.length} to remove`);
      files = plan.send; pluginsOnly = true;
      extra = {deletes: plan.deletes, off: plan.offChanged ? plan.off : undefined};
    } else if (kennel()) {
      if (!release.plugin_metadata?.complete) throw Error('Cannot check this firmware’s built-in controls: release information is missing. Use a release with plugin metadata.');
      log('sending the whole firmware; checking its target controls and the plugins you keep');
      const plan = await settlePlan(inv || {records: [], off: []}, files.filter(([p]) => pluginPath(p)),
        {own, metadata: targetMetadata(), builtins: targetBuiltins(), recheck, includeOwn: !!inv?.plugins, deferredOwn: !inv?.plugins ? ownFiles.map(([p,d]) => pluginInfo(p,d).name) : []}, true);
      if (!inv?.plugins && (plan.deletes.length || plan.off.length)) throw Error('This device updater cannot apply plugin removals or on/off choices. Install the downloaded firmware through the boot menu first.');
      if (!inv?.plugins && ownFiles.length) log('Your saved own plugins wait until the new core is installed. Send plugin changes after restart.');
      expectedPlan = plan;
      files = [...files.filter(([p]) => !pluginPath(p)), ...plan.send];
      extra = {deletes: plan.deletes.length ? plan.deletes : undefined, off: plan.off.length || (inv?.off?.length) ? plan.off : undefined};
    } else {
      if (inv) log('the OP–1 runs a different core: sending the whole firmware');
      if (own.length) log('your own plugins wait: this OP–1 takes them once 3.0 is on it. Send again after the restart.');
    }
    total = Math.max(1, files.reduce((n, [, d]) => n + d.length, 0));
    t0 = performance.now(); updateStage('send');
    pushStatus(`Keep the OP–1 connected. If the cable comes out, plug it back in; pressing Send again picks up where it stopped.`);
    pushBar('SENDING TO OP–1', 0, total, 'estimating…');
    if (expectedPlan) {
      const previousVerification = ownState.verification;
      const reviewed = expectedPlan.reviewedInventory;
      const core = !pluginsOnly && targetCore() ? {...targetCore()} : reviewed?.core && {...reviewed.core};
      if (core && ldr) core.crc = ldrRangeCrc(ldr, core.start, core.len);
      ownState.verification = {phase: 'sending', notBefore: 0, core: core?.crc != null ? core : null,
        files: expectedPlan.entries.filter(e => e.path).map(e => ({path: e.path, crc: e.crc, on: e.on})),
        builtins: expectedPlan.entries.filter(e => e.source === 'builtin' && !e.path).map(e => ({name: e.name, on: e.on})),
        deletes: expectedPlan.deletes, off: expectedPlan.off, removals: expectedPlan.managesOwn ? ownState.removals.map(removalId) : []};
      try { await rememberOwn(true); } catch (error) { ownState.verification = previousVerification; throw error; }
      showOwn();
    }
    await push(port, files, {
      resume: pushResume, ...extra,
      progress: (done) => {
        sent = done; const now = performance.now();
        if (!base) base = {t: now, b: done};
        const dt = (now - base.t) / 1000;
        if (dt > 0.5) { const r = (done - base.b) / dt; rate = rate ? rate * 0.9 + r * 0.1 : r; base = {t: now, b: done}; }
        const left = rate > 0 ? (total - done) / rate : 0;
        pushBar('SENDING TO OP–1', done, total, (now - t0) > 3000 && rate > 0 ? timeLeft(left) : 'estimating…');
      },
      confirm: () => { updateStage('confirm'); $('push-recovery').hidden = pluginsOnly;
                       pushBar('CONFIRM ON THE OP–1', total, total, duration((performance.now() - t0) / 1000));
                       pushStatus('Press T1 on the OP–1 to restart and install. ' + (extra.off !== undefined ? 'T2 cancels the file install; your plugin on/off choices are already saved for the next restart.' : 'T2 cancels.')); },
      log
    });
    updateStage('restart');
    pushBar('RESTARTING', total, total, 'waiting for OP–1');
    installingUntil = Date.now() + (pluginsOnly ? 90000 : 240000);
    if (ownState.verification) { ownState.verification.phase = 'installing'; ownState.verification.notBefore = installingUntil; await rememberOwn(); }
    pushStatus('Wait for the tape screen. The workshop will reconnect and verify the update automatically.');
    port?.close(); port = null;
    if (ownState.verification) await verifyRestart(!pluginsOnly);
    else { installingUntil = 0; pushStatus('Update sent. Wait for the tape screen, then reconnect to check the result.'); }
  } catch (error) {
    const msg = String(error.message || error), cancelled = /^Cancelled/.test(msg);
    if (cancelled) $('push-recovery').hidden = true;
    if (!$('push-progress').hidden) pushBar(cancelled ? 'CANCELLED' : `STOPPED AT ${Math.floor(sent * 100 / total)}%`, sent, total,
                                            /answer/.test(msg) ? 'no answer' : '', !cancelled);
    if (cancelled) {
      updateStage(null); $('device-actions').hidden = true;
      if (/Cancelled on the OP/.test(msg)) { ownState.verification = null; installingUntil = 0; await rememberOwn(); }
    }
    deviceError(error, !cancelled && extra.off !== undefined ? ' On/off choices may already be saved on the OP–1 even if file installation failed or was cancelled. Refresh after restart to verify.' : '', !cancelled);
  }
  finally { port?.close(); lock(false); showOwn(); $('push-send').disabled = false; $('own-send').disabled = false; }
}
// One updater session per origin: separate tabs otherwise mix SysEx replies/sequence numbers.
async function withDevice(action, own = false) {
  if (busy || devicePending) return;
  devicePending = true; setControls();
  deviceContext(own);
  try {
    if (!navigator.locks?.request) throw Error('This browser cannot coordinate device updates across tabs. Use a current browser with Web Locks support.');
    await navigator.locks.request('hundekraft-op1-midi', {ifAvailable: true}, async lock => {
      if (!lock) throw Error('Another workshop tab is using the OP–1. Finish or cancel there first.');
      await action();
    });
  } catch (e) { deviceError(e); }
  finally { devicePending = false; lock(false); }
}
$('push-send').addEventListener('click', () => withDevice(() => sendToOp1()));
$('own-send').addEventListener('click', () => withDevice(() => sendToOp1(), true));
$('own-check').addEventListener('click', () => withDevice(async () => {
  if (busy || storageBlocked) { if (storageBlocked) ownStatus(storageError, true); return; }
  let port; lock(true); retryAction = ownState.verification ? 'verify' : 'connect';
  try {
    pushStatus('Looking for your OP–1…');
    port = await openDevice();
    pushStatus('Checking what’s on your OP–1…');
    const inv = await readInventory(port, {log: text => { $('log').textContent += text + '\n'; }});
    observeConnection(port); connectionState(inv, port.name);
    if (!inv?.plugins) { pushStatus('Connected. Update OP–1 will review the firmware upgrade needed for plugin management.'); return; }
    const confirmed = confirmInventory(inv);
    await rememberOwn(); showOwn(inv);
    if (confirmed) updateStage('verified');
    if (pendingUpdate()) { unresolvedUpdate(inv); return; }
    pushStatus(confirmed ? 'Update installed and verified. Your OP–1 is ready.' : ownState.verification ? 'Changes are not yet confirmed. If you cancelled on the OP–1, review and send again.' : 'Connected. Choose plugins or remove your uploads, then press Update OP–1.');
  } catch (e) { deviceError(e, '', !/^Cancelled/.test(e.message || '')); }
  finally { port?.close(); lock(false); showOwn(); }
}, true));
$('device-cancel-pending').onclick = () => withDevice(async () => {
  let port; lock(true);
  try {
    port = await openDevice();
    const inv = await readInventory(port);
    if (!inv?.plugins) throw Error('Reconnect an OP–1 running 3.0 to check the pending update.');
    connectionState(inv, port.name);
    if (confirmInventory(inv)) { await rememberOwn(); showOwn(inv); updateStage('verified'); pushStatus('Update installed and verified. Your OP–1 is ready.'); return; }
    if (Date.now() < installingUntil) { unresolvedUpdate(); return; }
    await rememberOwn();
    const reply = await session(port).ask(ABORT);
    if (reply[2] !== OK) throw Error('The OP–1 did not cancel its pending files. Refresh before trying again.');
    ownState.verification = null; installingUntil = 0; pushResume = {};
    await rememberOwn(); showOwn(inv); updateStage(null); $('push-plan')?.setAttribute('hidden', '');
    $('device-actions').hidden = true;
    pushStatus('Pending files cancelled on the OP–1. Plugin on/off choices already saved there are unchanged. Remove / Undo is available again.');
  } catch (error) { deviceError(error); }
  finally { port?.close(); lock(false); showOwn(); }
}, true);
$('device-retry').onclick = () => retryAction === 'update' ? $('own-send').click() : $('own-check').click();
document.querySelectorAll('a[href="#drop-zone"]').forEach(a => a.addEventListener('click', () => { $('download-option').open = true; }));
$('device-download').onclick = () => { $('download-option').open = true; $('download-option').scrollIntoView({block: 'center'}); };
const stopButton = document.createElement('button'); stopButton.id = 'verification-stop'; stopButton.type = 'button'; stopButton.textContent = 'Check later'; stopButton.hidden = true;
stopButton.onclick = () => { stopVerification = true; verificationController?.abort(); stopButton.disabled = true; };
$('device-feedback').append(stopButton);
// Your own plugin files: checked as the OP-1's loader would, kept across rebuilds, one per name
const ownStatus = (text, error = false) => { $('own-status').textContent = text; $('own-status').classList.toggle('error', error); };
let observedOwn = [];
function showOwn(inv) {
  if (inv) { deviceInventory = inv; observedOwn = inv.records.filter(r => r.path?.startsWith('plugins/')); }
  const rows = new Map(observedOwn.map(r => [r.name || r.path, {name: r.name, path: r.path, label: `Your plugin · Installed${r.state === 'loaded' ? '' : ' · ' + r.state}`}]));
  for (const [p, d, fileName] of ownFiles) { const i = pluginInfo(p, d); rows.set(i.name, {name: i.name, path: p, label: `Your plugin · ${observedOwn.some(r => r.path === p && r.crc === i.crc) ? 'Installed' : 'Ready to add / update'} · ${fileName} · ${Math.max(1, Math.round(d.length / 1024))} KB`}); }
  for (const r of ownState.removals) rows.set(removalId(r), {...r, pending: true, label: 'Your plugin · Will be removed on update'});
  $('own-list').replaceChildren(...[...rows.values()].map(r => {
    const li = document.createElement('li'), name = document.createElement('span'), btn = document.createElement('button');
    li.dataset.pendingRemoval = String(!!r.pending);
    name.textContent = `${r.name || r.path} · ${r.label}`;
    btn.type = 'button'; btn.textContent = pendingUpdate() ? 'Verify first' : r.pending ? 'Undo' : 'Remove'; btn.disabled = busy || devicePending;
    btn.onclick = async () => {
      if (pendingUpdate()) { $('own-check').click(); return; }
      try { if (r.pending) await undoRemoval(removalId(r)); else await removeOwn(r.name, r.path); }
      catch (e) { ownStatus(e.message, true); }
    };
    li.append(name, btn); return li;
  }));
  $('own-send').hidden = false;
  $('own-send').textContent = 'Update OP–1 →';
  $('own-empty').hidden = rows.size > 0;
  if (release) { selectionReview(); countTabs(); updateSummary(); }
  if (storageError) ownStatus(storageError, true);
  else if (ownState.verification) ownStatus('Update awaiting verification. Connect or Refresh once the tape screen returns.');
}
async function addOwn(list) {
  if (editingLocked() || !release) return;
  lock(true);
  try {
  const errors = [];
  for (const f of list) {
    try {
      if (f.size > 0x80000) throw Error(`${f.name}: too big to load (512 KB at most)`);
      const d = new Uint8Array(await f.arrayBuffer()), {path, info} = checkPlugin(f.name, d);
      const same = ownFiles.findIndex(([p, bytes]) => pluginInfo(p, bytes).name === info.name);
      if (same >= 0) ownFiles.splice(same, 1);              // the same plugin again: the newer file wins
      ownFiles.push([path, d, f.name]);
      ownState.removals = ownState.removals.filter(r => r.name !== info.name);
      ownState.reviews = {}; ownState.verification = null;
      $('log').textContent += `your plugin ${info.name} (${info.kind}${info.version ? ' ' + info.version : ''}): checked\n`;
    } catch (e) { errors.push(e.message); }
  }
  await rememberOwn(); showOwn();
  ownStatus(storageError || (errors.length ? errors.join('\n') : ownFiles.length ? 'Saved. Press Update OP–1 to review and install your changes.' : ''), !!storageError || errors.length > 0);
  } catch (e) { ownStatus(e.message, true); }
  finally { lock(false); showOwn(); }
}
$('own-files').addEventListener('change', e => { if (!editingLocked()) addOwn([...e.target.files]); e.target.value = ''; });
for (const event of ['dragenter', 'dragover']) $('own-drop').addEventListener(event, e => { e.preventDefault(); if (!editingLocked()) $('own-drop').classList.add('dragover'); });
$('own-drop').addEventListener('dragleave', () => $('own-drop').classList.remove('dragover'));
$('own-drop').addEventListener('drop', e => { e.preventDefault(); $('own-drop').classList.remove('dragover'); if (!editingLocked()) addOwn([...e.dataTransfer.files]); });
$('preset-pack-download').addEventListener('click', async e => {
  e.preventDefault();
  const target = e.currentTarget;
  if (busy || !release || target.hidden || !target.hasAttribute('href')) return;
  const href = target.href, expected = target.dataset.sha256, filename = target.download;
  lock(true); status('Checking the preset pack…');
  try {
    const response = await fetch(href, {cache: 'no-cache'});
    if (!response.ok) throw Error('Could not download the preset pack. Check your connection and try again.');
    const bytes = await response.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== expected) throw Error('The preset release changed. Reload the workshop before downloading.');
    const url = URL.createObjectURL(new Blob([bytes], {type: 'application/zip'})), a = document.createElement('a');
    a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    status('Preset pack verified. Install it separately through disk mode.');
  } catch (error) { status(error.message, true); }
  finally { lock(false); }
});
$('export').addEventListener('click', () => {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(choices(), null, 2) + '\n'], {type:'application/json'}));
  a.href = url; a.download = `${release.release.product?.slug || 'op1-workshop'}-choices.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import').addEventListener('change', async e => {
  if (busy || !release || !e.target.files[0]) return;
  if (storageBlocked) { status(storageError || 'Reload before loading choices.', true); e.target.value = ''; return; }
  lock(true);
  try {
    if (e.target.files[0].size > 256 * 1024) throw Error('Choices file is too large (256 KB at most).');
    const c = validateChoices(JSON.parse(await e.target.files[0].text()));
    document.querySelectorAll('#catalog input[type=checkbox][data-group]').forEach(el => el.checked = c[el.dataset.group].includes(el.value));
    document.querySelectorAll('input[data-plugin]').forEach(el => el.checked = !c.hidden.includes(el.dataset.plugin));
    document.querySelectorAll('#catalog input[type=checkbox][data-core]').forEach(el => el.checked = c[el.dataset.core] === true);
    $('expanded').checked = kennel() || c.preset_cap === 300; clearDownloads(); update(); status('Choices loaded.');
  } catch (error) { status('Could not load choices: ' + error.message, true); }
  finally { e.target.value = ''; lock(false); }
});
// One tab per category; every card the same size: screen, name, a line, who made it. A tick where it can be left out.
function renderCatalog() {
  const tabs = $('cat-tabs'), panels = $('cat-panels');
  // a choice the release offers; 'always' entries are built into this base's core, so they have no box
  const has = pick => { const [g, id] = pick.split(':'); return (g === 'plugin' ? release.catalog.op1r_plugins || [] : g === 'core' ? release.catalog.core_options || [] : release.catalog[g] || []).some(f => f.id === id && !f.always); };
  CATEGORIES.forEach((cat, k) => {
    // a pick the release doesn't offer as a choice is built in on this base: shown, always in, no box
    const items = cat.items.filter(it => (!it.kennel || kennel()) && (!it.requiresChoice || (it.pick && has(it.pick)))).map(it => !kennel() && it.pick2x ? {...it, pick: it.pick2x} : it)
      .map(it => it.pick && !has(it.pick) ? {...it, pick: undefined} : it);
    if (!items.length) return;
    const tab = document.createElement('button'); tab.type = 'button'; tab.role = 'tab'; tab.id = `tab-${cat.id}`;
    tab.tabIndex = tabs.children.length ? -1 : 0;
    tab.setAttribute('aria-controls', `panel-${cat.id}`); tab.setAttribute('aria-selected', String(!tabs.children.length));
    tab.innerHTML = `${cat.label} <small data-count></small>`;
    const panel = document.createElement('div'); panel.className = 'cat-grid'; panel.id = `panel-${cat.id}`; panel.role = 'tabpanel';
    panel.setAttribute('aria-labelledby', tab.id); panel.hidden = tabs.children.length > 0;
    for (const it of items) {
      const card = document.createElement(it.pick ? 'label' : 'div'); card.className = 'cat-card';
      const head = document.createElement('span'); head.className = 'cat-head';
      if (it.pick) {
        const [group, id] = it.pick.split(':'), input = document.createElement('input');
        input.type = 'checkbox'; input.checked = it.defaultOn !== false; input.setAttribute('aria-label', `Include ${it.name}`);
        if (group === 'core') input.dataset.core = id; else if (group === 'plugin') input.dataset.plugin = id; else { input.dataset.group = group; input.value = id; }
        head.append(input);
      }
      const name = document.createElement('strong'); name.textContent = it.name; head.append(name);
      if (it.isNew) { const tag = document.createElement('span'); tag.className = 'cat-new'; tag.textContent = 'New!'; head.append(tag); }
      if (!it.pick) { const tag = document.createElement('span'); tag.className = 'cat-tag'; tag.textContent = 'ALWAYS IN'; head.append(tag); }
      const pic = document.createElement('img'), nativePic = kennel() && it.kennelImg; pic.src = nativePic || it.img; pic.alt = (nativePic ? it.kennelImageAlt : it.imageAlt) || `${it.name} on the OP–1 screen`; pic.width = 400; pic.height = 200; pic.loading = 'lazy';
      const line = document.createElement('span'); line.className = 'cat-line'; line.textContent = it.line + ' ';
      const more = document.createElement('a'); more.href = `manual.html#${it.manual}`; more.textContent = 'manual →'; line.append(more);
      const by = document.createElement('span'); by.className = 'cat-by'; by.textContent = it.by;
      card.append(head, pic, line, by); panel.append(card);
    }
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('[role=tab]').forEach(t => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
      panels.querySelectorAll('[role=tabpanel]').forEach(p => { p.hidden = p !== panel; });
    });
    tabs.append(tab); panels.append(panel);
  });
  if (kennel() && pushEnabled()) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.role = 'tab'; tab.id = 'tab-your-plugins';
    tab.tabIndex = -1; tab.setAttribute('aria-controls', 'panel-your-plugins'); tab.setAttribute('aria-selected', 'false');
    tab.innerHTML = 'Your plugins <small data-count>0</small>';
    const panel = document.createElement('div'); panel.id = 'panel-your-plugins'; panel.role = 'tabpanel'; panel.hidden = true;
    panel.setAttribute('aria-labelledby', tab.id); panel.append($('own'));
    tab.onclick = () => {
      for (const t of tabs.querySelectorAll('[role=tab]')) { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; }
      for (const p of panels.querySelectorAll('[role=tabpanel]')) p.hidden = p !== panel;
    };
    tabs.append(tab); panels.append(panel);
  }
  tabs.addEventListener('keydown', e => {
    const list = [...tabs.querySelectorAll('[role=tab]')], i = list.indexOf(e.target);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    list[next].click(); list[next].focus();
  });
  // 2.x bases: Maiko's tools are one image, so their ticks move together
  if (!kennel()) panels.addEventListener('change', e => {
    if (e.target.dataset.group === 'utilities') panels.querySelectorAll('input[data-group=utilities]').forEach(i => { i.checked = e.target.checked; });
  });
  $('catalog-base').textContent = kennel() ? 'BUILT ON OP1R AND KENNEL' : `BUILT ON ${baseLabel().toUpperCase()}`;
}
function categoryCounts(panel) {
  const cards = [...panel.querySelectorAll('.cat-card')];
  return {total: cards.length, selected: cards.filter(card => card.querySelector('input[type=checkbox]')?.checked !== false).length};
}
function updateSummary() {
  const rows = [];
  const row = (label, value, id) => {
    const wrap = document.createElement('div'), term = document.createElement('dt'), count = document.createElement('dd');
    term.textContent = label; count.textContent = value;
    if (id) count.id = id;
    wrap.append(term, count); rows.push(wrap);
  };
  for (const cat of CATEGORIES) {
    const panel = $(`panel-${cat.id}`);
    if (!panel) continue;
    const count = categoryCounts(panel);
    row(cat.label, `${count.selected} / ${count.total}`);
  }
  const lander = document.querySelector('input[data-core=lander]');
  if (lander) row('Lander', lander.checked ? 'On' : 'Off');
  if ($('panel-your-plugins')) {
    const pending = $('own-list').querySelectorAll('[data-pending-removal=true]').length;
    const kept = $('own-list').children.length - pending;
    row('Your plugins', `${kept} kept${pending ? ` · ${pending} to remove` : ''}`);
  }
  row('User preset limit', $('expanded').checked ? '300' : '100', 'cap-count');
  $('selection-summary').replaceChildren(...rows);
}
function countTabs() {                                            // ticked / all on each tab
  for (const tab of document.querySelectorAll('#cat-tabs [role=tab]')) {
    if (tab.id === 'tab-your-plugins') { tab.querySelector('[data-count]').textContent = $('own-list').children.length; continue; }
    const count = categoryCounts($(tab.getAttribute('aria-controls')));
    tab.querySelector('[data-count]').textContent = `${count.selected}/${count.total}`;
  }
}
try {
  const response = await fetch('release.json', {cache:'no-cache'});
  if (!response.ok) throw Error('The patch release is unavailable. Run the release builder, then serve its output directory.');
  release = await response.json();
  document.querySelectorAll('[data-release-label]').forEach(el => el.textContent = release.release.product?.label || 'Firmware workshop');
  document.title = `${release.release.product?.label || 'OP–1'} / Firmware workshop`;
  busy = true; renderCatalog();
  document.querySelectorAll('#catalog input[type=checkbox], #own-files, #own-send, #own-check').forEach(el => el.disabled = true);
  $('device-card').hidden = !pushEnabled() || !release.catalog.base.startsWith('kennel');
  $('own').hidden = $('device-card').hidden;   // the plugin loader is kennel's
  // kennel bases always have room for 300 presets (100 would stop an OP-1 holding more at startup): no choice
  if (kennel()) {
    $('expanded').checked = true; document.querySelector('fieldset.capacity').hidden = true;
    document.querySelectorAll('.after > span').forEach(el => { el.textContent = el.textContent.replace(/^0(\d)/, (_, d) => '0' + (d - 1)); });
  }
  let restored = false;
  try {
    let saved = loadSelection(release.catalog.base);
    if (!saved) {
      // Migrate the former manual-only snapshot once, before the initial update overwrites it.
      const legacy = JSON.parse(localStorage.getItem('hundekraft-build') || 'null');
      if (legacy?.base === release.catalog.base && ['synths', 'effects', 'utilities', 'plugins', 'hidden'].every(g => Array.isArray(legacy[g]))) {
        saved = {cap: kennel() ? 300 : 100, inputs: {}};
        for (const i of document.querySelectorAll('#catalog input[type=checkbox]')) {
          if (i.dataset.core) { saved.inputs[inputKey(i)] = false; } else if (i.dataset.plugin) {
            if (legacy.plugins.includes(i.dataset.plugin)) saved.inputs[inputKey(i)] = true;
            else if (legacy.hidden.includes(i.dataset.plugin)) saved.inputs[inputKey(i)] = false;
          } else saved.inputs[inputKey(i)] = legacy[i.dataset.group].includes(i.value);
        }
      }
    }
    if (saved) {
      for (const i of document.querySelectorAll('#catalog input[type=checkbox]')) {
        const key = inputKey(i);
        if (Object.hasOwn(saved.inputs, key)) i.checked = saved.inputs[key] === true;

      }
      $('expanded').checked = kennel() || saved.cap === 300; restored = true;
    }
    selectionStorageReady = true;
  } catch (e) { storageError = 'Could not restore selections; existing data was preserved: ' + e.message; }
  try {
    ownState = await loadPlugins(release.catalog.base);
    if (ownState.schema !== 1 || !Array.isArray(ownState.files) || !Array.isArray(ownState.removals) || !ownState.reviews || Array.isArray(ownState.reviews) || typeof ownState.reviews !== 'object' || !ownState.toggles || Array.isArray(ownState.toggles) || typeof ownState.toggles !== 'object') throw Error('Unsupported own-plugin storage format');
    const v = ownState.verification;
    if (v && (!Array.isArray(v.files) || !v.files.every(f => pluginPath(f.path) && Number.isInteger(f.crc) && typeof f.on === 'boolean') ||
      !Array.isArray(v.deletes) || !v.deletes.every(pluginPath) || !Array.isArray(v.removals) || !v.removals.every(n => typeof n === 'string') ||
      !Array.isArray(v.off) || !v.off.every(n => typeof n === 'string') ||
      v.builtins && (!Array.isArray(v.builtins) || !v.builtins.every(e => typeof e.name === 'string' && typeof e.on === 'boolean')))) throw Error('Invalid saved device confirmation; existing data was preserved');
    if (v && (v.phase != null && !['sending', 'installing'].includes(v.phase) || v.notBefore != null && (!Number.isFinite(v.notBefore) || v.notBefore < 0))) throw Error('Invalid pending update phase');
    installingUntil = v?.notBefore || 0;
    const restoreFile = ([p, raw, name]) => {
      const bytes = new Uint8Array(raw), checked = checkPlugin(name, bytes);
      if (checked.path !== p) throw Error('Saved plugin identity changed: ' + name);
      return [p, bytes, name];
    };
    ownFiles = ownState.files.map(restoreFile);
    for (const r of ownState.removals) {
      if (!/^[a-z0-9_-]{1,15}$/.test(r.name) && !(r.name === '' && /^plugins\/[a-z0-9_-]{1,15}\.(knl|op1p)$/.test(r.path || ''))) throw Error('Invalid saved removal identity');
      if (r.file) r.file = restoreFile(r.file);
    }
    pluginStorageReady = true;
  } catch (e) { ownState = newPluginState(); ownFiles = []; storageError = 'Could not restore own plugins: ' + e.message; }
  selectionsReady = true; busy = false; showOwn();
  update(); setControls();
  if (storageError) ownStatus(storageError, true);
  status((restored ? 'Saved selections restored. ' : '') + 'Choose your original R246 firmware to build, or press Update OP–1.');
} catch (error) { release = null; $('download-option').open = true; status(error.message, true); }
