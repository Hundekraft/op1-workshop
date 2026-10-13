const $ = id => document.getElementById(id);
let release, file, worker, busy = false, urls = [], fileCheck = 0;
// Exact original R246 bytes; the worker and Python runtime independently check again.
const ORIGINAL_R246_SHA256 = 'c5315218f825f143b415ca554516541898abee843d3a236df0b54c04e1fb13a9';
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const hiddenPlugins = () => (release.catalog.op1r_plugins || []).map(f => f.id).filter(id => document.querySelector(`input[data-plugin="${id}"]`)?.checked === false);
const choices = () => ({ schema: 1, base: release.catalog.base, synths: selected('synths'), effects: selected('effects'), utilities: $('maiko-bundle').checked ? release.catalog.utilities.map(f => f.id) : [], preset_cap: $('expanded').checked ? 300 : 100, ...(hiddenPlugins().length ? {hidden: hiddenPlugins()} : {}) });
const selected = group => [...$(group).querySelectorAll('input:checked')].map(input => input.value);
const baseLabel = () => release.catalog.base.replace(/^op1r(\d+).*$/, 'op1r $1');
// Same bits as runtime.config_id; op1r plugins hidden from the lists sit at a fixed position (op1r_plugins_bit).
function configId(c, withHidden = true) {
  const flags = [...release.catalog.synths.map(f => c.synths.includes(f.id)), ...release.catalog.effects.map(f => c.effects.includes(f.id)), c.preset_cap === 300, ...release.catalog.utilities.map(f => c.utilities.includes(f.id))];
  let id = flags.reduce((sum, flag, i) => sum + (flag ? 2 ** i : 0), 0);
  if (withHidden) (release.catalog.op1r_plugins || []).forEach((f, i) => { if (c.hidden?.includes(f.id)) id += 2 ** (release.catalog.op1r_plugins_bit + i); });
  return id.toString(16).padStart(2, '0');
}
function clearDownloads() { urls.forEach(URL.revokeObjectURL); urls = []; $('downloads').hidden = true; }
function update() {
  $('synth-count').textContent = selected('synths').length;
  $('effect-count').textContent = selected('effects').length;
  $('cap-count').textContent = $('expanded').checked ? 300 : 100;
  document.querySelector('.capacity-number').textContent = $('cap-count').textContent;
  $('build').disabled = busy || !release || !file;
  for (const id of ['export', 'import', 'expanded']) $(id).disabled = busy || !release;
  if (release) {
    const c = choices();
    if ($('build-upstreams')) $('build-upstreams').textContent = `Original R246 · ${baseLabel()}${c.utilities?.length ? ' · Maiko #249' : ''}`;
    const id = configId(c, false);   // the preset pack belongs to the prebuilt variant
    const presets = release.variants[id]?.presets;
    if (presets) {
      $('preset-total').textContent = presets.count;
      $('preset-breakdown').replaceChildren();
      for (const [engine, count] of Object.entries(presets.by_engine)) {
        const item = document.createElement('span'); item.textContent = `${engine} / ${count}`; $('preset-breakdown').append(item);
      }
      $('preset-pack-download').href = `variants/${id}/presets.zip`;
      $('preset-pack-download').download = `${release.release.product?.slug || "op1-hundekraft"}-${id}.presets.zip`;
      $('preset-warning').hidden = !presets.exceeds_cap;
      $('preset-warning').textContent = `This pack has ${presets.count} presets; your selected limit is 100. Enable 300 presets below, or install a subset. Existing user presets also count toward the limit.`;
    }
  }
}
function lock(value) {
  busy = value;
  document.querySelectorAll('fieldset input, #maiko-bundle, #firmware, #export, #import, input[data-plugin]').forEach(el => el.disabled = value);
  $('cancel').hidden = !value;
  update();
}
async function chooseFile(candidate) {
  if (busy || !candidate) return;
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
    $('firmware').value = '';
    $('file-name').textContent = 'No valid firmware selected';
    status(error.message || 'Could not verify the firmware. Please choose the original R246 again.', true);
  }
  update();
}
function link(id, blob, filename) {
  const url = URL.createObjectURL(blob); urls.push(url);
  $(id).href = url; $(id).download = filename;
}
function fail(error) {
  worker?.terminate(); worker = null; lock(false); clearDownloads();
  status(String(error.message || error), true);
}
$('firmware').addEventListener('change', e => chooseFile(e.target.files[0]));
for (const event of ['dragenter', 'dragover']) $('drop-zone').addEventListener(event, e => { e.preventDefault(); if (!busy) $('drop-zone').classList.add('dragover'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragover'));
$('drop-zone').addEventListener('drop', e => { e.preventDefault(); $('drop-zone').classList.remove('dragover'); chooseFile(e.dataTransfer.files[0]); });
$('workshop').addEventListener('change', e => { if (e.target.closest('fieldset') || e.target.matches('input[data-plugin]')) { clearDownloads(); update(); status(file ? 'Choices updated. Ready to build.' : 'Choose your original R246 firmware to continue.'); } });
$('cancel').addEventListener('click', () => { worker?.terminate(); worker = null; lock(false); clearDownloads(); status('Build cancelled. You can change your choices and try again.'); });
$('workshop').addEventListener('submit', async e => {
  e.preventDefault(); if (busy || !release || !file) return;
  clearDownloads(); $('log').textContent = ''; lock(true); status('Starting the local patcher…');
  const active = new Worker('worker.js', {type: 'module'}); worker = active;
  active.onerror = e => { if (worker === active) fail(e.message || 'The patcher could not start. Try again.'); };
  active.onmessage = ({data}) => {
    if (worker !== active) return;
    if (data.type === 'log') { status(data.text); $('log').textContent += data.text + '\n'; }
    if (data.type === 'error') fail(data.text);
    if (data.type === 'done') {
      const stem = `${release.release.product?.slug || 'op1_246-' + release.catalog.base}-${data.id}`;
      link('download-firmware', new Blob([data.out], {type:'application/octet-stream'}), stem + '.op1');
      link('download-presets', new Blob([data.presets], {type:'application/zip'}), stem + '.presets.zip');
      link('download-report', new Blob([data.report], {type:'application/json'}), stem + '.build.json');
      $('downloads').hidden = false; status('Verified. Your firmware is ready to download.');
      active.terminate(); worker = null; lock(false);
    }
  };
  try { const bytes = await file.arrayBuffer(); if (worker === active) active.postMessage({bytes, config:choices(), release}, [bytes]); }
  catch (error) { if (worker === active) fail(error); }
});
$('export').addEventListener('click', () => {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(choices(), null, 2) + '\n'], {type:'application/json'}));
  a.href = url; a.download = `${release.release.product?.slug || 'op1-workshop'}-choices.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import').addEventListener('change', async e => {
  if (busy || !release || !e.target.files[0]) return;
  try {
    const c = JSON.parse(await e.target.files[0].text()), keys = ['base','effects','preset_cap','schema','synths'];
    if (!c || Array.isArray(c) || Object.keys(c).filter(k => k !== 'utilities' && k !== 'hidden').sort().join() !== keys.join() || c.schema !== 1 || c.base !== release.catalog.base || ![100,300].includes(c.preset_cap)) throw Error(`This workshop needs choices saved for ${baseLabel()}. Re-select your choices if they were saved for an older base.`);
    if (!Object.hasOwn(c, 'utilities')) c.utilities = [];
    if (!Object.hasOwn(c, 'hidden')) c.hidden = [];
    if (!Array.isArray(c.hidden) || new Set(c.hidden).size !== c.hidden.length || c.hidden.some(id => !(release.catalog.op1r_plugins || []).some(f => f.id === id))) throw Error('Unknown or duplicate op1r synths or effects.');
    for (const group of ['synths','effects','utilities']) {
      if (!Array.isArray(c[group]) || new Set(c[group]).size !== c[group].length || c[group].some(id => !release.catalog[group].some(f => f.id === id))) throw Error('Unknown or duplicate features.');
    }
    if (c.utilities.length !== 0 && c.utilities.length !== release.catalog.utilities.length) throw Error('Maiko features are included as one bundle. Select the full bundle or none.');
    for (const group of ['synths','effects']) $(group).querySelectorAll('input').forEach(el => el.checked = c[group].includes(el.value));
    $('maiko-bundle').checked = c.utilities.length > 0;
    document.querySelectorAll('input[data-plugin]').forEach(el => el.checked = !c.hidden.includes(el.dataset.plugin));
    $('expanded').checked = c.preset_cap === 300; clearDownloads(); update(); status('Choices loaded.');
  } catch (error) { status('Could not load choices: ' + error.message, true); }
  e.target.value = '';
});
try {
  const response = await fetch('release.json', {cache:'no-cache'});
  if (!response.ok) throw Error('The patch release is unavailable. Run the release builder, then serve its output directory.');
  release = await response.json();
  document.querySelectorAll('[data-release-label]').forEach(el => el.textContent = release.release.product?.label || 'Firmware workshop');
  document.title = `${release.release.product?.label || 'OP–1'} / Firmware workshop`;
  for (const group of ['synths','effects']) for (const feature of release.catalog[group]) {
    const label = document.createElement('label'); label.className = 'feature'; label.style.setProperty('--accent', `var(--${feature.color})`);
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = feature.id; input.checked = true; input.setAttribute('aria-label', `Include ${feature.name}`);
    const heading = document.createElement('span'); heading.className = 'feature-heading';
    const strong = document.createElement('strong'); strong.textContent = feature.name;
    const selection = document.createElement('span'); selection.className = 'selection'; selection.textContent = group === 'synths' ? '12 presets' : '+2 presets / synth';
    heading.append(input, strong, selection);
    const kind = document.createElement('span'); kind.className = 'feature-type'; kind.textContent = feature.type;
    const img = document.createElement('img'); img.src = `screens/${feature.id}.svg`; img.alt = `${feature.name} instrument screen`; img.width = 320; img.height = 160;
    const controls = document.createElement('span'); controls.className = 'controls';
    feature.controls.forEach((control, index) => {
      const cell = document.createElement('span'); cell.className = 'control';
      const knob = document.createElement('i'); knob.className = `knob knob-${index}`; knob.setAttribute('aria-hidden','true');
      const name = document.createElement('span'); name.textContent = control.name;
      const help = document.createElement('small'); help.textContent = control.description;
      cell.append(knob,name,help); controls.append(cell);
    });
    const description = document.createElement('span'); description.className = 'feature-description'; description.textContent = feature.description;
    label.append(heading,kind,img,controls,description); $(group).querySelector('.feature-grid').append(label);
  }
  // op1r's own synths and effects: same cards as ours, without knob rows; unticked ones are left off the OP-1 lists.
  for (const feature of release.catalog.op1r_plugins || []) {
    const label = document.createElement('label'); label.className = 'feature'; label.style.setProperty('--accent', 'var(--ink)');
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.plugin = feature.id; input.checked = true; input.setAttribute('aria-label', `Include ${feature.name}`);
    const heading = document.createElement('span'); heading.className = 'feature-heading';
    const strong = document.createElement('strong'); strong.textContent = feature.name;
    heading.append(input, strong);
    const kind = document.createElement('span'); kind.className = 'feature-type'; kind.textContent = feature.type;
    const img = document.createElement('img'); img.src = `op1r-images/${feature.kind === 'fx' ? 'fx' : 'synth'}_${feature.id}.png`; img.alt = `${feature.name} screen`; img.width = 320; img.height = 160; img.loading = 'lazy';
    const description = document.createElement('span'); description.className = 'feature-description'; description.textContent = feature.description;
    label.append(heading, kind, img, description); $('op1r-engines').querySelector('.feature-grid').append(label);
  }
  update(); status('Choose your original R246 firmware to continue.');
} catch (error) { release = null; status(error.message, true); }
