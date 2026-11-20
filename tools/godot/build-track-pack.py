#!/usr/bin/env python3
"""Downloadable track packs for the Godot app: a circuit's files as a Godot resource pack (.pck) per platform, which the
app downloads, checks and mounts (scripts/game/track_packs.gd). The base builds leave these files out (export_presets.cfg).

    python3 -I tools/godot/build-track-pack.py <track id> <out dir> [--version V]

For each platform ("android": ETC2 / ASTC textures, "pc": S3TC / BPTC) this writes the pack preset into
godot/export_presets.cfg (its file list from PACKS below), exports the pack with the editor (no export templates
needed), then keeps only the pack's own entries: an exported pack also carries every script, project.binary and the
class caches, which mounted over the app would replace its own. Writes <out dir>/<id>-<platform>-<version>.pck and
<out dir>/packs.json (the manifest the app reads: version, file, size, SHA-256 per platform; merged with what is there).

GODOT: the editor binary (default ~/.local/opt/godot/godot)."""
import fnmatch, hashlib, json, os, re, struct, subprocess, sys, time

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PROJ = os.path.join(ROOT, 'godot')
GODOT = os.environ.get('GODOT', os.path.expanduser('~/.local/opt/godot/godot'))

# track id -> the files of its pack (globs under godot/, res:// relative) and what is left out of it; "probe" is a file
# the app checks to tell whether the track is present (bundled or mounted)
PACKS = {
    'spa': {
        # (its collision is still in the old assets/maps/spa/, whose models the web game's Spa used and the app no longer)
        'files': ['assets/maps/spa_g/*', 'assets/maps/spa_g/props/*', 'assets/textures/spa/*', 'assets/vegetation/trees_spa*',
                  'assets/maps/spa/collision.apxc'],
        'skip': ['*.import', '*.uid', 'assets/maps/spa_g/forest_check.png', 'assets/maps/spa_g/forest_pack.*'],
        'probe': 'res://assets/maps/spa_g/map_track.glb',
        'name': 'Spa-Francorchamps',
    },
    # (its look shares Spa's scanned textures, trees and crowd: those come with Spa's pack, as for the Nürburgring GP;
    # without it the circuit keeps the model's own road texture and tree cards)
    'silverstone': {
        'files': ['assets/maps/silverstone/*'],
        'skip': ['*.import', '*.uid'],
        'probe': 'res://assets/maps/silverstone/map_track.glb',
        'name': 'Silverstone',
    },
    'barcelona': {
        'files': ['assets/maps/barcelona/*'],
        'skip': ['*.import', '*.uid'],
        'probe': 'res://assets/maps/barcelona/map_track.glb',
        'name': 'Barcelona-Catalunya',
    },
    'shanghai': {
        'files': ['assets/maps/shanghai/*'],
        'skip': ['*.import', '*.uid'],
        'probe': 'res://assets/maps/shanghai/map_track.glb',
        'name': 'Shanghai',
    },
}
# per platform: its export platform, preset options and the files only the other platform's pack carries
PLATFORMS = {
    'android': {'platform': 'Android', 'options': 'architectures/arm64-v8a=true\npackage/unique_name="app.apexghost.racing.godot"\n',
                'skip': ['*_4k.jpg']},
    'pc': {'platform': 'Linux', 'options': 'binary_format/architecture="x86_64"\n', 'skip': ['*_2k.jpg']},
}
PRESET_TAG = 'Track pack'
# files the app reads itself (FileAccess), not through the resource loader: exported as they are
RAW = ('.bin', '.json', '.apxc')


def pack_files(spec):
    out = []
    for g in spec['files']:
        d = os.path.join(PROJ, os.path.dirname(g))
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            rel = os.path.join(os.path.dirname(g), f)
            if os.path.isfile(os.path.join(PROJ, rel)) and fnmatch.fnmatch(rel, g) and not any(fnmatch.fnmatch(rel, s) for s in spec['skip']):
                out.append(rel)
    return sorted(set(out))


def write_presets(track, files):
    """The pack presets (one per platform) replace any earlier ones of this tool at the end of export_presets.cfg."""
    p = os.path.join(PROJ, 'export_presets.cfg')
    txt = open(p).read()
    # cut every earlier track-pack preset (they come last)
    m = re.search(r'\n\[preset\.(\d+)\]\n\nname="' + PRESET_TAG, txt)
    if m:
        txt = txt[:m.start()]
    n = len(re.findall(r'^\[preset\.\d+\]$', txt, re.M))
    res = [f for f in files if not f.endswith(RAW)]
    raw = [f for f in files if f.endswith(RAW)]
    names = {}
    for k, (plat, spec) in enumerate(PLATFORMS.items()):
        name = f'{PRESET_TAG} {track} ({plat})'
        names[plat] = name
        mine = [f for f in files if not any(fnmatch.fnmatch(f, g) for g in spec['skip'])]
        res = [f for f in mine if not f.endswith(RAW)]
        raw = [f for f in mine if f.endswith(RAW)]
        txt = txt.rstrip('\n') + f'''

[preset.{n + k}]

name="{name}"
platform="{spec['platform']}"
runnable=false
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="resources"
export_files=PackedStringArray({", ".join('"res://' + f + '"' for f in res)})
include_filter="{", ".join(raw)}"
exclude_filter=""
export_path=""
patches=PackedStringArray()
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.{n + k}.options]

{spec['options']}'''
    open(p, 'w').write(txt.rstrip('\n') + '\n')
    return names


