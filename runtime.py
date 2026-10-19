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
PRODUCT = {"name": "hundekraft", "version": "2.8", "label": "hundekraft 2.8", "slug": "hundekraft-2.8"}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def normalize(config, catalog):
    fields = {'schema', 'base', 'synths', 'effects', 'preset_cap'}
    if not isinstance(config, dict) or not fields <= set(config) <= fields | {'utilities', 'hidden', 'lander'}:
        raise ValueError('Configuration must contain exactly: ' + ', '.join(sorted(fields)))
    if type(config['schema']) is not int or config['schema'] != 1 or config['base'] != catalog['base']:
        raise ValueError('Unsupported configuration schema or base bundle')
    out = {'schema': 1, 'base': catalog['base']}
    if 'lander' in config:
        if type(config['lander']) is not bool or not any(f['id'] == 'lander' for f in catalog.get('core_options', [])):
            raise ValueError('Unsupported Lander option')
        if config['lander']:
            out['lander'] = True

    for group in ('synths', 'effects', 'utilities'):
        values = config.get(group, [])
        valid = [f['id'] for f in catalog[group]]
        if (not isinstance(values, list) or any(not isinstance(v, str) for v in values)
                or len(set(values)) != len(values) or any(v not in valid for v in values)):
            raise ValueError(f'Unknown or duplicate {group}: ' + ', '.join(_bad(values, valid)))
        if group != 'utilities' or values:
            out[group] = [v for v in valid if v in values]
    cap = config['preset_cap']
    if type(cap) is not int or cap not in catalog['preset_caps']:
        raise ValueError('Preset capacity must be ' + ' or '.join(map(str, catalog['preset_caps'])))
    out['preset_cap'] = cap
    # op1r's own synths/FX to leave out of the picker lists; kept only when non-empty, so IDs and variants of
    # configurations without it stay as they were.
    hidden = config.get('hidden', [])
    valid = [f['id'] for f in catalog.get('op1r_plugins', [])]
    if (not isinstance(hidden, list) or any(not isinstance(v, str) for v in hidden)
            or len(set(hidden)) != len(hidden) or any(v not in valid for v in hidden)):
        raise ValueError('Unknown or duplicate hidden plugins: ' + ', '.join(_bad(hidden, valid)))
    if hidden:
        out['hidden'] = [v for v in valid if v in hidden]
    entries = {f['id']: f for g in ('synths', 'effects', 'utilities', 'op1r_plugins') for f in catalog.get(g, [])}
    if any(entries[v].get('always') for v in hidden):
        raise ValueError('Core plugins cannot be left out')
    if any(entries[v].get('reserved') for v in hidden):
        raise ValueError('Removed plugins: ' + ', '.join(v for v in hidden if entries[v].get('reserved')))
    on = {i for g in ('synths', 'effects', 'utilities') for i in out.get(g, [])} | \
        {v for v in valid if v not in hidden and not entries[v].get('reserved')}
    for i in on:
        if not set(entries.get(i, {}).get('needs', [])) <= on:
            raise ValueError(i + ' needs ' + ', '.join(entries[i]['needs']))
    return out


def path_ok(p):
    """A path the SysEx update may send, delete or match: web/firmware/op1push.js pathOk and devupd's du_path_ok."""
    import re
    if not p or len(p) >= 96 or not re.fullmatch(r'[A-Za-z0-9_./-]+', p) or p.startswith('/') or p.endswith('/'):
        return False
    if re.search(r'te-boot|te_boot|teboot', p, re.I) or '..' in p or '//' in p:
        return False
    return p == 'OP1_vdk.ldr' or p.startswith('content/') or re.fullmatch(r'plugins/[^/.][^/]*\.(knl|op1p)', p) is not None


def _bad(values, valid):
    """the entries of a configuration list that normalize refuses (unknown ids, repeats), for the message"""
    if not isinstance(values, list):
        return [repr(values)]
    seen, out = set(), []
    for v in values:
        if not isinstance(v, str) or v not in valid or v in seen:
            out.append(repr(v))
        if isinstance(v, str):
            seen.add(v)
    return out


def without_hidden(config):
    """The prebuilt variant a configuration is patched from (hiding is applied on top of it)."""
    return {k: v for k, v in config.items() if k != 'hidden'}


