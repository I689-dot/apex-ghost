#!/usr/bin/env python3
"""The Godot app's new car line-up (docs/prompts/spa-and-cars-rebuild.md, milestone 6) from the downloaded models:
each car keeps the id, physics, engine sound and bot setup of the car it replaces, and gets new models.

    python3 -I tools/godot/build-cars.py <extracted cars dir> [--car <id>] [--keep-going]

Per car (CARS below):
  1. tools/godot/car_prep.py (Blender): material names back, the zip's livery on, placeholder decals off
  2. tools/asset-pipeline/blender/convert_car.py (Blender, the web pipeline's converter, read-only use): metres,
     +Z forward, the wheel / steering-wheel nodes, metadata (wheels, steering, driver's eye, lights) and a thumbnail
  3. tools/godot/car-lods.mjs: cockpit.glb, lod0..2.glb
  4. godot/assets/cars/<id>/ replaced, godot/data/cars.json updated: the entry's model fields from the new metadata,
     its specs, info, colour and role kept (the replaced car's physics)
Intermediates in ~/apex-ghost-sources/cars-out/ (outside the repo: the models are for this private game only).
Then it imports the models into the Godot project, with Godot's own generated mesh LODs off for the car files
(patch_imports: they turned curves into facets on top of ours)."""
import json, os, shutil, subprocess, sys, time

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
BLENDER = os.path.expanduser(os.environ.get('BLENDER', '~/.local/opt/blender-4.2.3-linux-x64/blender'))
WORK = os.path.expanduser('~/apex-ghost-sources/cars-out')
CARS_JSON = os.path.join(ROOT, 'godot/data/cars.json')

# id -> {zip folder, model (relative to it), prep settings ("{tex}" is the zip's textures/ folder), name}
CARS = {
    '2020_audi_r8_lms_evo': {'dir': '2020-audi-r8-lms-evo', 'model': 'source/audi_r8_evo_acc_loda_sprint_2.glb',
        'prep': {'rename': True, 'hide': ['^Numberplate_'], 'livery': [
            ['EXT_Carpaint_Inst|EXT_CARPAINT_CARBON', '{tex}/EXT_Skin_Colour.png', 'replace', 'flip'],
            ['EXT_Banner_EXT_Banner', '{tex}/EXT_Banner_Colour.png', 'replace', 'flip']]}},
    '2020_mclaren_720s_gt3': {'dir': '2020-mclaren-720s-gt3', 'model': 'source/mclaren_720s_gt3_2.glb', 'prep': {'rename': True}},
    # the Manthey #91 livery: a decal sheet over the paint
    '2024_porsche_992_gt3_r': {'dir': '2024-porsche-992-gt3-r', 'model': 'source/porsche_992_gt3_r.glb', 'prep': {'rename': True, 'hide': ['^Numberplate_'], 'livery': [
        ['EXT_Carpaint_Inst', '{tex}/decals.png', 'over', 'flip']]}},
    'bmw_m4_gt3_evo_2026': {'dir': '2026-bmw-m4-gt3-evo', 'model': 'source/M4_GT3_EVO_46.glb', 'prep': {'rename': True}},
    'bmw_m4_gt3_vecarz': {'dir': 'bmw-m4-gt3', 'model': 'inner/bmw_m4_gt3__www.vecarz.com.glb', 'prep': {'rename': True}},
    # a Sketchfab export (anonymous objects and materials): its wheel parts named by material
    'ferrari_296_gt3_verstappen': {'dir': 'ferrari-296-gt3-wwwvecarzcom', 'model': 'source/ferrari_296_gt3.glb', 'prep': {'rename': True,
        'name_by_material': {'mat_75': 'Tyre', 'mat_235': 'Rim', 'mat_36': 'Rim_hub', 'mat_232': 'Caliper'}, 'align': '^Tyre_'},
        'name': 'Ferrari 296 GT3'},
    'ford_mustang_gt3': {'dir': 'ford-mustang-gt3-2024', 'model': 'inner/ford_mustang_gt3_2024__www.vecarz.com.glb', 'prep': {'rename': True}},
    # (the eye search put the eye 0.50 m out, behind the cage's padding: in line with the steering wheel instead)
    'mercedes_amg_gt3_evo': {'dir': 'mercedes-amg-gt3-evo-2020-wwwvecarzcom', 'model': 'source/2020_mercedes-amg_gt3_evo.glb', 'prep': {'rename': True},
        'eye': [0.42, 1.05, -0.62]},
    # the white NASA / DTM AMG Evo (user's choice: the Red Bull AMG's id, shown as the AMG GT3 EVO)
    'mercedes_amg_gt3_red_bull_racing': {'dir': 'mercedes-amg-gt3-wwwvecarzcom', 'model': 'source/amg_evo_3.glb', 'prep': {'rename': True, 'hide': ['^Numberplate_'], 'livery': [
        ['EXT_Carpaint_Inst', '{tex}/EXT_Skin_Colour.png', 'replace', 'flip'],
        ['EXT_Banner', '{tex}/EXT_Banner_Colour.png', 'replace', 'flip']]},
        'name': 'Mercedes-AMG GT3 EVO · NASA'},
}
# what stays besides the nine (the Vantage and the safety car, the same model)
KEEP = {'vantage_gt3_evo_heart_of_racing', 'aston_martin_vantage_safety_car'}


