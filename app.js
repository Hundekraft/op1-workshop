import {sameCore, matchesUpdate, updateDifferences, updateNotApplied} from './update-state.js?v=3.3.1-opmodown-20261118';
import {saveSelection, loadSelection, loadPlugins, savePlugins, reviewSignature, newPluginState, retiredFiles, migrateRetired} from './plugin-state.js?v=3.3.1-retired-20261118';
import {push, openWebMidi, readInventory, readCoreFile, planPlugins, planFullUpdate, assertResolvedPlan, pluginInfo, knlHeader, pluginPath, ldrRangeCrc, PLUGIN_MAX, sizeText, session, ABORT, OK, leftovers, opusPath} from './op1push.js?v=3.3.1-opmodown-20261118';
import {connectionProblem, connectedText, newCoreText, recentlySent, MIDI_ASK, START_CLEAN, leftoverText} from './connect-result.js?v=3.2-leftovers-20261104';   // one message per connection result
import {coreRoute, runningRelease} from './core-route.js?v=3.1-core-patch-20261102';      // which release the OP-1 runs; core patches
import {initStartClean} from './backup.js?v=3.2-clean-20261104';                         // Start clean: steps and the disk-mode backup
import {showPlan, claimText} from './plugin-plan.js?v=3.3.1-planrow-20261118';                       // kennel OP-1, same core: single plugin files
import {resolveConflicts} from './conflicts.js';
import {showInventory} from './inventory-debug.js?v=3.3.1-opmodown-20261118';           // ?push only: what a kennel OP-1 has installed
import {CATEGORIES, TYPES, MAKER_PILLS} from './categories.js?v=3.3.1-cats8-20261118';                  // the front page: what's in a build, by category
import {SUPPORT} from './creators.js?v=3.3.1-support3-20261118';                                // creators' own support links: a cup after their name
import {initPresets} from './presets.js?v=3.3.1-opmodown-20261118';                 // presets on the OP-1 (list, add, replace, delete; no restart)
import {initDxBanks} from './dx-banks.js?v=3.3.1-opmodown-20261118';               // DX voice banks (.syx) to user/dx/ (applied at the restart)
import {checkOwnFile, opusRecords, opusArena, cpuPercent, OPUS_STATE} from './opus.js?v=3.3.1-opmodown-20261118';   // Opus plugin files (.opmod) in Your plugins, to opus/ (the plugin bridge)
const $ = id => document.getElementById(id);
let release, file, worker, busy = false, urls = [], fileCheck = 0, pushFiles = [], pushBuild = '', pushResume = {}, installingUntil = 0, pushCap = 300;
let ownState = newPluginState(), selectionsReady = false, pluginStorageReady = false, selectionStorageReady = false, storageBlocked = false, storageError = '';
let coreState = null;                                            // {installed, route, disk} of the connected OP-1 (coreCheck)
let autoReview = false;                                          // Choose op1_246.op1 from the device card: review once it's verified
let observedOwn = [];                                            // your own plugins the connected OP-1 reports (inventory records)
let observedOpus = [];                                           // the Opus plugin files (opus/) the connected OP-1 reports (foreign records)
let ownFiles = [];                                              // your own plugin files: [[plugins/ or opus/ path, bytes, file name]]
const ownPath = p => !!p && (p.startsWith('plugins/') || opusPath(p));   // a file Your plugins adds and removes
let stopConnectionWatch = null, deviceInventory = null, firmwareWait = null, stopVerification = false, verificationController = null, retryAction = 'connect';
let reviewBlocked = false;                                    // no MIDI / no OP-1 / not hundekraft 3: Review changes hidden
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
  if (!name && !ownPath(path)) throw Error('This plugin has no removable identity');
  const file = ownFiles.find(([p, d]) => pluginInfo(p, d).name === name);
  const unsent = file && deviceInventory && !deviceInventory.records.some(r => ownPath(r.path) && removalMatches({name, path: path || file[0]}, r));
  if (!unsent && !ownState.removals.some(r => removalId(r) === (name || path))) ownState.removals.push({name, path: path || file?.[0] || null, file: file || null});
  ownFiles = ownFiles.filter(([p, d]) => pluginInfo(p, d).name !== name);
  delete ownState.toggles[name];
  ownState.reviews = {}; ownState.verification = null;
  await rememberOwn(); showOwn();
  ownStatus(storageError || (unsent ? 'Unsent plugin removed from your selection.' : 'Removal saved. Press Review changes to check it before anything is sent. Undo cancels it.'), !!storageError);
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
  observedOpus = opusRecords(inv).filter(r => opusPath(r.path));
  return true;
}
// Send to OP-1 (SysEx update, docs/sysex-update.md): only for releases whose builds have it, or ?push for testing.
const pushEnabled = () => !!release?.devupd || new URLSearchParams(location.search).has('push');
// Exact original R246 bytes; the worker and Python runtime independently check again.
const ORIGINAL_R246_SHA256 = 'c5315218f825f143b415ca554516541898abee843d3a236df0b54c04e1fb13a9';
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const hiddenPlugins = () => (release.catalog.op1r_plugins || []).filter(f => pluginLeftOut(f, document.querySelector(`input[data-plugin="${f.id}"]`))).map(f => f.id);
const targetMetadata = () => Object.fromEntries((release?.plugin_metadata?.plugins || []).map(p => [p.name, p]));
const targetBuiltins = () => release?.plugin_metadata?.builtins || [];
const targetCore = () => {
  const core = release?.variants[configId(variantChoices(choices()), false)]?.core;
  return core || release?.core;
};
const kennel = () => release.catalog.base.startsWith('kennel');
// Maiko's tools: single plugin files on kennel bases; on 2.x bases one #249 image, so all or none
const utilities = () => kennel() ? selected('utilities') : selected('utilities').length ? release.catalog.utilities.map(f => f.id) : [];
const choices = () => ({ schema: 1, base: release.catalog.base, synths: selected('synths'), effects: selected('effects'), utilities: utilities(), preset_cap: Math.max(...release.catalog.preset_caps), ...(hiddenPlugins().length ? {hidden: hiddenPlugins()} : {}) });
const selected = group => [...document.querySelectorAll(`#catalog input[type=checkbox][data-group="${group}"]:checked`)].map(input => input.value);
const baseLabel = () => release.catalog.base.replace(/^op1r(\d+).*$/, 'op1r $1');
// Same bits as runtime.config_id; op1r plugins hidden from the lists sit at a fixed position (op1r_plugins_bit).
function configId(c, withHidden = true) {
  const flags = [...release.catalog.synths.map(f => c.synths.includes(f.id)), ...release.catalog.effects.map(f => c.effects.includes(f.id)), c.preset_cap === 300 || c.preset_cap === 1024, ...release.catalog.utilities.map(f => c.utilities.includes(f.id))];
  let id = flags.reduce((sum, flag, i) => sum + (flag ? 1n << BigInt(i) : 0n), 0n);
  if (withHidden) (release.catalog.op1r_plugins || []).forEach((f, i) => { if (c.hidden?.includes(f.id)) id += 1n << BigInt(release.catalog.op1r_plugins_bit + i); });
  // bit 64 is reserved (was the Lander core option, removed 2026-11-15)
  if (c.preset_cap === 1024) id |= 1n << 65n;   // 1,024 presets (3.3): its own bit; bit 6 alone keeps meaning 300
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
// An op1r_plugins entry is left out when its box is unticked. Opt-in entries (catalog "default": false) start
// unticked, and without a card (no box) they stay out; other entries without a box stay in.
function pluginLeftOut(f, input) { return input ? !input.checked : f.default === false; }
function validateChoices(c) {
  // No preset-limit choice on kennel bases: saved choices from before (100 or 300) load as the one limit.
  if (c && typeof c === 'object' && !Array.isArray(c) && kennel() && [100, 300].includes(c.preset_cap) && release.catalog.preset_caps.includes(1024)) c = {...c, preset_cap: 1024};
  const keys = ['base', 'effects', 'preset_cap', 'schema', 'synths'];
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).filter(k => !['utilities', 'hidden', 'lander'].includes(k)).sort().join() !== keys.join() ||
      c.schema !== 1 || c.base !== release.catalog.base || !release.catalog.preset_caps.includes(c.preset_cap)) throw Error('These choices do not match this firmware base or preset capacity.');
  // Saved choices from before 2026-11-15 may carry `lander`: the option is gone, so it is dropped and bit 64 stays reserved.
  if (Object.hasOwn(c, 'lander')) { if (typeof c.lander !== 'boolean') throw Error('Unsupported choices.'); c = {...c}; delete c.lander; }
  const out = {...c, utilities: Object.hasOwn(c, 'utilities') ? c.utilities : [], hidden: Object.hasOwn(c, 'hidden') ? c.hidden : []};
  // A retired plugin left out in saved choices (3.3's ports) leaves out the bundled file that replaced it (runtime.normalize).
  const gone = new Map((release.catalog.op1r_plugins || []).filter(f => f.reserved && (f.replaced_by || f.retired)).map(f => [f.id, f.replaced_by || null]));
  // (one retired with nothing replacing it, KASTLE since 3.4, just drops out)
  if (Array.isArray(out.hidden) && out.hidden.some(id => gone.has(id))) out.hidden = [...new Set(out.hidden.filter(id => !(gone.has(id) && !gone.get(id))).map(id => gone.get(id) || id))];
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
  const without = [...new Set([...['synths', 'effects', 'utilities'].flatMap(group => release.catalog[group].filter(f => !c[group].includes(f.id)).map(f => f.id)), ...(c.hidden || [])])].sort();
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
  // R246's drawing heap (runtime.screen_memory): the chosen files' screens, the preset cap and the user's own files
  const screens = screenMemory(c, ownScreens());
  const screenText = screens.over ? 'That’s a bit more than the OP–1 has room for. Untick a plugin or two and it will fit.' : '';
  // the updater takes 15,000,000 bytes at most (runtime.MAX_PACKAGE): estimated here, before the build refuses it
  const pkg = packageEstimate(c);
  // the package limit belongs to the firmware file only (te-boot's upload disk): it never blocks or shows under the USB update
  if (screenText) box.insertAdjacentHTML('beforeend', `<p class="screen-over" role="alert">${escapeText(screenText)}</p>`);
  if ($('screen-note')) { $('screen-note').textContent = screenText; $('screen-note').hidden = !screenText; }
  showPackage(pkg);
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
  const arena = pluginArena(c, ownArena());
  showArena(arena);
  return {...plan, ...(screens.over || arena?.over ? {blocked: true} : {}), ...(pkg?.over ? {packageOver: true} : {})};
}
// The updater package for this selection (runtime.package_estimate; release.json 'package' and each file's plugin_metadata
// 'packed'): base + ratio x the chosen files' packed sizes. over: bytes past the 15,000,000-byte limit; biggest: the
// chosen files by packed size, [name, bytes]. Files as runtime.files ships them; your own files are sent separately.
function packageEstimate(c) {
  const t = release?.package;
  if (!t) return null;
  const meta = new Map((release.plugin_metadata?.plugins || []).map(p => [p.path, p]));
  const chosen = new Map();
  for (const g of ['synths', 'effects', 'utilities', 'op1r_plugins']) for (const f of release.catalog[g] || []) {
    if (!(f.always || (g === 'op1r_plugins' ? !c.hidden?.includes(f.id) : c[g].includes(f.id)))) continue;
    for (const n of [f.file, ...(f.files || [])]) if (n && !chosen.has(n)) chosen.set(n, [f.name || f.id, meta.get('content/' + n)?.packed || 0]);
  }
  const need = t.base + Math.round(t.ratio * [...chosen.values()].reduce((n, [, b]) => n + b, 0));
  const byName = new Map();
  for (const [name, bytes] of chosen.values()) byName.set(name, (byName.get(name) || 0) + bytes);
  return {need, limit: t.limit, percent: Math.round(1000 * need / t.limit) / 10, over: Math.max(0, need - t.limit + 1), biggest: [...byName].sort((x, y) => y[1] - x[1]).slice(0, 3)};
}
function packageText(p) {
  const kb = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1000)} KB`;
  return `Too big for the firmware file. Untick something big to build the file: ${p.biggest.map(([n, b]) => `${n} ${kb(b)}`).join(', ')}. The USB update isn’t affected.`;
}
const PACKAGE_NEAR = 300000;                                    // orange within this many bytes of the limit, red over it
let lastPackage = null;
// shown only while the file path ("Use a firmware file instead") is open: the limit means nothing to a USB update
function showPackage(p) {
  const box = $('pkg');
  if (!box) return;
  lastPackage = p;
  box.hidden = !p || !$('download-option')?.open;
  if (box.hidden) return;
  const mb = b => (b / 1e6).toFixed(1);
  const level = p.over ? 'red' : p.need > p.limit - PACKAGE_NEAR ? 'orange' : 'green';
  box.dataset.level = level;
  $('pkg-pct').textContent = `${mb(p.need)} / ${mb(p.limit)} MB`;
  $('pkg-fill').style.width = `${Math.min(100, p.need * 100 / p.limit)}%`;
  $('pkg-note').textContent = level === 'red' ? packageText(p) : level === 'orange' ? 'Close to the limit, but the file still fits.' : '';
  $('pkg-note').hidden = level === 'green';
}
// kennel's plugin arena for this selection (runtime.arena_need; release.json plugin_arena and each file's
// plugin_metadata 'arena'): the core's terms, per_file for each file, each file's need, the static-art cache when a
// file uses it, rounded up to the arena's step. Files as runtime.files ships them, plus own = [[need, artCache]]
function pluginArena(c, own = []) {
  const t = release?.plugin_arena;
  if (!t) return null;
  const meta = new Map((release.plugin_metadata?.plugins || []).map(p => [p.path, p]));
  const names = new Set();
  for (const g of ['synths', 'effects', 'utilities', 'op1r_plugins']) for (const f of release.catalog[g] || []) {
    if (!(f.always || (g === 'op1r_plugins' ? !c.hidden?.includes(f.id) : c[g].includes(f.id)))) continue;
    for (const n of [f.file, ...(f.files || [])]) if (n) names.add(n);
  }
  // the plugin bridge's .opmod files: their own term (kn_foreign_need, no per_file), bundled ones and the opus/ files in Your plugins
  const foreign = [...names].filter(n => n.endsWith('.opmod')).reduce((s, n) => s + (meta.get('content/' + n)?.foreignArena || 0), 0) +
    opusArena(ownFiles, observedOpus, ownState.removals.map(r => r.path).filter(Boolean));
  const files = [...names].filter(n => !n.endsWith('.opmod')).map(n => [meta.get('content/' + n)?.arena || 0, !!meta.get('content/' + n)?.artCache]).concat(own);
  const total = t.fixed + t.per_file * files.length + files.reduce((n, [a]) => n + a, 0) + foreign + (files.some(([, cache]) => cache) ? t.art_cache : 0);
  const need = Math.ceil(total / t.align) * t.align;
  return {need, percent: Math.round(1000 * need / t.max) / 10, over: Math.max(0, need - t.max)};
}
// A plugin the OP-1 reports still takes memory after the next update unless it is off there (now, or stored for the
// next boot: kennel.off) or this page will remove it (a pending removal goes with the same update)
const stillOn = r => !/off|removed/.test(r.state || '') && !(r.name && deviceInventory?.off?.includes(r.name)) &&
  !ownState.removals.some(x => removalMatches(x, r));
// your own files' arena needs (kn_load.c kn_peek: load size + call stubs + alignment pad; an .op1p's image + bss + 3),
// and the ones the connected OP-1 reports that aren't listed here (only their size is known)
function ownArena() {
  const listed = new Map(ownFiles.filter(([p]) => !opusPath(p)).map(([p, d]) => [pluginInfo(p, d).name, [p, d]]));
  const out = [];
  for (const [p, d] of listed.values()) {
    try {
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      if (p.endsWith('.op1p')) { const bin = dv.getUint32(d.length - 12, true); out.push([dv.getUint32(bin + 32, true) + dv.getUint32(bin + 36, true) + 3, false]); continue; }
      const {h} = knlHeader(d);
      const load = dv.getUint32(h + 76, true) + dv.getUint32(h + 80, true), align = dv.getUint32(h + 88, true), imports = dv.getUint32(h + 116, true);
      out.push([load + 3 + 12 * imports + align - 1, new TextDecoder().decode(d).includes('_op1_screen_draw_cached')]);
    } catch { out.push([d.length, false]); }
  }
  for (const r of observedOwn) if (!listed.has(r.name) && stillOn(r)) out.push([r.size || 0, false]);
  return out;
}
const ARENA_ORANGE = 92;                                         // the bar's colours: green up to 92 %, orange above, red over 100 %
const ARENA_TEXT = {
  orange: 'Nearly full. It still fits, but there’s not much room left for your own plugin files.',
  red: 'Too much for the OP–1’s plugin memory. The last plugins wouldn’t load. Untick one or two to build.',
};
function showArena(a) {
  const box = $('arena');
  if (!box) return;
  box.hidden = !a;
  if (!a) return;
  const level = a.percent > 100 ? 'red' : a.percent > ARENA_ORANGE ? 'orange' : 'green';
  box.dataset.level = level;
  $('arena-pct').textContent = `${a.percent.toFixed(1)} %`;
  $('arena-fill').style.width = `${Math.min(100, a.percent)}%`;
  $('arena-note').textContent = ARENA_TEXT[level] || '';
  $('arena-note').hidden = level === 'green';
}
// Same sum as runtime.screen_memory: base + chosen files' screen_bytes + preset_cap x per_preset + own files + worst screen
function screenMemory(c, ownBytes = 0) {
  const b = release.catalog.screen_budget;
  if (!b) return {over: 0, heaviest: []};
  const chosen = ['synths', 'effects', 'utilities', 'op1r_plugins'].flatMap(g => (release.catalog[g] || []).filter(f => f.screen_bytes &&
    (f.always || (g === 'op1r_plugins' ? !c.hidden?.includes(f.id) : c[g].includes(f.id)))));
  // lazy_cap (svg-lazy cores): engine, FX and sequencer pages are parsed when in the screen table; resident at most
  // max(cap, S) + S, S the heaviest page of each kind together (runtime.screen_memory says why)
  const kindOf = f => (release.catalog.synths || []).includes(f) ? 'synth' : (release.catalog.effects || []).includes(f) ? 'fx' : f.kind;
  const kinds = ['synth', 'fx', 'seq'];
  const lazy = b.lazy_cap ? chosen.filter(f => kinds.includes(kindOf(f))) : [];
  const heaviest = k => Math.max(0, ...lazy.filter(f => kindOf(f) === k).map(f => f.screen_bytes));
  const lazySum = lazy.reduce((n, f) => n + f.screen_bytes, 0);
  const table = kinds.reduce((n, k) => n + heaviest(k), 0);
  const screens = chosen.reduce((n, f) => n + f.screen_bytes, 0) - lazySum + Math.min(lazySum, Math.max(b.lazy_cap || 0, table) + table);
  const need = b.base + screens + (c.preset_cap || 300) * b.per_preset + ownBytes + b.worst_screen;
  return {over: Math.max(0, need - (b.limit - b.margin)), heaviest: chosen.sort((x, y) => y.screen_bytes - x.screen_bytes).slice(0, 5).map(f => f.name || f.id)};
}
// Your own plugins' screens: files listed here (from the SVG each .knl starts with, as runtime.own_screen_bytes) and
// plugins the connected OP-1 reports that aren't listed (only their size is known: own_size_factor x file size)
function ownScreens() {
  const b = release?.catalog?.screen_budget;
  if (!b) return 0;
  const listed = new Map(ownFiles.filter(([p]) => !opusPath(p)).map(([p, d]) => [pluginInfo(p, d).name, d]));   // .opmod: no screen record
  let n = 0;
  for (const d of listed.values()) { const svg = d[0] === 0x3C ? d.indexOf(0) : 0; n += Math.max(b.own_min, Math.ceil(Math.max(svg, 0) * b.own_svg_factor)); }
  for (const r of observedOwn) if (!listed.has(r.name) && stillOn(r)) n += Math.max(b.own_min, Math.ceil((r.size || 0) * b.own_size_factor));
  return n;
}
// The main-page tick for a workshop plugin file (content/<file>), or null: the review's On / Off follows it
function catalogTick(path) {
  if (!path?.startsWith('content/') || !release) return null;
  const name = path.slice(8);
  for (const group of ['synths', 'effects', 'utilities', 'op1r_plugins']) for (const f of release.catalog[group] || []) {
    if (f.always || ![f.file, ...(f.files || [])].includes(name)) continue;
    return document.querySelector(group === 'op1r_plugins' ? `input[data-plugin="${f.id}"]` : `#catalog input[data-group="${group}"][value="${f.id}"]`);
  }
  return null;
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
  $('build').disabled = busy || devicePending || storageBlocked || !release || !file || (selection.blocked || selection.packageOver || !!selection.conflicts.length);
  for (const id of ['export', 'import']) $(id).disabled = editingLocked() || !release;
  if (release) {
    const c = choices();
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
      $('preset-pack-later').hidden = true; $('preset-pack-make').hidden = exact;
      $('preset-pack-download').href = `variants/${id}/presets.zip`;
      $('preset-pack-download').dataset.sha256 = presets.sha256;
      $('preset-pack-download').download = `${release.release.product?.slug || "op1-hundekraft"}-${id}.presets.zip`;
      $('preset-warning').hidden = count <= c.preset_cap;
      $('preset-warning').textContent = `This pack has ${count} presets, and your OP–1 holds ${c.preset_cap.toLocaleString('en-US')}. Install a subset. Existing user presets also count toward the limit.`;
    } else {
      $('preset-pack-download').hidden = true; $('preset-pack-download').removeAttribute('href'); $('preset-pack-make').hidden = true;
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
  document.querySelectorAll('#own-list button, #leftovers button, #own-check, #own-send, #push-send').forEach(el => el.disabled = busy || devicePending || storageBlocked);
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
  if ((firmwareWait || autoReview) && !$('device-card').hidden)  // chosen from the device card: say it there too
    pushStatus(file ? 'Original R246 verified. Preparing the update…' : $('status').textContent, !file);
  if (firmwareWait && file) { const ready = firmwareWait; firmwareWait = null; ready.resolve(); }
  else if (autoReview && file && !$('device-card').hidden) { autoReview = false; $('device-card').scrollIntoView({block: 'center'}); $('own-send').click(); }
  else if (!file) autoReview = false;
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
$('workshop').addEventListener('change', e => { if (e.target.matches('#catalog input[type=checkbox][data-group], #catalog input[type=checkbox][data-plugin], #catalog input[type=checkbox][data-core]')) { clearDownloads(); updateStage(null); $('push-progress').hidden = true; pushStatus('Selections changed. Press Review changes to see what will be sent.'); update(); status(file ? 'Choices updated. Ready to build.' : 'Choose your original R246 firmware to continue.'); } });
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
  if (selection.packageOver && !forSend) throw Error('The firmware file would be too big. Untick something big to build the file. Nothing has been sent.');
  clearDownloads();
  if (!forSend) $('log').textContent = '';
  status('Starting the local patcher…');
  const active = new Worker('worker.js?v=3.1-core-patch-20261102', {type: 'module'});
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
    const stem = `${snapshot.release.product?.slug || 'op1_246-' + snapshot.catalog.base}`;
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
  $('device-actions').hidden = true; $('device-cancel-pending').hidden = true; $('device-firmware').hidden = true;
  blockReview(false);
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
      deviceInventory = null; observedOwn = []; observedOpus = []; showOwn();
      deviceState('OP–1 disconnected · reconnect USB to continue', 'warn');
      $('own-check').textContent = 'Connect my OP–1';
    }
  });
}
// The published cores (cores.json, tools/firmware/cores.py): what a connected OP-1 runs, and whether a new core can go
// as a patch of its own firmware file (core-route.js). Null for a release without it.
let coresData;
async function loadCores() {
  if (coresData === undefined) coresData = release?.cores_sha256 ? JSON.parse(new TextDecoder().decode(await checkedAsset('cores.json', release.cores_sha256))) : null;
  return coresData;
}
const variantKey = () => configId(variantChoices(validateChoices(choices())), false);
async function coreCheck(port, inv) {
  coreState = null;
  if (!inv?.plugins) return;
  let cores = null;
  try { cores = await loadCores(); } catch { /* without it: the version stays unnamed, a new core needs R246 */ }
  const installed = runningRelease(cores, inv.core)?.label || null;
  let matches = false;
  try { matches = sameCore(targetCore(), inv.core); } catch { /* not a match */ }
  if (matches) { coreState = {installed, route: null, disk: null}; return; }
  pushStatus('Checking the firmware on your OP–1…');
  const disk = inv.patch ? await readCoreFile(port, {log: text => { $('log').textContent += text + '\n'; }}) : null;
  let route = coreRoute(cores, inv, disk, null);
  try { route = coreRoute(cores, inv, disk, variantKey()); } catch { /* selection not valid yet: decided at review */ }
  coreState = {installed, route, disk};
}
// A core update without R246 (worker.js corePatch): the patch and changed base files, or null (reason in the log)
async function corePatchFiles(inv) {
  const active = new Worker('worker.js?v=3.1-core-patch-20261102', {type: 'module'});
  try {
    const data = await new Promise((resolve, reject) => {
      active.onerror = e => reject(Error(e.message || 'The patcher could not start. Try again.'));
      active.onmessage = ({data}) => {
        if (data.type === 'log') { $('log').textContent += data.text + '\n'; pushStatus('Preparing the firmware update: ' + data.text); }
        if (data.type === 'error') reject(Error(data.text));
        if (data.type === 'core') resolve(data);
      };
      active.postMessage({release, coreJob: {variantId: variantKey(), disk: coreState.disk, running: inv.core}});
    });
    if (!data.files.length) {
      $('log').textContent += `core patch not possible (${data.reason}): needs op1_246.op1\n`;
      coreState = {...coreState, route: {route: 'original', reason: data.reason}};   // the page says why (requestFirmware)
      return null;
    }
    return data.files;
  } finally { active.terminate(); }
}
// What the connected OP-1 runs (connect-result.js): the release's label only when its core is this release's.
function connected(inv) {
  let coreMatches = false;
  try { coreMatches = !!inv?.core && sameCore(targetCore(), inv.core); } catch { /* core information missing: not a match */ }
  return connectedText(inv, {label: release?.release.product?.label || 'hundekraft 3', coreMatches, haveFile: !!file,
                             installed: coreState?.installed || null, patch: coreState?.route?.route === 'patch',
                           reason: coreState?.route?.reason || null});
}
// The device line: text plus a tone for its look (ok / warn / wait / error; none = not connected yet)
function deviceState(text, tone) {
  $('device-state').textContent = text;
  if (tone) $('device-state').dataset.tone = tone; else delete $('device-state').dataset.tone;
}
function connectionState(inv) {
  deviceInventory = inv;
  const c = connected(inv);
  deviceState(c.state, c.newCore ? 'warn' : 'ok');
  startClean(!!c.startClean);
  $('own-check').textContent = 'Check again';
}
// The manual's Start clean under the device line: an OP-1 on another firmware or a hundekraft before 3.0
function startClean(on) { $('device-clean-text').textContent = START_CLEAN; $('device-clean').hidden = !on; }
// Buttons under a device message. retry: Try again's label; file: the label of the button that opens the firmware
// file panel; firmware: Choose op1_246.op1 (a new core needs the original R246).
// primary: retry/file are the main actions (dark), with Review changes hidden (blockReview)
function deviceButtons({retry = null, file = null, firmware = false, primary = false} = {}) {
  $('device-actions').hidden = false;
  for (const id of ['device-retry', 'device-download']) $(id).classList.toggle('primary', primary);
  $('device-retry').hidden = !retry; if (retry) $('device-retry').textContent = retry;
  $('device-download').hidden = !file; if (file) $('device-download').textContent = file;
  $('device-firmware').hidden = !firmware; $('device-firmware').classList.toggle('primary', firmware);
  originalHint(firmware);
}
// where to get op1_246.op1, under Choose op1_246.op1
function originalHint(on) { $('device-r246').hidden = !on; }
// Review changes and its scope line, hidden while the card says to use a file instead (kept across showOwn)
function blockReview(on) {
  reviewBlocked = on;
  $('own-send').hidden = on; document.querySelector('.device-scope').hidden = on;
}
function recoveryActions(action, label) {
  retryAction = action;
  deviceButtons({retry: label, file: 'Use a firmware file instead'});
}
function deviceError(error, suffix = '', failed = true) {
  // No MIDI, no OP-1, or an OP-1 that doesn't answer the update: one message each (connect-result.js)
  // restarting only within the install window after a send, not for as long as the update stays unverified
  const problem = failed && connectionProblem(error, {pending: recentlySent(installingUntil)});
  if (problem) {
    pushStatus(problem.text, true);
    deviceState(problem.state, problem.kind === 'restarting' ? 'wait' : 'error'); $('own-check').textContent = 'Connect my OP–1';
    startClean(problem.kind === 'not-hundekraft');
    $('push-hint').textContent = problem.hint; $('push-hint').hidden = !problem.hint;
    deviceButtons({retry: problem.retry ? 'Try again' : null, file: problem.file, primary: !problem.review});
    blockReview(!problem.review);
    return;
  }
  pushStatus(String(error.message || error) + suffix, failed);
  $('push-hint').textContent = error.hint || '';
  $('push-hint').hidden = !error.hint;
  if (failed) recoveryActions(retryAction, retryAction === 'verify' ? 'Retry verification' : retryAction === 'update' ? 'Resume update' : 'Try again');
}
function unresolvedUpdate(inv = null) {
  if (!pendingUpdate()) return;
  if (Date.now() >= installingUntil && updateNotApplied(inv, ownState.verification)) {
    recoveryActions('update', 'Send again');
    $('device-cancel-pending').hidden = false;
    pushStatus('The OP–1 did not apply the update. Its plugin files are exactly as they were before you sent it: if one step fails, the OP–1 undoes the whole update. Press Send again to retry. If it happens again, watch the OP–1 screen after pressing T1 and tell us what it says.');
    return;
  }
  recoveryActions('verify', 'Retry verification');
  $('device-cancel-pending').hidden = Date.now() < installingUntil;
  pushStatus(Date.now() < installingUntil
    ? 'Installation is still awaiting verification. Wait for the tape screen, then press Check again. Plugin edits and Undo wait until the result is known.'
    : 'The previous update is not verified. Retry verification, resume the update, or cancel its pending files before using Remove / Undo.');
  if (inv) pushStatus($('push-status').textContent + ' ' + updateDifferences(inv, ownState.verification).slice(0, 3).join('; ') + '.');
}
async function openDevice() {
  const controller = new AbortController(), button = document.createElement('button');
  button.type = 'button'; button.className = 'connection-cancel'; button.textContent = 'Cancel connection';
  button.onclick = () => controller.abort(); $('device-feedback').append(button);
  let ask = true;                                              // say why the browser asks, unless MIDI is already allowed
  try { ask = (await navigator.permissions?.query({name: 'midi', sysex: true}))?.state !== 'granted'; } catch { /* unknown: say it */ }
  pushStatus(ask ? MIDI_ASK : 'Looking for your OP–1…');
  try { return await openWebMidi(navigator, new URLSearchParams(location.search).has('debug'), {signal: controller.signal}); }
  finally { button.remove(); }
}
function requestFirmware() {
  if (file) return Promise.resolve();
  const text = newCoreText(coreState?.installed, release?.release.product?.label || 'hundekraft 3', coreState?.route?.reason);
  $('firmware-reason').textContent = text + ' Preparation continues as soon as you choose it.';
  pushStatus(text);
  deviceButtons({firmware: true}); originalHint(true);
  $('firmware').disabled = false;                                 // (the file panel stays closed: this is the USB path)
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel update';
  $('device-feedback').append(cancel);
  return new Promise((resolve, reject) => {
    firmwareWait = {resolve: () => { cancel.remove(); $('device-firmware').hidden = true; $('device-actions').hidden = true; $('firmware').disabled = true; resolve(); }};
    cancel.onclick = () => { fileCheck++; firmwareWait = null; cancel.remove(); $('device-firmware').hidden = true; $('firmware').disabled = true; reject(Error('Cancelled before transfer. Your selections are saved.')); };
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
        observeConnection(port); connectionState(inv); await rememberOwn(); showOwn(inv);
        updateStage('verified'); $('push-label').textContent = 'UPDATE VERIFIED'; $('push-eta').textContent = 'installed';
        pushStatus('Update installed and verified. Your OP–1 is ready.' + (ownFiles.some(([path]) => !inv.records.some(r => r.path === path)) ? ' Your saved uploads still need installing: press Review changes again to check them.' : ''));
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
  opts = {...opts, retired: retiredFiles(release.catalog)};       // the retired ports: removed whatever is ticked
  let winners = {}, asked = false, unknownAccepted = false, acceptedSignature = null;
  for (;;) {
    rememberSelection();
    if (storageBlocked) throw Error(storageError);
    const manageOwn = opts.includeOwn !== false;
    const drop = manageOwn ? inv.records.filter(r => ownPath(r.path) && ownState.removals.some(x => removalMatches(x, r))).map(r => r.path) : [];
    // Refresh desired files after every Remove/Undo, keeping workshop selections independent.
    // Opus plugin files only go to an OP-1 that takes them (HELLO bit 128, inv.foreign); push() refuses them otherwise
    const own = manageOwn ? ownFiles.filter(([p]) => inv.foreign || !opusPath(p)).map(([p, d]) => [p, d]) : [];
    const desired = wanted;
    const preliminary = planner(inv, desired, {...opts, own, drop});
    const forceOn = [], forceOff = [];
    for (const e of preliminary.entries) {                        // workshop plugins: the main page decides
      const tick = catalogTick(e.path);
      if (tick) (tick.checked ? forceOn : forceOff).push(e.name);
    }
    let plan = planner(inv, desired, {...opts, own, drop, forceOn, forceOff});
    const signature = reviewSignature(inv, plan.entries);
    const saved = ownState.reviews[signature] || {};
    if (acceptedSignature !== signature) { winners = saved.winners || {}; unknownAccepted = !!saved.unknownAccepted; asked = false; }
    plan = planner(inv, desired, {...opts, own, drop, forceOn, forceOff, winners});
    const needsReview = full || plan.changed || !plan.resolved || (plan.unknown.length && !unknownAccepted);
    if (needsReview && (!asked || !plan.resolved || (plan.unknown.length && !unknownAccepted))) {
      pushStatus(full ? 'This update includes new OP–1 firmware. Review it and the plugin changes. Nothing has been sent.' : 'Review installs, replacements and removals. Nothing has been sent.');
      const r = await showPlan(box, plan, {ask: true, pending: manageOwn ? ownState.removals : [], saved, full, deferredOwn: opts.deferredOwn || []});
      if (r.remove) { const e = plan.entries.find(e => e.path === r.remove); await removeOwn(e.name, e.path); acceptedSignature = null; continue; }
      if (r.undo) { await undoRemoval(r.undo); acceptedSignature = null; continue; }
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
    await showPlan(box, plan, {ask: false, full, deferredOwn: opts.deferredOwn || []});
    return {...plan, reviewedInventory: current, managesOwn: manageOwn};
  }
}
// The send's memory checks (screens, plugin arena): the reason it can't go, or ''. Run again after the inventory read,
// since what the OP-1 reports (and which of it is off or being removed) is only known then.
function memoryOver() {
  if (screenMemory(choices(), ownScreens()).over) return 'That’s a bit more than the OP–1 has room for. Untick a plugin or two and it will fit. Nothing has been sent.';
  if (pluginArena(choices(), ownArena())?.over) return 'Too much for the OP–1’s plugin memory: the last plugins wouldn’t load. Untick one or two first. Nothing has been sent.';
  return '';
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
  if (memoryOver()) { ownStatus(memoryOver(), true); return; }
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
    observeConnection(port); connectionState(inv);
    const recheck = () => readInventory(port, {log});
    showInventory(inv);
    const over = memoryOver();                                  // again, with what this OP-1 really has
    if (over) { ownStatus(over, true); pushStatus(over, true); updateStage(null); return; }
    if (ownOnly) {
      const target = targetCore();
      const coreMatches = sameCore(target, inv?.core);
      if (!coreMatches) {
        let patched = null;
        if (!file) {
          await coreCheck(port, inv);
          if (coreState?.route?.route === 'patch') {
            pushStatus('Preparing the firmware update locally before review…');
            patched = await corePatchFiles(inv);
          }
        }
        if (patched) {
          files = [...patched, ...await workshopFiles()];
          pushCap = validateChoices(choices()).preset_cap; pushResume = {};
        } else {
          pushStatus('A full firmware update is needed. Preparing it locally before review…');
          await requestFirmware();
          await buildFirmware(true);
          files = pushFiles;
        }
        ownOnly = false;
      } else {
        pushStatus('Preparing your selected plugin updates…');
        files = await workshopFiles();
      }
    }
    const ldr = files.find(([p]) => p === 'OP1_vdk.ldr')?.[1];
    // R246 stops at startup when it holds more user synth presets than the firmware's limit
    if (!ownOnly && inv?.presets && inv.presets.count > pushCap)
      throw Error(`Your OP–1 holds ${inv.presets.count} user synth presets, more than this build's limit of ${pushCap}. It would stop at startup. Delete some presets first, or start clean.`);
    if (ownOnly) {
      if (!inv?.plugins) throw Error('Your own plugins need hundekraft 3.0 on the OP–1. Build and send 3.0 first, then add them.');
      if (!inv.foreign && ownFiles.some(([p]) => opusPath(p))) throw Error('This OP–1 can’t take Opus plugin files yet. Update it to the newest hundekraft first, or remove the .opmod files from Your plugins.');
      const plan = await settlePlan(inv, files, {own, metadata: targetMetadata(), recheck});
      if (!plan.changed) {
        const reviewed = plan.reviewedInventory;
        ownState.removals = ownState.removals.filter(r => reviewed.records.some(e => ownPath(e.path) && removalMatches(r, e)));
        if (ownState.verification) confirmInventory(reviewed);
        await rememberOwn(); showOwn(reviewed);
        if (!ownState.verification) updateStage('verified');
        pushStatus(ownState.verification ? 'Files match, but previous changes still await device confirmation. Press Check again after the restart to verify.' : 'Your OP–1 is up to date. No changes to send.'); return;
      }
      expectedPlan = plan;
      log(`selected plugin changes: ${plan.send.length} files to send, ${plan.deletes.length} to remove`);
      files = plan.send; pluginsOnly = true;
      extra = {deletes: plan.deletes, off: plan.offChanged ? plan.off : undefined};
    } else if (kennel()) {
      if (!release.plugin_metadata?.complete) throw Error('Cannot check this firmware’s built-in controls: release information is missing. Use a release with plugin metadata.');
      log('sending the whole firmware; checking its target controls and the plugins you keep');
      const plan = await settlePlan(inv || {records: [], off: []}, files.filter(([p]) => pluginPath(p)),
        {own, metadata: targetMetadata(), builtins: targetBuiltins(), recheck, includeOwn: !!inv?.plugins, deferredOwn: ownFiles.filter(([p]) => !inv?.plugins || (!inv.foreign && opusPath(p))).map(([p,d]) => pluginInfo(p,d).name)}, true);
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
      const was = new Map((reviewed?.records || []).filter(r => r.path).map(r => [r.path, r.crc]));
      const sent = new Set(expectedPlan.send.map(([p]) => p));          // what the update changes, as it was before
      const before = [...expectedPlan.entries.filter(e => sent.has(e.path) && was.get(e.path) !== e.crc).map(e => e.path),
                      ...expectedPlan.deletes.filter(p => was.has(p))].map(p => ({path: p, crc: was.has(p) ? was.get(p) : null}));
      ownState.verification = {phase: 'sending', notBefore: 0, core: core?.crc != null ? core : null, before,
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
    deviceError(error, !cancelled && extra.off !== undefined ? ' On/off choices may already be saved on the OP–1 even if file installation failed or was cancelled. Press Check again after the restart to verify.' : '', !cancelled);
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
    await coreCheck(port, inv);
    observeConnection(port); connectionState(inv);
    const found = connected(inv);
    // An earlier core (or none with plugin files): Review changes sends the whole firmware, built from R246
    if (!inv?.plugins) { pushStatus(found.text); if (found.needOriginal) deviceButtons({firmware: true}); return; }
    const confirmed = confirmInventory(inv);
    await rememberOwn(); showOwn(inv);
    dxBanks.connected(inv);                                        // the DX banks inside the Presets section, when the OP-1 takes them and has DX
    if (inv.presetsLive) await presets.connected(port);           // the Presets section, when the OP-1 takes them live
    if (confirmed) updateStage('verified');
    if (pendingUpdate()) { unresolvedUpdate(inv); return; }
    pushStatus(confirmed ? 'Update installed and verified. Your OP–1 is ready.' : ownState.verification ? 'Changes are not yet confirmed. If you cancelled on the OP–1, review and send again.' : found.text);
    if (!confirmed && !ownState.verification && found.needOriginal) deviceButtons({firmware: true});
  } catch (e) { deviceError(e, '', !/^Cancelled/.test(e.message || '')); }
  finally { port?.close(); lock(false); showOwn(); }
}, true));
$('device-cancel-pending').onclick = () => withDevice(async () => {
  let port; lock(true);
  try {
    port = await openDevice();
    const inv = await readInventory(port);
    if (!inv?.plugins) throw Error('Reconnect an OP–1 running 3.0 to check the pending update.');
    connectionState(inv);
    if (confirmInventory(inv)) { await rememberOwn(); showOwn(inv); updateStage('verified'); pushStatus('Update installed and verified. Your OP–1 is ready.'); return; }
    if (Date.now() < installingUntil) { unresolvedUpdate(); return; }
    await rememberOwn();
    const reply = await session(port).ask(ABORT);
    if (reply[2] !== OK) throw Error('The OP–1 did not cancel its pending files. Press Check again before trying again.');
    ownState.verification = null; installingUntil = 0; pushResume = {};
    await rememberOwn(); showOwn(inv); updateStage(null); $('push-plan')?.setAttribute('hidden', '');
    $('device-actions').hidden = true;
    pushStatus('Pending files cancelled on the OP–1. Plugin on/off choices already saved there are unchanged. Remove / Undo is available again.');
  } catch (error) { deviceError(error); }
  finally { port?.close(); lock(false); showOwn(); }
}, true);
$('device-retry').onclick = () => retryAction === 'update' ? $('own-send').click() : $('own-check').click();
$('download-option').addEventListener('toggle', () => showPackage(lastPackage));
document.querySelectorAll('a[href="#drop-zone"]').forEach(a => a.addEventListener('click', () => { $('download-option').open = true; }));
// Path B: the firmware file panel (also Build firmware file / Use a firmware file instead under device messages)
function openFilePath() {
  $('download-option').open = true;
  $('drop-zone').scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}
$('device-download').onclick = openFilePath;
$('path-build').onclick = openFilePath;
$('device-firmware').onclick = () => {
  if (!firmwareWait) autoReview = true;                          // from Connect: go on to the review once it's verified
  if (!$('firmware').disabled) $('firmware').click();            // the picker only: the file panel is the other path
};
// Path A: the same connect as the device card's own button, which it scrolls to
$('path-connect').onclick = () => {
  $('device-card').scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  $('own-check').focus({preventScroll: true});
  $('own-check').click();
};
initStartClean();
// The preset pack for the current selection (Presets section: send it over USB): the release's static pack when it
// matches the selection (sha256 checked), else the pack filtered in the browser (worker.js presetsOnly)
async function presetPackBytes() {
  if (!release) return null;
  const link = $('preset-pack-download');
  if (!link.hidden && link.hasAttribute('href')) {
    const response = await fetch(link.href, {cache: 'no-cache'});
    if (!response.ok) throw Error('Could not get the preset pack. Check your connection and try again.');
    const bytes = await response.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== link.dataset.sha256) throw Error('The preset release changed. Reload the workshop and try again.');
    return new Uint8Array(bytes);
  }
  if ($('preset-pack-make').hidden) return null;
  const config = validateChoices(choices()), snapshot = release;
  const active = new Worker('worker.js?v=3.1-core-patch-20261102', {type: 'module'});
  try {
    const data = await new Promise((resolve, reject) => {
      active.onerror = e => reject(Error(e.message || 'The patcher could not start. Try again.'));
      active.onmessage = ({data}) => { if (data.type === 'error') reject(Error(data.text)); if (data.type === 'presets') resolve(data); };
      active.postMessage({config, release: snapshot, presetsJob: true});
    });
    if (data.id !== configId(config)) throw Error('The preset pack does not match your selection. Try again.');
    return data.presets;
  } finally { active.terminate(); }
}
const dxLog = text => { $('log').textContent += text + '\n'; };
const dxBanks = initDxBanks({log: dxLog, onChange: () => {}});
const presets = initPresets({withDevice, openDevice, pack: presetPackBytes, dx: dxBanks, log: dxLog});
let releaseTimer = 0;
$('workshop').addEventListener('change', () => { clearTimeout(releaseTimer); releaseTimer = setTimeout(() => presets.releaseChanged(), 600); });   // the plugin list changed: the release card follows
const stopButton = document.createElement('button'); stopButton.id = 'verification-stop'; stopButton.type = 'button'; stopButton.textContent = 'Check later'; stopButton.hidden = true;
stopButton.onclick = () => { stopVerification = true; verificationController?.abort(); stopButton.disabled = true; };
$('device-feedback').append(stopButton);
// Your own plugin files: checked as the OP-1's loader would, kept across rebuilds, one per name
const ownStatus = (text, error = false) => { $('own-status').textContent = text; $('own-status').classList.toggle('error', error); };
function showOwn(inv) {
  if (inv) { deviceInventory = inv; observedOwn = inv.records.filter(r => r.path?.startsWith('plugins/')); observedOpus = opusRecords(inv).filter(r => opusPath(r.path)); }
  const rows = new Map(observedOwn.map(r => [r.name || r.path, {name: r.name, path: r.path, label: `Your plugin · Installed${r.state === 'loaded' ? '' : ' · ' + r.state}`}]));
  // Opus plugin files (opus/, named by path): what the bridge made of each at the last start, with its reason and CPU figure
  const opusLabel = r => [`Opus plugin · ${OPUS_STATE[r.state] || r.state}${r.state !== 'loaded' && r.reason ? ': ' + r.reason : ''}`, r.version && `v${r.version}`,
    r.cpu != null && `CPU about ${cpuPercent(r.cpu)} %`].filter(Boolean).join(' · ');
  for (const r of observedOpus) rows.set(r.name, {name: r.name, path: r.path, title: r.id, label: opusLabel(r)});
  for (const [p, d, fileName] of ownFiles) {
    const i = pluginInfo(p, d), on = [...observedOwn, ...observedOpus].find(r => r.path === p && r.crc === i.crc);
    rows.set(i.name, {name: i.name, path: p, title: opusPath(p) ? i.savedName : '', label: `${opusPath(p) ? 'Opus plugin' : 'Your plugin'} · ${on ? (opusPath(p) ? opusLabel(on).replace(/^Opus plugin · /, '') : 'Installed') : 'Ready to add / update'} · ${fileName} · ${Math.max(1, Math.round(d.length / 1024))} KB`});
  }
  for (const r of ownState.removals) rows.set(removalId(r), {...r, pending: true, label: 'Your plugin · Will be removed on update'});
  const found = showLeftovers();
  for (const o of found.old) { const row = rows.get(o.name); if (row) row.label = row.pending ? 'Old copy · Will be removed on update' : 'Old copy from op1r or an earlier build · Installed'; }
  $('own-list').replaceChildren(...[...rows.values()].map(r => {
    const li = document.createElement('li'), name = document.createElement('span'), btn = document.createElement('button');
    li.dataset.pendingRemoval = String(!!r.pending);
    name.textContent = `${r.title ? `${r.title} (${r.path})` : r.name || r.path} · ${r.label}`;
    btn.type = 'button'; btn.textContent = pendingUpdate() ? 'Verify first' : r.pending ? 'Undo' : 'Remove'; btn.disabled = busy || devicePending;
    btn.onclick = async () => {
      if (pendingUpdate()) { $('own-check').click(); return; }
      try { if (r.pending) await undoRemoval(removalId(r)); else await removeOwn(r.name, r.path); }
      catch (e) { ownStatus(e.message, true); }
    };
    li.append(name, btn); return li;
  }));
  $('own-send').hidden = reviewBlocked;
  $('own-send').textContent = 'Review changes →';
  $('own-empty').hidden = rows.size > 0;
  if (release) { selectionReview(); countTabs(); updateSummary(); }
  if (storageError) ownStatus(storageError, true);
  else if (ownState.verification) ownStatus('Update awaiting verification. Once the tape screen is back, press Connect my OP–1 or Check again.');
}
// Every workshop plugin by file id (catalog file names without .knl), for the leftover check
function workshopNames() {
  const names = new Map();
  for (const group of ['synths', 'effects', 'utilities', 'op1r_plugins']) for (const f of release?.catalog[group] || [])
    for (const file of [f.file, ...(f.files || [])].filter(Boolean)) names.set(file.replace(/\.(knl|op1p)$/, ''), f.name || f.id);
  return names;
}
// Leftovers an install without a format can leave (op1push.js leftovers): old copies of workshop plugins in plugins/,
// plugins refused for want of a number, a boot that skipped every file. Removal is the own list's: staged, with Undo.
function showLeftovers() {
  const found = leftovers(deviceInventory, {workshop: workshopNames(), own: ownFiles.map(([p, d]) => pluginInfo(p, d).name)});
  let current = false;
  try { current = !!deviceInventory?.core && sameCore(targetCore(), deviceInventory.core); } catch { /* no core information */ }
  const t = leftoverText(found, {current});
  $('leftovers').hidden = !t;
  if (!t) return found;
  $('leftovers-text').textContent = t.text;
  $('leftovers-hint').textContent = t.hint; $('leftovers-hint').hidden = !t.hint;
  if (t.clean) startClean(true);
  const pending = o => ownState.removals.some(r => removalMatches(r, o));
  $('leftovers-list').replaceChildren(...found.old.map(o => {
    const li = document.createElement('li'), label = document.createElement('span'), btn = document.createElement('button');
    label.textContent = `${o.label} · ${o.path}${o.version ? ' · ' + o.version : ''}${pending(o) ? ' · will be removed on update' : ''}`;
    btn.type = 'button'; btn.textContent = pendingUpdate() ? 'Verify first' : pending(o) ? 'Undo' : 'Remove'; btn.disabled = busy || devicePending;
    btn.onclick = async () => {
      if (pendingUpdate()) { $('own-check').click(); return; }
      try { if (pending(o)) await undoRemoval(o.name); else await removeOwn(o.name, o.path); }
      catch (e) { ownStatus(e.message, true); }
    };
    li.append(label, btn); return li;
  }));
  const left = found.old.filter(o => !pending(o));
  $('leftovers-remove').hidden = left.length < 2 || pendingUpdate();
  $('leftovers-remove').textContent = `Remove all ${left.length} old copies`;
  $('leftovers-remove').disabled = busy || devicePending;
  $('leftovers-remove').onclick = async () => {
    try { for (const o of left) await removeOwn(o.name, o.path); }
    catch (e) { ownStatus(e.message, true); }
  };
  return found;
}
const pluginMax = () => release?.plugin_max || PLUGIN_MAX;        // this release's core (release.py), else 512 KB
async function addOwn(list) {
  if (editingLocked() || !release) return;
  lock(true);
  try {
  const errors = [];
  for (const f of list) {
    try {
      if (f.size > pluginMax()) throw Error(`${f.name}: too big to load (${sizeText(pluginMax())} at most)`);
      const d = new Uint8Array(await f.arrayBuffer()), {path, info} = checkOwnFile(f.name, d, pluginMax());   // .knl, .op1p or .opmod
      const same = ownFiles.findIndex(([p, bytes]) => pluginInfo(p, bytes).name === info.name);
      if (same >= 0) ownFiles.splice(same, 1);              // the same plugin again: the newer file wins
      ownFiles.push([path, d, f.name]);
      ownState.removals = ownState.removals.filter(r => r.name !== info.name);
      ownState.reviews = {}; ownState.verification = null;
      $('log').textContent += `your plugin ${info.name} (${opusPath(path) ? 'opmod ' + info.savedName : info.kind}${info.version ? ' ' + info.version : ''}): checked\n`;
    } catch (e) { errors.push(e.message); }
  }
  await rememberOwn(); showOwn();
  ownStatus(storageError || (errors.length ? errors.join('\n') : ownFiles.length ? 'Saved. Press Review changes to check and install them.' : ''), !!storageError || errors.length > 0);
  } catch (e) { ownStatus(e.message, true); }
  finally { lock(false); showOwn(); }
}
$('own-files').addEventListener('change', e => { if (!editingLocked()) addOwn([...e.target.files]); e.target.value = ''; });
for (const event of ['dragenter', 'dragover']) $('own-drop').addEventListener(event, e => { e.preventDefault(); if (!editingLocked()) $('own-drop').classList.add('dragover'); });
$('own-drop').addEventListener('dragleave', () => $('own-drop').classList.remove('dragover'));
$('own-drop').addEventListener('drop', e => { e.preventDefault(); $('own-drop').classList.remove('dragover'); if (!editingLocked()) addOwn([...e.dataTransfer.files]); });
// Any selection: the pack filtered in the browser (worker.js presetsOnly), no firmware file needed
$('preset-pack-make').addEventListener('click', async () => {
  if (busy || !release) return;
  const config = validateChoices(choices()), snapshot = release;
  const active = new Worker('worker.js?v=3.1-core-patch-20261102', {type: 'module'});
  lock(true); status('Starting the local patcher…');
  try {
    const data = await new Promise((resolve, reject) => {
      active.onerror = e => reject(Error(e.message || 'The patcher could not start. Try again.'));
      active.onmessage = ({data}) => {
        if (data.type === 'log') status(data.text);
        if (data.type === 'error') reject(Error(data.text));
        if (data.type === 'presets') resolve(data);
      };
      active.postMessage({config, release: snapshot, presetsJob: true});
    });
    if (data.id !== configId(config)) throw Error('The preset pack does not match your selection. Try again.');
    const url = URL.createObjectURL(new Blob([data.presets], {type: 'application/zip'})), a = document.createElement('a');
    a.href = url; a.download = `${snapshot.release.product?.slug || 'op1-hundekraft'}-${data.id}.presets.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status('Preset pack ready. Install it separately through disk mode.');
  } catch (error) { status(error.message, true); }
  finally { active.terminate(); lock(false); }
});
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
    clearDownloads(); update(); status('Choices loaded.');
  } catch (error) { status('Could not load choices: ' + error.message, true); }
  finally { e.target.value = ''; lock(false); }
});
// One tab per category; every card the same size: screen, name, a line, who made it. A tick where it can be left out.
// A card's credit line: byLink [name, url] links that name to the maker's site (Gin: SquareWave Studio), and every name
// with a support link in creators.js gets a cup, floated right on the first line of the card's description (design C, owner 2026-11-18). Longest names first, no overlaps.
const CUP = '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path d="M2.5 6h8.5v3.5a3.5 3.5 0 0 1-3.5 3.5h-1.5a3.5 3.5 0 0 1-3.5-3.5z M11 7h1a1.75 1.75 0 0 1 0 3.5h-1 M5 2.5v1.5 M7.5 2v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function creditNodes(it) {
  const text = it.by || '', marks = [];
  const free = (s, e) => !marks.some(m => s < m.end && e > m.start);
  if (it.byLink) { const s = text.indexOf(it.byLink[0]); if (s >= 0) marks.push({start: s, end: s + it.byLink[0].length, name: it.byLink[0], href: it.byLink[1]}); }
  for (const name of Object.keys(SUPPORT).sort((a, b) => b.length - a.length)) {
    const s = text.indexOf(name), links = SUPPORT[name]?.links || [];
    if (s < 0 || !links.length) continue;
    const m = marks.find(x => x.start === s && x.end === s + name.length);
    if (m) m.support = links[0]; else if (free(s, s + name.length)) marks.push({start: s, end: s + name.length, name, support: links[0]});
  }
  marks.sort((a, b) => a.start - b.start);
  const cupped = new Set();                                         // one cup per person ("pcppcp / op1r": op1r is pcppcp's)
  for (const m of marks) if (m.support) { const who = SUPPORT[m.name]?.alias || m.name; if (cupped.has(who)) m.support = null; else cupped.add(who); }
  const names = document.createElement('span'), cups = document.createElement('span'); let at = 0;
  names.className = 'cat-by-names'; cups.className = 'cat-cups';
  for (const m of marks) {
    names.append(text.slice(at, m.start));
    if (m.href) { const a = document.createElement('a'); a.href = m.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.name; names.append(a); }
    else names.append(m.name);
    if (m.support) {                                                // the cup sits apart, at the right end of the line (owner: design C)
      const c = document.createElement('a'); c.className = 'cat-cup'; c.href = m.support.url; c.target = '_blank'; c.rel = 'noopener';
      c.title = `Support ${m.name} (${m.support.label})`; c.setAttribute('aria-label', c.title); c.innerHTML = CUP; cups.append(c);
    }
    at = m.end;
  }
  names.append(text.slice(at));
  return cups.childNodes.length ? [names, cups] : [names];
}
function renderCatalog() {
  const tabs = $('cat-tabs'), panels = $('cat-panels');
  // a choice the release offers; 'always' entries are built into this base's core, so they have no box
  const has = pick => { const [g, id] = pick.split(':'); return (g === 'plugin' ? release.catalog.op1r_plugins || [] : release.catalog[g] || []).some(f => f.id === id && !f.always); };
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
      card.dataset.type = it.type || ''; card.dataset.maker = String(it.maker).toLowerCase(); card.dataset.makerName = it.maker; card.dataset.search = `${it.name} ${it.line} ${it.maker}`.toLowerCase();
      const head = document.createElement('span'); head.className = 'cat-head';
      if (it.pick) {
        const [group, id] = it.pick.split(':'), input = document.createElement('input');
        input.type = 'checkbox'; input.checked = it.defaultOn !== false && !(group === 'plugin' && (release.catalog.op1r_plugins || []).some(f => f.id === id && f.default === false)); input.setAttribute('aria-label', `Include ${it.name}`);
        if (group === 'core') input.dataset.core = id; else if (group === 'plugin') input.dataset.plugin = id; else { input.dataset.group = group; input.value = id; }
        head.append(input);
      }
      const name = document.createElement('strong'); name.textContent = it.name; head.append(name);
      if (it.isNew) { const tag = document.createElement('span'); tag.className = 'cat-new'; tag.textContent = 'New!'; head.append(tag); }
      if (!it.pick) { const tag = document.createElement('span'); tag.className = 'cat-tag'; tag.textContent = 'ALWAYS IN'; head.append(tag); }
      const pic = document.createElement('img'), nativePic = kennel() && it.kennelImg; pic.src = nativePic || it.img; pic.alt = (nativePic ? it.kennelImageAlt : it.imageAlt) || `${it.name} on the OP–1 screen`; pic.width = 400; pic.height = 200; pic.loading = 'lazy';
      const line = document.createElement('span'); line.className = 'cat-line'; line.textContent = it.line + ' ';
      const more = document.createElement('a'); more.href = `manual.html#${it.manual}`; more.textContent = 'manual →'; line.append(more);
      const by = document.createElement('span'); by.className = 'cat-by';
      const [names, cups] = creditNodes(it); by.replaceChildren(names);
      if (cups) line.prepend(cups);                                  // the cups float right on the description's first line (owner)
      card.append(head, pic, line, by);
      panel.append(card);
    }
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('[role=tab]').forEach(t => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
      panels.querySelectorAll('[role=tabpanel]').forEach(p => { p.hidden = p !== panel; });
      showFilters(cat.id);
    });
    const empty = document.createElement('p'); empty.className = 'cat-empty'; empty.hidden = true; empty.textContent = 'Nothing here matches.'; panel.append(empty);
    tabs.append(tab); panels.append(panel);
  });
  buildFilters();
  if (kennel() && pushEnabled()) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.role = 'tab'; tab.id = 'tab-your-plugins';
    tab.tabIndex = -1; tab.setAttribute('aria-controls', 'panel-your-plugins'); tab.setAttribute('aria-selected', 'false');
    tab.innerHTML = 'Your plugins <small data-count>0</small>';
    const panel = document.createElement('div'); panel.id = 'panel-your-plugins'; panel.role = 'tabpanel'; panel.hidden = true;
    panel.setAttribute('aria-labelledby', tab.id); panel.append($('own'));
    tab.onclick = () => {
      for (const t of tabs.querySelectorAll('[role=tab]')) { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; }
      for (const p of panels.querySelectorAll('[role=tabpanel]')) p.hidden = p !== panel;
      showFilters(null);
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
// Filters: UI state for this visit only (never saved). Search and maker cover every tab; the type is kept per tab.
const filters = {q: '', maker: '', types: {}};
const activeCategory = () => document.querySelector('#cat-tabs [role=tab][aria-selected=true]')?.id.replace(/^tab-/, '') || '';
function buildFilters() {
  const bar = $('cat-filter');
  bar.innerHTML = `<div class="cf-row"><label class="cf-search"><span class="cf-icon" aria-hidden="true"></span><input type="search" id="cf-q" placeholder="Search name, sound or maker" aria-label="Search name, sound or maker" autocomplete="off" spellcheck="false"></label>
<div class="cf-group" id="cf-type-group" role="group" aria-label="Type"><span class="cf-label">Type</span><span class="cf-pills" id="cf-types"></span></div>
<div class="cf-group" role="group" aria-label="Maker"><span class="cf-label">Maker</span><span class="cf-pills" id="cf-makers"></span></div></div>
<div class="cf-row cf-foot"><span id="cf-count" role="status" aria-live="polite"></span><button type="button" id="cf-clear" class="cf-clear">Clear filters</button></div>`;
  const pill = (label, value, attr) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cf-pill'; b.textContent = label; b.dataset[attr] = value; return b; };
  $('cf-makers').append(pill('All makers', '', 'maker'), ...MAKER_PILLS.map(([v, l]) => pill(l, v, 'maker')));
  const named = new Set(MAKER_PILLS.map(([v]) => v)), more = new Map();
  for (const card of document.querySelectorAll('#cat-panels .cat-card')) if (!named.has(card.dataset.maker)) { const m = more.get(card.dataset.maker) || {name: card.dataset.makerName, n: 0}; m.n++; more.set(card.dataset.maker, m); }
  const wrap = document.createElement('span'); wrap.className = 'cf-more'; wrap.id = 'cf-more';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'cf-pill'; toggle.id = 'cf-more-btn'; toggle.setAttribute('aria-haspopup', 'true'); toggle.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div'); list.className = 'cf-menu'; list.id = 'cf-menu'; list.hidden = true;
  for (const [key, m] of [...more].sort((x, y) => y[1].n - x[1].n || x[1].name.localeCompare(y[1].name))) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.maker = key; b.dataset.name = m.name; b.innerHTML = '<span></span><small></small>'; b.firstChild.textContent = m.name; b.lastChild.textContent = m.n; list.append(b);
  }
  wrap.append(toggle, list); $('cf-makers').append(wrap);
  const closeMenu = () => { list.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', e => { e.stopPropagation(); list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) closeMenu(); });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); toggle.focus(); } });
  list.addEventListener('click', closeMenu);
  $('cf-q').addEventListener('input', e => { filters.q = e.target.value.trim().toLowerCase(); applyFilters(); });
  $('cf-q').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Escape' && e.target.value) { e.target.value = ''; filters.q = ''; applyFilters(); } });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'cf-clear') { filters.q = ''; filters.maker = ''; filters.types = {}; $('cf-q').value = ''; }
    else if (b.dataset.maker !== undefined) filters.maker = b.dataset.maker;
    else if (b.dataset.type !== undefined) filters.types[activeCategory()] = b.dataset.type;
    applyFilters();
  });
  showFilters(activeCategory());
}
function showFilters(id) {                                        // the band belongs to the category tabs, not to Your plugins
  $('cat-filter').hidden = !id;
  const types = TYPES[id] || [], group = $('cf-type-group');
  group.hidden = !types.length;
  const pill = (label, value) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cf-pill'; b.textContent = label; b.dataset.type = value; return b; };
  $('cf-types').replaceChildren(...(types.length ? [pill('All', ''), ...types.map(t => pill(t, t))] : []));
  applyFilters();
}
function applyFilters() {
  const id = activeCategory(), {q, maker} = filters;
  for (const panel of document.querySelectorAll('#cat-panels .cat-grid')) {
    const type = filters.types[panel.id.replace(/^panel-/, '')] || '';
    let shown = 0;
    for (const card of panel.querySelectorAll('.cat-card')) {
      const ok = (!q || card.dataset.search.includes(q)) && (!maker || card.dataset.maker === maker) && (!type || card.dataset.type === type);
      card.hidden = !ok; if (ok) shown++;
    }
    const empty = panel.querySelector('.cat-empty'); empty.hidden = shown > 0; empty.textContent = q ? 'No matches in this tab. The other tabs show their match counts.' : 'Nothing here matches.';
    panel.dataset.shown = shown;
  }
  const panel = $(`panel-${id}`), type = filters.types[id] || '';
  for (const b of document.querySelectorAll('#cf-types .cf-pill')) b.setAttribute('aria-pressed', String(b.dataset.type === type));
  for (const b of document.querySelectorAll('#cf-makers > .cf-pill')) b.setAttribute('aria-pressed', String(b.dataset.maker === maker));
  const picked = document.querySelector(`#cf-menu button[data-maker="${CSS.escape(maker)}"]`), mb = $('cf-more-btn');
  mb.textContent = picked ? `${picked.dataset.name} ▾` : 'More ▾'; mb.setAttribute('aria-pressed', String(!!picked));
  for (const b of document.querySelectorAll('#cf-menu button')) b.setAttribute('aria-pressed', String(b === picked));
  if (panel) $('cf-count').textContent = `${panel.dataset.shown} of ${panel.querySelectorAll('.cat-card').length} shown`;
  $('cf-clear').style.visibility = q || maker || Object.values(filters.types).some(Boolean) ? 'visible' : 'hidden';
  countTabs();
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
  if ($('panel-your-plugins')) {
    const pending = $('own-list').querySelectorAll('[data-pending-removal=true]').length;
    const kept = $('own-list').children.length - pending;
    row('Your plugins', `${kept} kept${pending ? ` · ${pending} to remove` : ''}`);
  }
  row('User preset limit', choices().preset_cap.toLocaleString('en-US'), 'cap-count');
  $('selection-summary').replaceChildren(...rows);
}
function countTabs() {                                            // ticked / all on each tab
  for (const tab of document.querySelectorAll('#cat-tabs [role=tab]')) {
    if (tab.id === 'tab-your-plugins') { tab.querySelector('[data-count]').textContent = $('own-list').children.length; continue; }
    const panel = $(tab.getAttribute('aria-controls')), count = categoryCounts(panel);
    tab.querySelector('[data-count]').textContent = filters.q ? `${panel.dataset.shown ?? count.total} found` : `${count.selected}/${count.total}`;
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
  // Path A and the USB hints only where this release can update over USB; path B is always there
  for (const id of ['path-usb', 'paths-unsure', 'usb-next']) $(id).hidden = $('device-card').hidden;
  let restored = false, retiredNotice = '', retiredMigrated = false;
  try {
    let saved = loadSelection(release.catalog.base);
    if (!saved) {
      // Migrate the former manual-only snapshot once, before the initial update overwrites it.
      const legacy = JSON.parse(localStorage.getItem('hundekraft-build') || 'null');
      if (legacy?.base === release.catalog.base && ['synths', 'effects', 'utilities', 'plugins', 'hidden'].every(g => Array.isArray(legacy[g]))) {
        saved = {cap: 1024, inputs: {}};
        for (const i of document.querySelectorAll('#catalog input[type=checkbox]')) {
          if (i.dataset.core) { saved.inputs[inputKey(i)] = false; } else if (i.dataset.plugin) {
            if (legacy.plugins.includes(i.dataset.plugin)) saved.inputs[inputKey(i)] = true;
            else if (legacy.hidden.includes(i.dataset.plugin)) saved.inputs[inputKey(i)] = false;
          } else saved.inputs[inputKey(i)] = legacy[i.dataset.group].includes(i.value);
        }
      }
    }
    if (saved) {
      const migrated = migrateRetired(saved.inputs, release.catalog);   // ticks of a retired port move to its replacement
      if (migrated.moved.length) retiredNotice = 'Your saved picks had retired plugins, so their replacements are ticked: ' + migrated.moved.map(([a, b]) => a === b ? b : `${b} (was ${a})`).join(', ') + '. ';
      if (Object.keys(migrated.inputs).length !== Object.keys(saved.inputs).length || migrated.moved.length) retiredMigrated = true;
      saved = {...saved, inputs: migrated.inputs};
      for (const i of document.querySelectorAll('#catalog input[type=checkbox]')) {
        const key = inputKey(i);
        if (Object.hasOwn(saved.inputs, key)) i.checked = saved.inputs[key] === true;

      }
      restored = true;
    }
    selectionStorageReady = true;
  } catch (e) { storageError = 'Could not restore selections; existing data was preserved: ' + e.message; }
  try {
    ownState = await loadPlugins(release.catalog.base);
    if (ownState.schema !== 1 || !Array.isArray(ownState.files) || !Array.isArray(ownState.removals) || !ownState.reviews || Array.isArray(ownState.reviews) || typeof ownState.reviews !== 'object' || !ownState.toggles || Array.isArray(ownState.toggles) || typeof ownState.toggles !== 'object') throw Error('Unsupported own-plugin storage format');
    const v = ownState.verification;
    const filePath = p => pluginPath(p) || opusPath(p);            // a plugin file, or an Opus plugin file (opus/)
    if (v && (!Array.isArray(v.files) || !v.files.every(f => filePath(f.path) && Number.isInteger(f.crc) && typeof f.on === 'boolean') ||
      !Array.isArray(v.deletes) || !v.deletes.every(filePath) || !Array.isArray(v.removals) || !v.removals.every(n => typeof n === 'string') ||
      !Array.isArray(v.off) || !v.off.every(n => typeof n === 'string') ||
      v.before && (!Array.isArray(v.before) || !v.before.every(b => filePath(b.path) && (b.crc === null || Number.isInteger(b.crc)))) ||
      v.builtins && (!Array.isArray(v.builtins) || !v.builtins.every(e => typeof e.name === 'string' && typeof e.on === 'boolean')))) throw Error('Invalid saved device confirmation; existing data was preserved');
    if (v && (v.phase != null && !['sending', 'installing'].includes(v.phase) || v.notBefore != null && (!Number.isFinite(v.notBefore) || v.notBefore < 0))) throw Error('Invalid pending update phase');
    installingUntil = v?.notBefore || 0;
    const restoreFile = ([p, raw, name]) => {
      const bytes = new Uint8Array(raw), checked = checkOwnFile(name, bytes, pluginMax());
      if (checked.path !== p) throw Error('Saved plugin identity changed: ' + name);
      return [p, bytes, name];
    };
    ownFiles = ownState.files.map(restoreFile);
    for (const r of ownState.removals) {
      if (!/^[a-z0-9_-]{1,15}$/.test(r.name) && !(r.name === '' && /^plugins\/[a-z0-9_-]{1,15}\.(knl|op1p)$/.test(r.path || '')) &&
          !(opusPath(r.name) && r.path === r.name)) throw Error('Invalid saved removal identity');
      if (r.file) r.file = restoreFile(r.file);
    }
    pluginStorageReady = true;
  } catch (e) { ownState = newPluginState(); ownFiles = []; storageError = 'Could not restore own plugins: ' + e.message; }
  selectionsReady = true; busy = false; showOwn();
  if (retiredMigrated) rememberSelection();                       // saved without the retired keys: the notice shows once
  update(); setControls();
  if (storageError) ownStatus(storageError, true);
  $('path-connect').disabled = $('device-card').hidden;
  status((restored ? 'Saved selections restored. ' : '') + retiredNotice + ($('device-card').hidden ? 'Choose your original R246 firmware to build.' : 'Choose your original R246 firmware to build, or connect your OP–1 to update over USB.'));
} catch (error) { release = null; $('download-option').open = true; status(error.message, true); }