def file_choices(catalog):
    """{id: (group, file)} for the choices that are plugin files in content/ on this base (kennel bases; the catalog
    entries carry 'file'), {} on 2.x bases. synths / effects / utilities are in when listed, op1r_plugins (which on
    kennel bases holds every other file choice) are in unless listed in 'hidden'."""
    out = {}
    for group in ('synths', 'effects', 'utilities', 'op1r_plugins'):
        for f in (catalog or {}).get(group, []):
            names = entry_files(f)
            if names:
                out[f['id']] = (group, names[0])
    return out


def saved_name(f):
    """The type name saved sounds and the factory DB use for a catalog entry: 'saved' on kennel bases, whose ids
    follow kennel's naming rule (in_a_room -> "in a room"); on 2.x the id is the saved name."""
    return f.get('saved', f['id'])


def entry_files(f):
    """The plugin files of one catalog choice: 'file', plus 'files' when one choice ships several (a group)."""
    return ([f['file']] if f.get('file') else []) + [n for n in f.get('files', []) if n != f.get('file')]


def files(config, catalog):
    """The plugin file names (content/<name>) a normalized configuration ships. 'always' choices always ship."""
    hidden = config.get('hidden', [])
    out = set()
    for group in ('synths', 'effects', 'utilities', 'op1r_plugins'):
        for f in (catalog or {}).get(group, []):
            on = f.get('always') or (f['id'] not in hidden if group == 'op1r_plugins' else f['id'] in config.get(group, []))
            if on:
                out.update(entry_files(f))
    return out


def variant_config(config, catalog):
    """The prebuilt variant a normalized configuration is patched from: without hidden op1r plugins, and with every
    choice that is a plugin file on (patch() leaves out the files not chosen). config_id of the configuration itself
    keeps the real bits. On 2.x bases this is without_hidden()."""
    c = without_hidden(config)
    choices = file_choices(catalog)
    for group in ('synths', 'effects', 'utilities'):
        ids = [f['id'] for f in catalog.get(group, [])] if choices else []
        if any(i in choices for i in ids):
            on = [i for i in ids if i in choices or i in c.get(group, [])]
            if on or group != 'utilities':            # normalize leaves out an empty utilities list
                c[group] = on
    return normalize(c, catalog) if choices else c   # key order as normalize gives it (config.json in the pack)


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
    if c.get('lander'):
        mask |= 1 << 64  # separate from every published plugin/legacy selection bit
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
    # te-boot recreates listed directories recursively. Only transient updater
    # state may be cleared by a full package; never user data or user plugins.
    for entry in manifest.get('added_directories', []):
        name = entry['path']
        if name not in ('op1r_stage', 'kennel_recovery') or name in by_name:
            raise ValueError('Invalid install cleanup directory: ' + name)
        source, data = members[by_name[entry['template']]]
        if not source.isdir() or data is not None:
            raise ValueError('Install cleanup template is not a directory')
        info = copy.copy(source); info.name = name
        by_name[name] = len(members); members.append((info, None))
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


def hide_plugins(db, catalog, hidden, optional=()):
    """factory DB bytes -> without the picker rows of these synths/FX. hidden: each row must exist exactly once
    (op1r plugins whose code stays). optional: rows removed when the base has them (plugin files left out)."""
    import os, sqlite3, tempfile
    kinds = {f['id']: f['kind'] for f in catalog.get('op1r_plugins', [])}
    kinds.update({f['id']: 'synth' for f in catalog.get('synths', [])})
    kinds.update({f['id']: 'fx' for f in catalog.get('effects', [])})
    saved = {f['id']: saved_name(f) for g in ('synths', 'effects', 'op1r_plugins') for f in catalog.get(g, [])}
    fd, path = tempfile.mkstemp(suffix='.db')
    try:
        os.write(fd, db)
        os.close(fd)
        con = sqlite3.connect(path)
        for name in hidden:
            table = 'drum_types' if kinds[name] == 'drum' else ('seq_types' if kinds[name] == 'seq' else ('fx_types' if kinds[name] == 'fx' else 'synth_types'))
            if con.execute(f'DELETE FROM {table} WHERE type=?', (saved[name],)).rowcount != 1:
                raise ValueError('Base does not list ' + name)
        for name in optional:
            table = 'drum_types' if kinds[name] == 'drum' else ('seq_types' if kinds[name] == 'seq' else ('fx_types' if kinds[name] == 'fx' else 'synth_types'))
            con.execute(f'DELETE FROM {table} WHERE type=?', (saved[name],))
        for name in list(hidden) + list(optional):
            if kinds.get(name) == 'drum': con.execute('DELETE FROM drum_presets WHERE folder=?', (saved[name],))
        con.commit()
        if con.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            raise ValueError('Database integrity check failed')
        con.close()
        with open(path, 'rb') as f:
            return f.read()
    finally:
        os.remove(path)


