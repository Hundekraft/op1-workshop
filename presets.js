// Presets on a connected OP-1 (kennel devupd capability 32, docs/sysex-update.md "Presets"): list what's on it, add
// or replace .aif preset files and delete presets, all without a restart. Shown only when the OP-1 reports the
// capability. The same section also takes the DX banks (dx-banks.js: .syx files, sent from this browser, applied at the
// restart). Each update holds at most PRESET_BATCH files, so a bigger send goes as several updates, deletes first.
// Copyright (C) 2026 Hundekraft. GPL-3.0-or-later.
import {push, session, presetPath, PRESET_BATCH, PRESET_FOLDER, PRESET_NAME, PRESET_RESULT, DX_NAME, DX_MAX_BANKS} from './op1push.js?v=3.3.1-opmodown-20261118';
import {bankName} from './dx-banks.js?v=3.3.1-opmodown-20261118';

// a name the OP-1 accepts over USB: lower case, a-z 0-9 space _ -, no space at the ends, at most `max` characters
export function usbName(s, max = PRESET_NAME) {
  const t = String(s ?? '').toLowerCase().replace(/[øœæßþð]/g, c => ({ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss', þ: 'th', ð: 'd'})[c])
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 _-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t || 'untitled';
}
export const usbFolder = s => { const f = usbName(s, PRESET_FOLDER); return f === 'user' ? 'user presets' : f; };
export const devicePath = p => `presets/${p.kind}/${p.folder}/${p.name}.aif`;
const key = p => `${p.kind}/${p.folder}/${p.name}`;
const DRUM_TYPES = new Set(['drum', 'dbox']);

// what an OP-1 preset file says: {type, name} from its APPL "op-1" JSON, or null when it isn't one
export function presetInfo(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), tag = o => String.fromCharCode(...d.subarray(o, o + 4));
  if (d.length < 12 || tag(0) !== 'FORM' || !['AIFF', 'AIFC'].includes(tag(8))) return null;
  for (let o = 12; o + 8 <= d.length;) {
    const n = (d[o + 4] << 24 | d[o + 5] << 16 | d[o + 6] << 8 | d[o + 7]) >>> 0;
    if (o + 8 + n > d.length) return null;
    if (tag(o) === 'APPL' && n > 4 && tag(o + 8) === 'op-1') {
      try {
        const j = JSON.parse(new TextDecoder().decode(d.subarray(o + 12, o + 8 + n)).replace(/[\0\s]+$/, ''));
        return {type: String(j.type || ''), name: String(j.name || '')};
      } catch { return null; }
    }
    o += 8 + n + (n & 1);
  }
  return null;
}

// the files of a zip (stored or deflated, as runtime.preset_zip writes them): [{path, bytes}]
export async function readZip(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let end = d.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw Error('The preset pack is not a zip file');
  const out = [];
  for (let i = 0, o = v.getUint32(end + 16, true), n = v.getUint16(end + 10, true); i < n; i++) {
    if (v.getUint32(o, true) !== 0x02014b50) throw Error('The preset pack is damaged');
    const method = v.getUint16(o + 10, true), packed = v.getUint32(o + 20, true), size = v.getUint32(o + 24, true), nl = v.getUint16(o + 28, true);
    const extra = v.getUint16(o + 30, true), note = v.getUint16(o + 32, true), at = v.getUint32(o + 42, true);
    const path = new TextDecoder().decode(d.subarray(o + 46, o + 46 + nl));
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true), raw = d.subarray(start, start + packed);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw Error('The preset pack uses a compression this page can’t read');
    if (data.length !== size) throw Error('The preset pack is damaged');
    out.push({path, bytes: data});
    o += 46 + nl + extra + note;
  }
  return out;
}

// the release's preset pack (synth/<engine>/<name>.aif) as synth presets to send, in the pack's folders (engines)
export async function packPresets(zip) {
  return (await readZip(zip)).filter(f => /^synth\/[^/]+\/[^/]+\.aif$/i.test(f.path)).map(f => {
    const [, folder, file] = f.path.split('/'), info = presetInfo(f.bytes);
    return {bytes: f.bytes, info, kind: 'synth', folder: usbFolder(folder), name: usbName(file.replace(/\.aif$/i, ''))};
  }).filter(p => p.info);
}

// which pack presets go: those not on the OP-1 (same kind, folder and name, compared as USB names: the list shows a
// preset's own name, "linn + tonic", which goes over USB as "linn tonic"), plus the ones there when `replace` is set
export function planPack(pack, device, {replace = false} = {}) {
  const fold = p => `${p.kind}/${usbFolder(p.folder)}/${usbName(p.name)}`;
  const there = new Set(device.map(fold));
  const existing = pack.filter(p => there.has(fold(p)));
  return {send: replace ? pack : pack.filter(p => !existing.includes(p)), existing};
}

// split adds and deletes into updates of at most `batch` files: every delete before any add, so room is made first
export function presetBatches(adds, deletes, batch = PRESET_BATCH) {
  const all = [...deletes.map(p => ({del: p})), ...adds.map(p => ({add: p}))], out = [];
  for (let i = 0; i < all.length; i += batch) out.push(all.slice(i, i + batch));
  return out;
}

// one update: send, apply, wait for the OP-1's results. Returns [{entry, code, text}] in the order sent
export async function applyPresets(port, entries, {log = () => {}, progress = () => {}, signal, timeoutMs = 120000} = {}) {
  const files = entries.filter(e => e.add).map(e => [devicePath(e.add), e.add.bytes]);
  const deletes = entries.filter(e => e.del).map(e => devicePath(e.del));
  const {apply} = await push(port, files, {deletes, apply: true, log, progress, signal});
  const s = session(port, {log, signal}), until = Date.now() + timeoutMs;
  let r;
  for (;;) {
    // a preset with a long sample keeps the OP–1 busy for a while, so silence is waited out until the deadline
    try { r = await s.presetResults(); }
    catch (e) { if (e.code !== 'no-reply' || Date.now() > until) throw e; continue; }
    if (r.apply === apply && !r.running) break;
    if (Date.now() > until) throw Error('The OP–1 is still busy with the presets. Check the list again in a moment.');
    await new Promise(ok => setTimeout(ok, 400));
  }
  // the session's order: files first (BEGIN), then the deletes
  const sent = [...entries.filter(e => e.add), ...entries.filter(e => e.del)];
  return sent.map((entry, i) => ({entry, code: r.results[i] ?? 0, text: PRESET_RESULT[r.results[i]] || 'no answer'}));
}

// the counts line: the user's own presets (the list) and the room left. The OP-1's counts (PRESET_LIST what 3)
// include the factory samplers and kits, because the caps count those too, so they are shown only as room left.
export function countsText(c, device) {
  const own = {synth: 0, sampler: 0, drum: 0}, n = x => x.toLocaleString('en-US');
  for (const p of device) own[p.kind === 'drum' ? 'drum' : p.sampler ? 'sampler' : 'synth']++;
  const room = w => c[w].cap == null ? null : Math.max(0, c[w].cap - c[w].have);
  const left = [['synth', 'synth presets'], ['sampler', 'sampler presets'], ['drum', 'kits']].filter(([w]) => room(w) != null)
    .map(([w, what], i) => `${n(room(w))}${i ? '' : ' more'} ${what}`);
  const mine = `Your own: ${n(own.synth)} synth, ${n(own.sampler)} sampler, ${n(own.drum)} ${own.drum === 1 ? 'kit' : 'kits'}.`;
  return left.length ? `${mine} Room for ${left.length > 1 ? left.slice(0, -1).join(', ') + ' and ' + left.at(-1) : left[0]}.` : mine;
}

// "12 presets and 4 kits", "1 preset", "3 kits"
export function sendText(list) {
  const kits = list.filter(p => p.kind === 'drum').length, synth = list.length - kits;
  const parts = [synth && `${synth} ${synth === 1 ? 'preset' : 'presets'}`, kits && `${kits} ${kits === 1 ? 'kit' : 'kits'}`].filter(Boolean);
  return parts.join(' and ');
}

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// pack: async () => the preset pack for the selection in the plugin list (zip bytes), or null when there is none
// dx: the DX banks controller (dx-banks.js initDxBanks), or null
export function initPresets({withDevice, openDevice, pack = async () => null, dx = null, log = () => {}}) {
  const state = {device: [], counts: null, adds: [], marked: new Set(), results: [], release: null, releaseNote: '', off: new Set(), loadingRelease: 0, open: new Set(), sending: false};
  const status = (text, error = false) => { $('presets-status').textContent = text; $('presets-status').classList.toggle('error', error); };
  const onDevice = p => state.device.some(d => key(d) === key(p));
  const hasDx = () => !!dx?.available();
  const dxMarked = () => (hasDx() ? dx.sent().filter(n => dx.marked().has(n)) : []);
  const aifOk = p => p.info && presetPath(devicePath(p));
  // the engines of the release pack, ticked ones only: [{folder, all, there}] and what a send would do
  const engines = () => {
    const by = new Map();
    for (const p of state.release || []) { if (!by.has(p.folder)) by.set(p.folder, []); by.get(p.folder).push(p); }
    return [...by].map(([folder, all]) => ({folder, all, there: planPack(all, state.device).existing.length, on: !state.off.has(folder)}));
  };
  const releasePlan = () => {
    const picked = engines().filter(e => e.on).flatMap(e => e.all);
    return {picked, ...planPack(picked, state.device, {replace: $('presets-pack-replace').checked})};
  };

  function render() {
    const c = state.counts, busy = !!state.busy;
    $('presets-counts').textContent = !c ? '' : countsText(c, state.device);
    const groups = new Map();
    for (const p of state.device) {
      const g = `${p.kind === 'drum' ? 'Kits' : 'Synth'} / ${p.folder}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    const banks = hasDx() ? dx.sent() : [];
    const bankGroup = !hasDx() ? '' : `<li><details data-g="dx"${state.open.has('dx') ? ' open' : ''}><summary>DX banks <span>${banks.length}</span></summary>` +
      (banks.length ? `<p class="presets-note">Sent from this browser. The OP–1 can’t list its banks.</p><ul>${banks.map(n =>
        `<li><label><input type="checkbox" data-dx="${esc(n)}"${dx.marked().has(n) ? ' checked' : ''}${busy ? ' disabled' : ''}> ${esc(n)}</label></li>`).join('')}</ul>` :
        '<p class="presets-note">None sent from this browser yet.</p>') + '</details></li>';
    $('presets-list').innerHTML = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([g, ps]) =>
      `<li><details data-g="${esc(g)}"${state.open.has(g) ? ' open' : ''}><summary>${esc(g)} <span>${ps.length}</span></summary><ul>${ps.sort((a, b) => a.name.localeCompare(b.name)).map(p =>
        `<li><label><input type="checkbox" data-key="${esc(key(p))}"${state.marked.has(key(p)) ? ' checked' : ''}${p.cut ? ' disabled' : ''}> ${esc(p.name)}${p.cut ? '…' : ''}</label>${p.sampler ? '<small>sampler</small>' : ''}${p.cut ? '<small>name too long to show; delete it on the OP–1</small>' : ''}</li>`).join('')}</ul></details></li>`).join('') + bankGroup;
    $('presets-list').hidden = state.sending;                          // no long list while a send runs; the bar shows instead
    $('presets-progress').hidden = !state.sending;
    $('presets-empty').hidden = state.sending || state.device.length > 0 || banks.length > 0;
    $('presets-incomplete').hidden = !state.incomplete;
    $('presets-refresh').disabled = busy;
    const nDel = state.marked.size + dxMarked().length;
    $('presets-delete').disabled = busy || !nDel;
    $('presets-delete').textContent = nDel ? `Delete ${nDel} selected` : 'Delete selected';

    // the release card: one row per engine in the plugin list
    const eng = engines(), plan = releasePlan();
    $('presets-release-list').innerHTML = eng.length ? eng.map(e =>
      `<li><label><input type="checkbox" data-engine="${esc(e.folder)}"${e.on ? ' checked' : ''}${busy ? ' disabled' : ''}> ${esc(e.folder)} <span>${e.all.length}</span></label>${e.there ? `<small>${e.there} already there</small>` : ''}</li>`).join('') :
      `<li class="presets-note">${esc(state.releaseNote || 'Choose a release and your plugins above to see their presets.')}</li>`;
    $('presets-pack-send').disabled = busy || (!!state.release && !plan.send.length);
    $('presets-pack-send').textContent = state.release && eng.length ? `Send ${plural(plan.send.length, 'preset')}` : 'Send presets';

    // your own files
    $('presets-files').accept = hasDx() ? '.aif,.aiff,.syx' : '.aif,.aiff';
    $('presets-drop-hint').textContent = hasDx() ? 'Drop .aif preset files or .syx DX voice banks here, or click to choose.' : 'Drop .aif preset files here, or click to choose.';
    const dxAdds = state.adds.filter(p => p.kind === 'dx'), dxPlan = hasDx() ? dx.plan(dxAdds) : {problems: [], tooMany: false};
    $('presets-adds').innerHTML = state.adds.map((p, i) => {
      let bad, tag, type;
      if (p.kind === 'dx') {
        bad = dxPlan.problems[dxAdds.indexOf(p)];
        tag = `${p.info.voices === 32 ? '32 voices' : '1 voice'}, ${dx.sent().includes(p.name) ? 'replaces' : 'new'}`;
        type = '<span>DX bank</span>';
      } else {
        bad = !p.info ? 'not an OP–1 preset file' : !presetPath(devicePath(p)) ? 'name not allowed' : '';
        tag = `${onDevice(p) ? 'replaces' : 'new'} in ${esc(p.folder)}`;
        type = `<select data-f="kind" aria-label="Type"><option value="synth"${p.kind === 'synth' ? ' selected' : ''}>preset</option><option value="drum"${p.kind === 'drum' ? ' selected' : ''}>kit</option></select>`;
      }
      return `<li data-i="${i}" title="${p.kind === 'dx' ? '' : esc(`${p.folder}/`)}"><input data-f="name" value="${esc(p.name)}" maxlength="${p.kind === 'dx' ? DX_NAME : PRESET_NAME}" aria-label="Name">${type}` +
        `<span>${bad ? `<em>${esc(bad)}</em>` : tag}</span><button type="button" data-drop aria-label="Remove ${esc(p.name)} from the list">×</button></li>`;
    }).join('');
    $('presets-adds-head').hidden = !state.adds.length;
    $('presets-adds-head').textContent = `Files to send (${state.adds.length})`;
    const sendable = state.adds.filter(p => p.kind === 'dx' ? !dxPlan.problems[dxAdds.indexOf(p)] : aifOk(p));
    $('presets-limit').hidden = !dxPlan.tooMany;
    $('presets-limit').textContent = dxPlan.tooMany ? `That makes ${dxPlan.total} DX banks, and the DX engine reads ${DX_MAX_BANKS}. Remove some first.` : '';
    $('presets-send').disabled = busy || !sendable.length || dxPlan.tooMany;
    $('presets-send').textContent = sendable.length ? `Send ${plural(sendable.length, 'file')}` : 'Send files';
    $('presets-results').hidden = state.sending;
    $('presets-results').innerHTML = state.results.map(r => {
      const p = r.entry.add || r.entry.del, ok = r.code >= 1 && r.code <= 4;
      return `<li class="${ok ? '' : 'bad'}">${esc(`${p.kind === 'drum' ? 'kit' : 'synth'} ${p.folder}/${p.name}`)}<span>${esc(r.text)}</span></li>`;
    }).join('');
  }

  // the bar of a send or delete: same look as the firmware upload (push-* classes); item = the file being sent
  function bar(label, done, total, item) {
    const percent = Math.min(100, Math.floor(done * 100 / Math.max(1, total)));
    $('presets-prog-label').textContent = label;
    $('presets-prog-fill').style.width = `${percent}%`;
    $('presets-prog-amount').textContent = `${percent}% · ${Math.min(done, total)} of ${total}`;
    $('presets-prog-item').textContent = item || '';
  }

  async function load(port) {
    const s = session(port, {log});
    if (!(await s.hello()).presetsLive) { $('presets-device').hidden = true; return false; }
    state.device = await s.presets();
    state.incomplete = !!state.device.incomplete;
    state.counts = await s.presetCounts();
    for (const k of [...state.marked]) if (!state.device.some(p => key(p) === k)) state.marked.delete(k);
    $('presets-device').hidden = false;
    render();
    return true;
  }

  // the release pack for the plugin list as it is now: read once, then kept until the selection changes
  async function loadRelease() {
    const token = ++state.loadingRelease;
    let list = null, note = '';
    try {
      const zip = await pack();
      if (zip) list = await packPresets(zip); else note = 'Choose a release and your plugins above to see their presets.';
      if (list && !list.length) note = 'Your build has no presets of its own.';
    } catch (e) { note = e.message || String(e); }
    if (token !== state.loadingRelease) return;
    state.release = list; state.releaseNote = note; render();
  }

  // one send or delete: presets over the live path (no restart), then the DX banks, which end in a restart
  async function run({adds = [], dels = [], banks = null}) {
    await withDevice(async () => {
      let port;
      state.results = []; state.busy = true; state.sending = true;
      const label = adds.length ? 'SENDING TO OP–1' : 'DELETING FROM OP–1';
      bar(label, 0, adds.length + dels.length, '');
      render();
      try {
        port = await openDevice();
        const batches = presetBatches(adds, dels);
        let before = 0;                                              // items finished in earlier updates
        const name = e => `${(e.add || e.del).folder}/${(e.add || e.del).name}`;
        for (const [i, b] of batches.entries()) {
          status(batches.length > 1 ? `Sending part ${i + 1} of ${batches.length}…` : 'Sending…');
          const sizes = b.map(e => e.add ? e.add.bytes.length : 0), sum = sizes.reduce((a, n) => a + n, 0);
          const progress = (done, total) => {                        // bytes of this update -> the file being sent
            const at = total ? done * sum / total : 0;
            let k = 0, acc = 0;
            while (k < b.length - 1 && acc + sizes[k] <= at) acc += sizes[k++];
            bar(label, before + (total ? Math.min(b.length, Math.floor(done * b.length / total)) : 0), adds.length + dels.length, name(b[k]));
          };
          state.results.push(...await applyPresets(port, b, {log, progress}));
          before += b.length;
          bar(label, before, adds.length + dels.length, '');
        }
        const added = state.results.filter(r => r.entry.add && (r.code === 1 || r.code === 2)).map(r => r.entry.add);
        state.adds = state.adds.filter(p => !added.includes(p));
        const failed = state.results.filter(r => !(r.code >= 1 && r.code <= 4)).length;
        if (batches.length) await load(port);
        if (batches.length) status(failed ? `Done, but ${failed} didn’t go through. See why below.` : adds.length ? 'Done. They’re on the OP–1 now.' : 'Done. They’re gone from the OP–1.', failed > 0);
        if (banks && (banks.adds.length || banks.dels.length)) {
          await dx.send(port, banks, status);
          state.adds = state.adds.filter(p => !banks.adds.includes(p));
        }
      } catch (e) { status(e.message || String(e), true); }
      finally { port?.close(); state.busy = false; state.sending = false; render(); }
    }, true);
  }

  async function addFiles(files) {
    const refused = [];
    for (const f of files) {
      if (/\.syx$/i.test(f.name)) {
        if (!hasDx()) { refused.push(f.name); continue; }
        state.adds.push(...await dx.fromFile(f));
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer()), info = presetInfo(bytes);
      // the folder is the preset's own engine (its JSON type), as the release pack files them; never "user" (the slots)
      const own = usbFolder(info?.type || 'usb'), folder = own && own !== 'user' ? own : 'usb';
      state.adds.push({bytes, info, kind: info && DRUM_TYPES.has(info.type) ? 'drum' : 'synth', folder,
                       name: usbName(f.name.replace(/\.aiff?$/i, ''))});
    }
    if (refused.length) status(`${refused.length === 1 ? refused[0] : `${refused.length} .syx files`} not added. DX voice banks need the DX engine on your OP–1.`, true);
    render();
  }
  $('presets-files').addEventListener('change', async e => { await addFiles([...e.target.files]); e.target.value = ''; });
  for (const event of ['dragenter', 'dragover']) $('presets-drop').addEventListener(event, e => { e.preventDefault(); $('presets-drop').classList.toggle('dragover', true); });
  $('presets-drop').addEventListener('dragleave', () => $('presets-drop').classList.toggle('dragover', false));
  $('presets-drop').addEventListener('drop', e => { e.preventDefault(); $('presets-drop').classList.toggle('dragover', false); addFiles([...e.dataTransfer.files]); });
  $('presets-adds').addEventListener('change', e => {
    const li = e.target.closest('li[data-i]'), p = li && state.adds[+li.dataset.i], f = e.target.dataset.f;
    if (!p || !f) return;
    p[f] = f === 'kind' ? e.target.value : p.kind === 'dx' ? bankName(e.target.value) : usbName(e.target.value);
    render();
  });
  $('presets-adds').addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li && e.target.matches('[data-drop]')) { state.adds.splice(+li.dataset.i, 1); render(); }
  });
  // <details> keeps its open state across render(): remembered here (toggle doesn't bubble, so capture)
  $('presets-list').addEventListener('toggle', e => {
    const g = e.target.dataset?.g;
    if (g === undefined) return;
    if (e.target.open) state.open.add(g); else state.open.delete(g);
  }, true);
  $('presets-list').addEventListener('change', e => {
    const k = e.target.dataset.key, n = e.target.dataset.dx;
    if (n !== undefined && dx) { dx.mark(n, e.target.checked); render(); return; }
    if (!k) return;
    if (e.target.checked) state.marked.add(k); else state.marked.delete(k);
    render();
  });
  $('presets-release-list').addEventListener('change', e => {
    const f = e.target.dataset.engine;
    if (f === undefined) return;
    if (e.target.checked) state.off.delete(f); else state.off.add(f);
    render();
  });
  $('presets-pack-replace').addEventListener('change', render);
  $('presets-send').addEventListener('click', () => {
    const dxAdds = state.adds.filter(p => p.kind === 'dx'), dxPlan = hasDx() ? dx.plan(dxAdds) : {problems: [], tooMany: false};
    const files = state.adds.filter(p => p.kind !== 'dx' && aifOk(p)), banks = dxAdds.filter((p, i) => !dxPlan.problems[i]);
    if (dxPlan.tooMany || !(files.length || banks.length)) return;
    run({adds: files, banks: banks.length ? {adds: banks, dels: []} : null});
  });
  $('presets-delete').addEventListener('click', () => {
    const dels = state.device.filter(p => state.marked.has(key(p))), banks = dxMarked();
    if (!dels.length && !banks.length) return;
    const all = [...dels.map(p => p.name), ...banks.map(n => `${n} (DX bank)`)];
    const names = all.slice(0, 8).join(', ') + (all.length > 8 ? ` and ${all.length - 8} more` : '');
    const keep = !dels.length ? '' : dels.length > 16 ? ' The OP–1 keeps a copy of only the 16 most recent deletions, so the rest are gone for good.' :
      ' The OP–1 keeps a copy of the 16 most recent deletions in its .deleted folder.';
    const restart = banks.length ? ' Removing DX banks restarts the OP–1.' : '';
    if (!confirm(`Delete ${all.length === 1 ? 'this' : `these ${all.length}`} from the OP–1? ${names}.${keep}${restart}`)) return;
    state.marked.clear(); dx?.clearMarks();
    run({dels, banks: banks.length ? {adds: [], dels: banks} : null});
  });
  // the release's presets for the engines ticked in the release card, over the same live path
  $('presets-pack-send').addEventListener('click', async () => {
    if (state.busy) return;
    if (!state.release) {
      state.busy = true; render();
      try { status('Getting the presets for your build…'); await loadRelease(); }
      finally { state.busy = false; }
      render();
      if (!state.release) { status(state.releaseNote || 'Choose a release and your plugins first.', true); return; }
      status('');
    }
    const replace = $('presets-pack-replace').checked, {picked, send, existing} = releasePlan();
    const names = existing.slice(0, 8).map(p => `${p.folder}/${p.name}`).join(', ') + (existing.length > 8 ? ` and ${existing.length - 8} more` : '');
    if (!send.length) { status(picked.length ? `All ${picked.length} presets you ticked are on the OP–1 already.` : 'Tick at least one engine first.'); return; }
    const there = !existing.length ? '' : replace ? ` ${existing.length} of them are on the OP–1 already and will be replaced: ${names}.` :
      ` ${existing.length} more are on the OP–1 already and will be skipped: ${names}.`;
    if (!confirm(`Send ${sendText(send)} for the plugins you ticked?${there}`)) { status(''); return; }
    run({adds: send});
  });
  $('presets-refresh').addEventListener('click', () => withDevice(async () => {
    let port;
    try { port = await openDevice(); status('Reading the list…'); if (await load(port)) status(''); }
    catch (e) { status(e.message || String(e), true); }
    finally { port?.close(); }
  }, true));

  // after the page connected: show the section when this OP-1 takes presets live
  return {
    connected: async port => {
      try { const shown = await load(port); if (shown) await loadRelease(); return shown; }
      catch (e) { log(`presets: ${e.message}`); return false; }
    },
    // the plugin list changed: read the pack again (only while the section is showing)
    releaseChanged: () => { if (!$('presets-device').hidden && !state.busy) return loadRelease(); },
  };
}