def run(cmd, tag):
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    lines = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith(('[prep]', '[car]', '[lods]')) and 'transparent' not in l]
    for l in lines[-8:]:
        print('   ', l)
    # Blender exits 0 even when the script raised: its traceback is the failure
    if r.returncode != 0 or 'Traceback (most recent call last)' in r.stdout + r.stderr:
        raise RuntimeError(f'{tag} failed:\n' + (r.stdout + r.stderr)[-3000:])
    print(f'    ({tag}: {time.time() - t:.0f} s)')


def build(src_root, cid, c):
    d = os.path.join(src_root, c['dir'])
    tex = os.path.join(d, 'textures')
    prep = json.loads(json.dumps(c.get('prep', {})).replace('{tex}', tex))
    prepped = os.path.join(WORK, f'{cid}.prep.glb')
    glb, meta, png = (os.path.join(WORK, f'{cid}.{e}') for e in ('glb', 'json', 'png'))
    print(f'== {cid}')
    run([BLENDER, '-b', '--factory-startup', '-P', os.path.join(ROOT, 'tools/godot/car_prep.py'), '--', os.path.join(d, c['model']), prepped, json.dumps(prep)], 'prep')
    run([BLENDER, '-b', '--factory-startup', '-P', os.path.join(ROOT, 'tools/asset-pipeline/blender/convert_car.py'), '--', prepped, glb, meta, png, cid], 'convert')
    out = os.path.join(WORK, 'godot', cid)
    run(['node', os.path.join(ROOT, 'tools/godot/car-lods.mjs'), glb, out], 'lods')
    return json.load(open(meta)), out, png


