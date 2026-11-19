// Opus plugin files (kennel's plugin bridge, devupd HELLO capability 128; docs/sysex-update.md "Opus plugin files"):
// the checks and names for an .opmod added in Your plugins. app.js keeps such a file with the other own files (saved in
// this browser per base) and the reviewed plan sends it to opus/<name>.opmod or removes it there, applied at the restart
// (T1). The inventory's "foreign" records say what the OP-1 made of each file at its last start.
// Copyright (C) 2026 Hundekraft. GPL-3.0-or-later.
import {crc32, checkPlugin, pluginInfo} from './op1push.js?v=3.3.1-opmodown-20261118';

export const OPMOD_MAGIC = 0x444D504F, OPMOD_HDR = 0x60, OPMOD_MAX = 512 * 1024;   // opus.h OPMOD_MAX_FILE
export const PER_FILE = 6144, LFO_STATE = 20 * 1024;                               // opus_boot.c kn_foreign_need
const kb = n => `${Math.max(1, Math.round(n / 1024))} KB`;
// a manifest's "cpu N" in percent of a block: N / 5805 (plate 23.7 %, chorus 13.2 %)
export const cpuPercent = n => n == null ? null : Math.round(n / 580.5) / 10;

// What an .opmod is, as far as the page can check it (opus_load.c ol_check's first steps and the boot's refusals that
// need no OP-1): {id, name, author, version, img, zero, lfo, cpu, arena} or {error}
export function opmodInfo(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (d.length < OPMOD_HDR) return {error: 'not an Opus plugin file'};
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), w = i => dv.getUint32(0x10 + 4 * i, true);
  if (dv.getUint32(0, true) !== OPMOD_MAGIC) return {error: 'not an Opus plugin file'};
  if (dv.getUint16(4, true) !== 1 || dv.getUint16(6, true) < OPMOD_HDR) return {error: 'made for a newer plugin format'};
  if (dv.getUint32(8, true) !== d.length) return {error: 'the file is cut short or damaged'};
  if (d.length > OPMOD_MAX) return {error: `too big (${kb(OPMOD_MAX)} at most)`};
  const c = d.slice(); c.fill(0, 12, 16);
  if (crc32(c) !== dv.getUint32(12, true)) return {error: 'damaged (CRC mismatch)'};
  if (w(0) + w(1) > d.length) return {error: 'the file is cut short or damaged'};
  const lines = new TextDecoder().decode(d.subarray(w(0), w(0) + w(1))).split('\n').map(l => /^(\S+)\s+(.*?)\s*$/.exec(l)).filter(Boolean);
  const get = k => lines.find(m => m[1] === k)?.[2] || '';
  const info = {id: get('id'), name: get('name'), author: get('author'), version: get('version'), img: w(3), zero: w(4),
                lfo: lines.some(m => m[1] === 'adds' && m[2].includes('lfo')), cpu: /^\d+$/.test(get('cpu')) ? +get('cpu') : null};
  if (!info.id) return {error: 'damaged: no plugin id'};
  if (!w(3) || !(w(14) & 1)) return {error: 'has no code to run'};
  if (w(19)) return {error: 'patches the OP–1 firmware itself, which hundekraft doesn’t allow'};
  info.arena = opmodArena(info);
  return info;
}
// the plugin memory the OP-1 sets aside for it at boot (kn_foreign_need)
export const opmodArena = i => PER_FILE + (i.lfo ? LFO_STATE : 0) + ((i.img + 63) & ~31) + ((i.zero + 63) & ~31);

// the path a picked file goes to: opus/<name>.opmod, the name in lower case, a-z 0-9 _ -, at most 33 characters
export function opmodPath(fileName) {
  const stem = String(fileName ?? '').toLowerCase().replace(/\.opmod$/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 33).replace(/[_-]+$/, '');
  return `opus/${stem || 'plugin'}.opmod`;
}
// the bridge's files in an inventory: [{name, path, version, author, size, state, reason, cpu, bundled}]
export const opusRecords = inv => (inv?.records || []).filter(r => r.source === 'foreign')
  .map(r => ({...r, bundled: r.path?.startsWith('content/')}));
export const OPUS_STATE = {loaded: 'running', failed: 'not loaded', skipped: 'skipped at the last start', off: 'switched off'};

// A file added in Your plugins (addOwn, and again on restore): an .opmod gets opmodInfo's checks and goes to
// opus/<name>.opmod, anything else is checkPlugin's. -> {path, info (pluginInfo), opmod (opmodInfo, .opmod only)};
// throws an Error that says what's wrong
export function checkOwnFile(fileName, d, max) {
  if (!/\.opmod$/i.test(fileName)) return checkPlugin(fileName, d, max);
  const opmod = opmodInfo(d);
  if (opmod.error) throw Error(`${fileName}: ${opmod.error}`);
  const path = opmodPath(fileName);
  return {path, info: pluginInfo(path, d), opmod};
}
// The plugin memory of the opus/ files in Your plugins (the workshop's content/ files are counted from the release):
// own = [[path, bytes]] listed here, records = the OP-1's opus/ records, removing = paths staged for removal. A file
// already on the OP-1 that isn't listed counts as its size plus the per-file allowance: the page doesn't have its
// header, so the bar can read a little low for it. A file the OP-1 refused at its last start isn't counted.
export function opusArena(own, records = [], removing = []) {
  const listed = own.filter(([p]) => p.startsWith('opus/'));
  const paths = new Set(listed.map(([p]) => p));
  return listed.reduce((n, [, d]) => n + (opmodInfo(d).arena || 0), 0) +
    records.filter(r => r.path?.startsWith('opus/') && !paths.has(r.path) && !removing.includes(r.path) && r.state !== 'failed')
      .reduce((n, r) => n + PER_FILE + (r.size || 0), 0);
}
