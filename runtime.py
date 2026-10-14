"""Firmware patch application shared by CPython CLI and browser Pyodide worker.

No compiler, device key, or subprocess is needed here. Release manifests contain
checked byte edits and our added code/screens, never a firmware. Hiding op1r's own
plugins (config "hidden") edits the factory database at patch time and is the only
step that needs sqlite3 (in the standard library, also in Pyodide v314).
"""
import binascii
import copy
import hashlib
import io
import json
import lzma
import struct
import tarfile

LZMA_FILTERS = [{'id': lzma.FILTER_LZMA1, 'preset': 9, 'lc': 3, 'lp': 1,
                 'pb': 2, 'dict_size': 2 ** 23}]
MAX_PACKAGE = 15_000_000
PRODUCT = {"name": "hundekraft", "version": "2.6.1", "label": "hundekraft 2.6.1", "slug": "hundekraft-2.6.1"}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def normalize(config, catalog):
    fields = {'schema', 'base', 'synths', 'effects', 'preset_cap'}
    if not isinstance(config, dict) or not fields <= set(config) <= fields | {'utilities', 'hidden'}:
        raise ValueError('Configuration must contain exactly: ' + ', '.join(sorted(fields)))
    if type(config['schema']) is not int or config['schema'] != 1 or config['base'] != catalog['base']:
        raise ValueError('Unsupported configuration schema or base bundle')
    out = {'schema': 1, 'base': catalog['base']}
    for group in ('synths', 'effects', 'utilities'):
        values = config.get(group, [])
        valid = [f['id'] for f in catalog[group]]
        if (not isinstance(values, list) or any(not isinstance(v, str) for v in values)
                or len(set(values)) != len(values) or any(v not in valid for v in values)):
            raise ValueError('Unknown or duplicate ' + group)
        if group != 'utilities' or values:
            out[group] = [v for v in valid if v in values]
    cap = config['preset_cap']
    if type(cap) is not int or cap not in catalog['preset_caps']:
        raise ValueError('Preset capacity must be 100 or 300')
    out['preset_cap'] = cap
    # op1r's own synths/FX to leave out of the picker lists; kept only when non-empty, so IDs and variants of
    # configurations without it stay as they were.
    hidden = config.get('hidden', [])
    valid = [f['id'] for f in catalog.get('op1r_plugins', [])]
    if (not isinstance(hidden, list) or any(not isinstance(v, str) for v in hidden)
            or len(set(hidden)) != len(hidden) or any(v not in valid for v in hidden)):
        raise ValueError('Unknown or duplicate hidden plugins')
    if hidden:
        out['hidden'] = [v for v in valid if v in hidden]
    return out


def without_hidden(config):
    """The prebuilt variant a configuration is patched from (hiding is applied on top of it)."""
    return {k: v for k, v in config.items() if k != 'hidden'}


def config_id(config, catalog):
    c = normalize(config, catalog)
    flags = [f['id'] in c[g] for g in ('synths', 'effects') for f in catalog[g]]
    flags.append(c['preset_cap'] == 300)
    flags.extend(f['id'] in c.get('utilities', []) for f in catalog.get('utilities', []))
    mask = sum(int(v) << i for i, v in enumerate(flags))
    # Fixed position, so a shorter utilities list (public catalog) cannot move these bits.
    bit = catalog.get('op1r_plugins_bit', 0)
    for i, f in enumerate(catalog.get('op1r_plugins', [])):
        if f['id'] in c.get('hidden', []):
            mask |= 1 << (bit + i)
    return f'{mask:02x}'


def unpack(op1):
    if len(op1) < 8 or len(op1) >= MAX_PACKAGE:
        raise ValueError('Invalid firmware size')
    if struct.unpack('<I', op1[:4])[0] != binascii.crc32(op1[4:]):
        raise ValueError('Firmware CRC-32 mismatch')
    raw = lzma.decompress(op1[4:], format=lzma.FORMAT_ALONE)
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = [(m, archive.extractfile(m).read() if m.isfile() else None)
                   for m in archive.getmembers()]
    if len({m.name for m, _ in members}) != len(members):
        raise ValueError('Duplicate archive paths')
    return members


def pack_tar(members):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.GNU_FORMAT) as archive:
        for info, data in members:
            info = copy.copy(info)
            if data is not None:
                info.size = len(data)
            archive.addfile(info, io.BytesIO(data) if data is not None else None)
    return buf.getvalue()


def pack_op1(raw):
    comp = lzma.compress(raw, format=lzma.FORMAT_ALONE, filters=LZMA_FILTERS)
    out = struct.pack('<I', binascii.crc32(comp)) + comp
    if len(out) >= MAX_PACKAGE:
        raise ValueError('Firmware exceeds the updater package limit')
    return out


def checked(data, expected, label):
    if sha256(data) != expected:
        raise ValueError(label + ': SHA-256 mismatch')
    return data