def install(cid, c, meta, out, png, entries):
    dst = os.path.join(ROOT, 'godot/assets/cars', cid)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    for f in ('cockpit.glb', 'lod0.glb', 'lod1.glb', 'lod2.glb'):
        shutil.copy(os.path.join(out, f), dst)
    from PIL import Image
    im = Image.open(png).convert('RGBA')
    im.thumbnail((480, 270))
    canvas = Image.new('RGBA', (480, 270), (0, 0, 0, 0))
    canvas.paste(im, ((480 - im.width) // 2, (270 - im.height) // 2), im)
    canvas.save(os.path.join(dst, 'thumb.webp'), quality=85)
    v = '?v=g' + format(int(time.time()), 'x')
    e = next((x for x in entries if x['id'] == cid), None)
    if e is None:
        raise RuntimeError(f'{cid}: no entry in cars.json to keep the physics of')
    e.update({
        'thumbnail': f'assets/cars/{cid}/thumb.webp{v}',
        'lods': [f'assets/cars/{cid}/lod{k}.glb{v}' for k in range(3)],
        'bytes': sum(os.path.getsize(os.path.join(dst, f'lod{k}.glb')) for k in range(3)),
        'cockpit': f'assets/cars/{cid}/cockpit.glb{v}',
        'cockpitBytes': os.path.getsize(os.path.join(dst, 'cockpit.glb')),
        'dims': {'length': meta['lengthM'], 'width': meta['widthM'], 'height': meta['heightM']},
        'wheels': {k: {'position': meta['wheels'][k]['position'], 'radius': meta['wheels'][k]['radius'], 'width': meta['wheels'][k]['width']} for k in ('FL', 'FR', 'RL', 'RR')},
        'wheelbase': meta['wheelbase'], 'trackFront': meta['trackFront'], 'trackRear': meta['trackRear'],
        'steering': c.get('steering', meta['steering']),
        # the converter's eye search, or a hand-set one ("eye"), counts as tuned: CockpitCamera's auto-lift casts rays at the
        # whole mesh, and these models keep the windscreen in the body's mesh, so it always lifted the eye 14 cm into the roof
        'cockpitCamera': {**meta['cockpitCamera'], **({'position': c['eye']} if 'eye' in c else {}), 'tuned': True},
        'look': None, 'hasInterior': meta['hasInterior'], 'lights': meta['lights'], 'genericWheels': meta['genericWheels'],
        'source': 'godot-m6',
    })
    if 'name' in c:
        e['name'] = c['name']


GODOT = os.path.expanduser(os.environ.get('GODOT', '~/.local/opt/godot/godot'))


def patch_imports():
    """Every car model's import settings: no generated mesh LODs (the files are our LODs already)."""
    n = 0
    base = os.path.join(ROOT, 'godot/assets/cars')
    for d in os.listdir(base):
        for f in os.listdir(os.path.join(base, d)):
            if f.endswith('.glb.import'):
                p = os.path.join(base, d, f)
                t = open(p).read()
                t2 = t.replace('meshes/generate_lods=true', 'meshes/generate_lods=false')
                if t2 != t:
                    open(p, 'w').write(t2)
                    n += 1
    return n


def import_models():
    subprocess.run([GODOT, '--headless', '--path', os.path.join(ROOT, 'godot'), '--import'], capture_output=True)
    n = patch_imports()
    if n:
        subprocess.run([GODOT, '--headless', '--path', os.path.join(ROOT, 'godot'), '--import'], capture_output=True)
    print(f'imported ({n} car models set to no generated LODs)')


def main():
    src_root = sys.argv[1]
    only = sys.argv[sys.argv.index('--car') + 1] if '--car' in sys.argv else None
    os.makedirs(WORK, exist_ok=True)
    data = json.load(open(CARS_JSON))
    failed = []
    for cid, c in CARS.items():
        if only and cid != only:
            continue
        try:
            meta, out, png = build(src_root, cid, c)
            install(cid, c, meta, out, png, data['cars'])
        except Exception as ex:
            failed.append(cid)
            print(f'!! {cid}: {ex}')
            if '--keep-going' not in sys.argv:
                raise
    # the line-up: the nine and the Vantage (and the safety car); the others' entries and models go
    if not only:
        gone = [e['id'] for e in data['cars'] if e['id'] not in CARS and e['id'] not in KEEP]
        data['cars'] = [e for e in data['cars'] if e['id'] in CARS or e['id'] in KEEP]
        for g in gone:
            p = os.path.join(ROOT, 'godot/assets/cars', g)
            if os.path.isdir(p):
                shutil.rmtree(p)
        print('removed:', ', '.join(gone))
    # the safety car is the Vantage GT3 with its interior (the brief): its model fields from the Vantage's entry, its
    # own id, role, name and specs kept (race control and the server know it by id); its look in SafetyCarLook
    van = next((e for e in data['cars'] if e['id'] == 'vantage_gt3_evo_heart_of_racing'), None)
    sc = next((e for e in data['cars'] if e['id'] == 'aston_martin_vantage_safety_car'), None)
    if van and sc:
        for k in ('thumbnail', 'lods', 'bytes', 'cockpit', 'cockpitBytes', 'dims', 'wheels', 'wheelbase', 'trackFront', 'trackRear',
                  'steering', 'cockpitCamera', 'look', 'hasInterior', 'lights', 'genericWheels'):
            sc[k] = van.get(k)
        sc['model'] = van['id']
        print('safety car: the Vantage GT3 model')
    json.dump(data, open(CARS_JSON, 'w'), indent=1)
    print('failed:', failed or 'none')
    if '--no-import' not in sys.argv:
        import_models()


main()