def left_out_rows(config, catalog):
    """synth / FX / sequencer plugin files a configuration leaves out: their picker rows go too where the base has them
    (kennel keeps rows for numbered plugins), so the OP-1 never lists a type whose file isn't there."""
    shipped = files(config, catalog)
    kinds = {f['id']: f['kind'] for f in catalog.get('op1r_plugins', [])}
    kinds.update({f['id']: 'synth' for f in catalog.get('synths', [])})
    kinds.update({f['id']: 'fx' for f in catalog.get('effects', [])})
    return [i for i, (_, name) in file_choices(catalog).items() if name not in shipped and kinds.get(i) in ('synth', 'fx', 'seq', 'drum')]


def apply_hidden(members, catalog, hidden, optional=()):
    if not hidden and not optional:
        return members
    out = []
    for info, data in members:
        if info.name == 'content/op1_factory.db':
            info = copy.copy(info)
            data = hide_plugins(data, catalog, hidden, optional)
            info.size = len(data)
        out.append((info, data))
    return out


def patch(op1, base, variant, read_base, read_variant, log=lambda s: None, catalog=None, hidden=(), config=None):
    """config: the normalized configuration (its variant is variant_config of it). Its hidden op1r plugins without a
    file lose their picker rows; plugin files it doesn't choose are left out. Without config, hidden is used as given."""
    choices = file_choices(catalog)
    if config is not None:
        hidden = [h for h in config.get('hidden', []) if h not in choices]
    checked(op1, base['original']['sha256'], 'Select the original, unmodified R246 firmware')
    log('Verified original R246. Applying ' + variant['config']['base'] + '…')
    original = unpack(op1)
    members = apply_manifest(original, base, read_base)
    log('Applying selected features…')
    members = apply_manifest(members, variant, read_variant)
    by_name = {m.name: data for m, data in members}
    validate_ldr(by_name['OP1_vdk.ldr'])
    if by_name['te-boot.ldr'] != dict((m.name, d) for m, d in original)['te-boot.ldr']:
        raise ValueError('Bootloader changed')
    raw = pack_tar(members)
    checked(raw, variant['result']['tar_sha256'], 'Selected features')
    rows = left_out_rows(config, catalog) if config is not None and choices else []
    if hidden or rows:
        log('Hiding ' + ', '.join(list(hidden) + rows) + '…')
        members = apply_hidden(members, catalog, hidden, rows)
        raw = pack_tar(members)
    # plugin files (kennel): the variant has every file choice on; leave out the ones not chosen
    drop = set()
    if config is not None and choices:
        if variant['config'] != variant_config(config, catalog):
            raise ValueError('Configuration does not match the patch')
        drop = {'content/' + n for n in files(variant['config'], catalog) - files(config, catalog)}
    if drop:
        if not drop <= {m.name for m, _ in members}:
            raise ValueError('Variant lacks plugin files')
        log('Leaving out ' + ', '.join(sorted(n[8:] for n in drop)) + '…')
        members = [(m, d) for m, d in members if m.name not in drop]
        raw = pack_tar(members)
    log('Compressing and verifying your firmware…')
    out = pack_op1(raw)
    # Verify the compressed stream as well as the exact archive before handing it out.
    checked(lzma.decompress(out[4:], format=lzma.FORMAT_ALONE), sha256(raw), 'Output')
    config = config if config is not None and choices else dict(variant['config'], **({'hidden': list(hidden)} if hidden else {}))
    filename = variant.get('filename')
    if filename and catalog and filename.endswith('.op1'):
        prefix, sep, _ = filename[:-4].rpartition('-')
        if sep:
            filename = prefix + '-' + config_id(config, catalog) + '.op1'
    report = {'schema': 1, 'config': config, 'release': variant['release'],
              'product': variant['release'].get('product'),
              'upstream': {'stock': 'R246', 'op1r': variant['config']['base'],
                           'op1r_commit': variant['release']['op1r_commit'],
                           'maiko': ('kennel utilities' if config['base'].startswith('kennel') else '#249') if config.get('utilities') else None},
              'filename': filename,
              'input_sha256': sha256(op1), 'output_sha256': sha256(out),
              'tar_sha256': sha256(raw), 'bytes': len(out), 'presets': variant.get('presets')}
    return out, report