def read_pck(path):
    f = open(path, 'rb')
    head = f.read(112)
    assert head[:4] == b'GDPC', path
    fmt, flags = struct.unpack('<I', head[4:8])[0], struct.unpack('<I', head[20:24])[0]
    file_base, dir_off = struct.unpack('<QQ', head[24:40])
    assert fmt == 4, f'pack format {fmt}: this tool reads format 4 (Godot 4.7)'
    f.seek(dir_off)
    ents = []
    for _ in range(struct.unpack('<I', f.read(4))[0]):
        ln = struct.unpack('<I', f.read(4))[0]
        raw = f.read(ln)
        off, size = struct.unpack('<QQ', f.read(16))
        md5 = f.read(16)
        fl = struct.unpack('<I', f.read(4))[0]
        ents.append((raw, off, size, md5, fl))
    base = file_base if flags & 2 else 0
    return head, base, ents, f


# the app's own entries an exported pack also carries: mounted over the app they would replace its scripts, settings
# and caches
APP_OWN = ('*.gdc', '*.gd', '*.gd.remap', '*.gdshader', '*.gdshaderinc', 'project.binary', '.godot/global_script_class_cache.cfg',
           '.godot/uid_cache.bin', '.godot/exported/*', 'icon.png', 'icon.png.import', '.godot/imported/icon.png-*', '*.uid',
           'scenes/*', 'scripts/*', 'data/*', 'tests/*')


def filter_pck(src, dst, files):
    """Everything the export put in for the pack's files (theirs and their dependencies: a glb's extracted textures)
    but the app's own entries (APP_OWN)."""
    head, base, ents, f = read_pck(src)
    keep = [e for e in ents if not any(fnmatch.fnmatch(e[0].rstrip(b'\0').decode(), g) for g in APP_OWN)]
    out = open(dst, 'wb')
    out.write(head)
    new = []
    pos = 0
    for raw, off, size, md5, fl in keep:
        f.seek(base + off)
        out.write(f.read(size))
        new.append((raw, pos, size, md5, fl))
        pos += size
        pad = (-pos) % 32
        out.write(b'\0' * pad)
        pos += pad
    dir_off = 112 + pos
    out.write(struct.pack('<I', len(new)))
    for raw, off, size, md5, fl in new:
        out.write(struct.pack('<I', len(raw)) + raw + struct.pack('<QQ', off, size) + md5 + struct.pack('<I', fl))
    out.seek(32)
    out.write(struct.pack('<Q', dir_off))
    out.close()
    have = {e[0].rstrip(b'\0').decode().removesuffix('.import').removesuffix('.remap') for e in keep}
    missing = sorted(set(files) - have)
    return len(keep), len(ents), missing


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    track, out = sys.argv[1], os.path.abspath(sys.argv[2])
    version = sys.argv[sys.argv.index('--version') + 1] if '--version' in sys.argv else time.strftime('%Y%m%d%H%M')
    spec = PACKS[track]
    os.makedirs(out, exist_ok=True)
    files = pack_files(spec)
    names = write_presets(track, files)
    subprocess.run([GODOT, '--headless', '--path', PROJ, '--import'], capture_output=True)
    mp = os.path.join(out, 'packs.json')
    manifest = json.load(open(mp)) if os.path.exists(mp) else {'format': 1, 'packs': {}}
    entry = {'name': spec['name'], 'version': version, 'probe': spec['probe']}
    for plat, name in names.items():
        tmp = os.path.join(out, f'.{track}-{plat}-full.pck')
        r = subprocess.run([GODOT, '--headless', '--path', PROJ, '--export-pack', name, tmp], capture_output=True, text=True)
        if not os.path.exists(tmp):
            sys.exit(f'export failed for {plat}:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}')
        fn = f'{track}-{plat}-{version}.pck'
        kept, total, missing = filter_pck(tmp, os.path.join(out, fn), [f for f in files if not any(fnmatch.fnmatch(f, g) for g in PLATFORMS[plat]['skip'])])
        os.remove(tmp)
        size = os.path.getsize(os.path.join(out, fn))
        entry[plat] = {'file': fn, 'size': size, 'sha256': sha256(os.path.join(out, fn))}
        print(f'[pack] {fn}: {size / 1e6:.1f} MB, {kept} of {total} entries' + (f'; not in the export: {missing}' if missing else ''))
    manifest['packs'][track] = entry
    json.dump(manifest, open(mp, 'w'), indent=1)
    print(f'[pack] {mp}')


main()
