// DX voice banks on a connected OP-1 (kennel devupd capability 64, docs/sysex-update.md "DX voice banks"): .syx files
// for the DX engine, sent to user/dx/ and removed again. They go in at the restart (T1 on the OP-1), like plugin files.
// The OP-1 has no list of its banks, so the page remembers the names it sent from this browser (names only, never the
// bytes). Shown when the OP-1 reports the capability and has the DX engine.
// Copyright (C) 2026 Hundekraft. GPL-3.0-or-later.
import {push, dxPath, DX_BANK, DX_VOICE, DX_NAME, DX_MAX_BANKS} from './op1push.js?v=3.3-presets-20261113';

// what a .syx file is: {voices: 32 | 1} for a DX7 32-voice bulk dump or a single-voice dump the engine reads
// (plugins/dx/dx_bank.c syx_check_bank32 / syx_check_voice1), else {error: why not}
export function syxInfo(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = d.length.toLocaleString('en-US');
  if (d.length !== DX_BANK && d.length !== DX_VOICE)
    return {error: `not a voice bank. A bank is 4,104 bytes and a single voice 163, but this file is ${n}`};
  const bank = d.length === DX_BANK, head = bank ? [0xF0, 0x43, null, 0x09, 0x20, 0x00] : [0xF0, 0x43, null, 0x00, 0x01, 0x1B];
  if (head.some((b, i) => b !== null && d[i] !== b) || d[2] > 0x0F || d[d.length - 1] !== 0xF7)
    return {error: 'not a DX7 voice dump (the header is wrong)'};
  const len = bank ? 4096 : 155;
  let sum = 0;
  for (let i = 6; i < 6 + len; i++) sum += d[i] & 0x7F;
  if ((-sum & 0x7F) !== d[6 + len]) return {error: 'the checksum doesn’t match, so the file is probably damaged'};
  return {voices: bank ? 32 : 1};
}

// a file of several 32-voice banks back to back (n x 4,104 bytes, each starting F0 43): the banks, else null
export function splitBanks(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = d.length / DX_BANK;
  if (!Number.isInteger(n) || n < 2) return null;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const b = d.subarray(i * DX_BANK, (i + 1) * DX_BANK);
    if (b[0] !== 0xF0 || b[1] !== 0x43) return null;
    parts.push(b.slice());
  }
  return parts;
}

// a bank name the OP-1 takes: lower case, a-z 0-9 _ -, at most 13 characters (the engine's bank name)
export function bankName(s) {
  const t = String(s ?? '').toLowerCase().replace(/\.syx$/, '').replace(/[øœæßþð]/g, c => ({ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss', þ: 'th', ð: 'd'})[c])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, DX_NAME).replace(/[_-]+$/, '');
  return t || 'bank';
}
export const bankPath = name => `user/dx/${name}.syx`;

// the names sent from this browser (localStorage; may be unavailable: then nothing is remembered)
const STORE = 'hundekraft-dx-banks';
// (globalThis.localStorage itself throws where site data is blocked, so it is read inside the try)
export function loadSent(storage) {
  try { const v = JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORE) || '[]'); return Array.isArray(v) ? v.filter(n => dxPath(bankPath(n))) : []; }
  catch { return []; }
}
export function saveSent(names, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORE, JSON.stringify([...new Set(names)].sort())); } catch { /* blocked: not remembered */ }
}

// what a send would leave: the problem with each add (or '' when it can go), and the bank count after it
export function planBanks(adds, sent, removing = []) {
  const names = adds.map(a => a.name), keep = sent.filter(n => !removing.includes(n));
  const problems = adds.map((a, i) => a.info.error || (!dxPath(bankPath(a.name)) ? 'name not allowed' :
    names.indexOf(a.name) !== i ? 'same name as another file here' : ''));
  const total = new Set([...keep, ...adds.filter((a, i) => !problems[i]).map(a => a.name)]).size;
  return {problems, total, tooMany: total > DX_MAX_BANKS};
}

// The DX part of the presets section (presets.js draws it): the banks sent from this browser, their marks, and the send
// path. `onChange` redraws the section. Banks go in at the restart, so a send ends with the OP-1 restarting (T1).
export function initDxBanks({log = () => {}, onChange = () => {}} = {}) {
  const state = {sent: loadSent(), marked: new Set(), available: false};

  return {
    // after the page connected: this OP-1 takes banks and has the DX engine
    connected(inv) {
      state.available = !!inv?.dxBanks && !!inv.records?.some(r => r.kind === 'synth' && r.name === 'dx');
      onChange();
      return state.available;
    },
    available: () => state.available,
    sent: () => state.sent,
    marked: () => state.marked,
    mark(name, on) { if (on) state.marked.add(name); else state.marked.delete(name); onChange(); },
    clearMarks() { state.marked.clear(); },
    // a .syx file as rows of the files list: one row, or one per bank when the file holds several banks back to
    // back (named name-1, name-2, ...; each still counts towards the OP-1's bank limit)
    async fromFile(f) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const parts = splitBanks(bytes), base = bankName(f.name);
      if (!parts) return [{kind: 'dx', bytes, info: syxInfo(bytes), name: base}];
      return parts.map((b, i) => {
        const tail = `-${i + 1}`;
        return {kind: 'dx', bytes: b, info: syxInfo(b), name: bankName(base.slice(0, DX_NAME - tail.length) + tail)};
      });
    },
    // problems per add ('' when it can go) and the bank count after the send; `adds` are the dx rows only
    plan: (adds, removing = []) => planBanks(adds, state.sent, removing),
    // send and/or remove banks on an open port. Returns once the OP-1 has been told to restart.
    async send(port, {adds, dels}, status) {
      status('Sending the DX banks…');
      await push(port, adds.map(a => [bankPath(a.name), a.bytes]), {deletes: dels.map(bankPath), log,
        confirm: () => status('Press T1 on the OP–1 to restart and finish. T2 cancels.')});
      state.sent = [...new Set([...state.sent.filter(n => !dels.includes(n)), ...adds.map(a => a.name)])].sort();
      for (const n of dels) state.marked.delete(n);
      saveSent(state.sent);
      onChange();
      status(adds.length ? 'Sent. The OP–1 is restarting, and the DX banks are there when it’s back.' : 'Done. The OP–1 is restarting without those DX banks.');
    },
  };
}