# ---- preset packs: one writer and one rule for the builder and the browser ----

PRESET_DATE = (2026, 10, 12, 0, 0, 0)


def preset_install_text(count, cap):
    return (f'Hundekraft preset collection — {count} patches for this configuration.\n\n'
            'Install the matching firmware first. Enter disk mode (Shift + COM, then T3).\n'
            'Copy the folders inside synth/ into the OP-1 disk’s synth/ directory, then eject.\n'
            'The OP-1 restarts by itself, syncs the new files and waits for a key press. Presets are separate from firmware.\n'
            f'Your firmware supports {cap} user synth presets TOTAL, including existing ones.\n'
            + ('This pack exceeds that limit: enable 300 presets or install only a subset.\n' if count > cap else '')
            + 'Granular presets are settings: load or record a sample into the slot first.\n'
            'Washer/Snowglobe sounds are synth patches using those effects; they are not standalone FX presets.\n'
            'An existing patch with the same filename may keep its old sound after sync; use a fresh name to replace it.\n')


def preset_zip(patches, config):
    """[(engine type, name, .aif bytes)] -> presets.zip bytes (fixed dates: the same patches give the same bytes)."""
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as archive:
        def write(name, data):
            info = zipfile.ZipInfo(name, date_time=PRESET_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
        for kind, name, data in patches:
            write(f'synth/{kind}/{name}.aif', data)
        write('INSTALL.txt', preset_install_text(len(patches), config['preset_cap']).encode())
        write('config.json', (json.dumps(config, indent=2) + '\n').encode())
    return buf.getvalue()


def preset_meta(aif):
    """The patch JSON of an OP-1 .aif (APPL chunk "op-1" + JSON)."""
    at = aif.find(b'APPL')
    if at < 0:
        raise ValueError('Preset without patch data')
    size = struct.unpack('>I', aif[at + 4:at + 8])[0]
    body = aif[at + 8:at + 8 + size]
    if not body.startswith(b'op-1'):
        raise ValueError('Preset without patch data')
    return json.loads(body[4:].split(b'\0')[0].strip().decode())


def preset_effect(meta):
    """Only active processing is a preset dependency; off slots retain their last type."""
    return meta.get('fx_type') if meta.get('fx_active', True) else None


def preset_keep(kind, fx_type, config, catalog):
    """Kennel bases: a preset ships when its engine is in the build and its effect isn't left out.
    Engines: iter, the listed synths, and every op1r_plugins synth that isn't hidden (file or compiled in)."""
    hidden = set(config.get('hidden', []))
    plugins = catalog.get('op1r_plugins', [])
    # presets name engines and effects by their saved (type) names
    engines = {'iter'} | {saved_name(f) for f in catalog['synths'] if f['id'] in config['synths']} | \
        {saved_name(f) for f in plugins if f['kind'] == 'synth' and f['id'] not in hidden}
    left_out_fx = {saved_name(f) for f in catalog['effects'] if f['id'] not in config['effects']} | \
        {saved_name(f) for f in plugins if f['kind'] == 'fx' and f['id'] in hidden}
    return kind in engines and fx_type not in left_out_fx


def filter_preset_zip(data, config, catalog):
    """The variant's pack (made for variant_config(config)) -> the pack for config itself. 2.x bases: unchanged."""
    if not file_choices(catalog):
        return data
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        patches = []
        for name in archive.namelist():
            if name.startswith('synth/') and name.endswith('.aif'):
                _, kind, file = name.split('/', 2)
                aif = archive.read(name)
                if preset_keep(kind, preset_effect(preset_meta(aif)), config, catalog):
                    patches.append((kind, file[:-4], aif))
    return preset_zip(patches, config)


def preset_info(data, cap):
    """count / by_engine / sha256 / exceeds_cap / items ([engine, fx_type or ''] per preset, in pack order) of a pack"""
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        items = [[name.split('/')[1], preset_effect(preset_meta(archive.read(name))) or '']
                 for name in archive.namelist() if name.startswith('synth/') and name.endswith('.aif')]
    counts = {}
    for kind, _ in items:
        counts[kind] = counts.get(kind, 0) + 1
    return {'count': len(items), 'by_engine': counts, 'sha256': sha256(data), 'exceeds_cap': len(items) > cap,
            'items': items}