def apply_manifest(members, manifest, read_blob):
    members = list(members)
    by_name = {m.name: i for i, (m, _) in enumerate(members)}
    for entry in manifest['patched_files']:
        name = entry['path']
        if name not in by_name:
            raise ValueError('Missing firmware member: ' + name)
        i = by_name[name]
        info, data = members[i]
        buf = bytearray(checked(data, entry['orig_sha256'], name))
        for op in entry['ops']:
            off = op['offset']
            if type(off) is not int or not 0 <= off <= len(buf):
                raise ValueError('Patch offset out of bounds')
            if op['op'] == 'replace':
                old, new = bytes.fromhex(op['old']), bytes.fromhex(op['new'])
                if len(old) != len(new) or buf[off:off + len(old)] != old:
                    raise ValueError(name + ': unexpected bytes at patch site')
                buf[off:off + len(old)] = new
            elif op['op'] == 'insert':
                blob = checked(read_blob(op['blob']), op['sha256'], op['blob'])
                if len(blob) != op['size']:
                    raise ValueError('Patch blob size mismatch')
                buf[off:off] = blob
            elif op['op'] == 'truncate':
                del buf[off:]
            else:
                raise ValueError('Unknown patch operation')
        members[i] = (info, checked(bytes(buf), entry['result_sha256'], name))
    for entry in manifest['added_files']:
        name = entry['path']
        if name in by_name:
            raise ValueError('Duplicate added member: ' + name)
        data = (members[by_name[entry['copy_of']]][1] if 'copy_of' in entry
                else read_blob(entry['blob']))
        checked(data, entry['sha256'], name)
        info = copy.copy(members[by_name[entry['template']]][0])
        info.name = name
        by_name[name] = len(members)
        members.append((info, data))
    checked(pack_tar(members), manifest['result']['tar_sha256'], 'Result archive')
    return members


def validate_ldr(data):
    off, finals = 0, 0
    while off < len(data):
        h = data[off:off + 16]
        if len(h) != 16 or h[3] != 0xAD:
            raise ValueError('Invalid LDR header')
        checksum = 0
        for b in h:
            checksum ^= b
        if checksum:
            raise ValueError('Invalid LDR header checksum')
        flags, addr, count, arg = struct.unpack('<IIII', h)
        if off == 0 and (not flags & 0x4000 or arg != len(data) - 16):
            raise ValueError('Invalid FIRST block length')
        off += 16 + (0 if flags & 0x100 else count)
        if flags & 0x8000:
            finals += 1
            # R246 carries one more data block after FINAL; preserve its order.
    if off != len(data) or finals != 1:
        raise ValueError('Invalid LDR block chain')


def hide_plugins(db, catalog, hidden):
    """factory DB bytes -> without the picker rows of these op1r synths/FX (their code stays, so saved sounds that
    use them still load). Each row must exist exactly once."""
    import os, sqlite3, tempfile
    kinds = {f['id']: f['kind'] for f in catalog.get('op1r_plugins', [])}
    fd, path = tempfile.mkstemp(suffix='.db')
    try:
        os.write(fd, db)
        os.close(fd)
        con = sqlite3.connect(path)
        for name in hidden:
            table = 'fx_types' if kinds[name] == 'fx' else 'synth_types'
            if con.execute(f'DELETE FROM {table} WHERE type=?', (name,)).rowcount != 1:
                raise ValueError('Base does not list ' + name)
        con.commit()
        if con.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            raise ValueError('Database integrity check failed')
        con.close()
        with open(path, 'rb') as f:
            return f.read()
    finally:
        os.remove(path)


def apply_hidden(members, catalog, hidden):
    if not hidden:
        return members
    out = []
    for info, data in members:
        if info.name == 'content/op1_factory.db':
            info = copy.copy(info)
            data = hide_plugins(data, catalog, hidden)
            info.size = len(data)
        out.append((info, data))
    return out


def patch(op1, base, variant, read_base, read_variant, log=lambda s: None, catalog=None, hidden=()):
    checked(op1, base['original']['sha256'], 'Select the original, unmodified R246 firmware')
    log('Verified original R246. Applying ' + variant['config']['base'] + '…')
    original = unpack(op1)
    members = apply_manifest(original, base, read_base)
    log('Applying selected features…')
    members = apply_manifest(members, variant, read_variant)
    files = {m.name: data for m, data in members}
    validate_ldr(files['OP1_vdk.ldr'])
    if files['te-boot.ldr'] != dict((m.name, d) for m, d in original)['te-boot.ldr']:
        raise ValueError('Bootloader changed')
    raw = pack_tar(members)
    checked(raw, variant['result']['tar_sha256'], 'Selected features')
    if hidden:
        log('Hiding ' + ', '.join(hidden) + '…')
        members = apply_hidden(members, catalog, hidden)
        raw = pack_tar(members)
    log('Compressing and verifying your firmware…')
    out = pack_op1(raw)
    # Verify the compressed stream as well as the exact archive before handing it out.
    checked(lzma.decompress(out[4:], format=lzma.FORMAT_ALONE), sha256(raw), 'Output')
    config = dict(variant['config'], **({'hidden': list(hidden)} if hidden else {}))
    report = {'schema': 1, 'config': config, 'release': variant['release'],
              'product': variant['release'].get('product'),
              'upstream': {'stock': 'R246', 'op1r': variant['config']['base'],
                           'op1r_commit': variant['release']['op1r_commit'],
                           'maiko': '#249' if variant['config'].get('utilities') else None},
              'filename': variant.get('filename'),
              'input_sha256': sha256(op1), 'output_sha256': sha256(out),
              'tar_sha256': sha256(raw), 'bytes': len(out), 'presets': variant.get('presets')}
    return out, report
