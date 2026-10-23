# Nürburgring realism pass

What was changed to make the Nürburgring look more like the real place, what it costs, and what is still missing. The map is the in-game 2022 GP model (`Nürburgring_GP_2022_layout`). Google Earth and Street View were used only to look at: no Google imagery, tiles or geometry is in the game. The real sponsor logos and advertising that came with the source model have been replaced by invented, generic boards.

## 1. Gap list

Rated 1–5 for impact on realism (or frame time) and for effort. Items are sorted by impact ÷ effort within each group.

| # | Gap | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | **Forest.** The Eifel is dense spruce and beech forest right up to the armco. The map keeps only the source's 171k tree triangles near the track, so beyond ~400 m the hills are a flat satellite photo. | 5 | 3 | Done: procedural forest |
| 2 | **Nordschleife missing.** The GP terrain has a 20–40 m channel where the Nordschleife should be, and nothing in it. | 5 | 5 | Done: 19.5 km road + 24h layout |
| 3 | **Uniform asphalt.** No rubbered racing line, braking marks or repairs, so the road looks brand new and flat. | 4 | 2 | Done: road wear decal |
| 4 | **Flat grass close up.** 256 px tiling grass reads as a green carpet at driver height. | 3 | 1 | Done: detail + macro variation |
| 5 | **Hole-fill terrain texture is a 2048² JPEG**: about 22 MB of GPU memory on every Nürburgring layout (5.6 MB on Zandvoort). | 3 (perf) | 1 | Done: KTX2 |
| 6 | **Far barriers.** On the 24 km layout the whole GP is in view from the end of the Nordschleife, rails and tyre walls included, though they are under a pixel tall. | 2 (perf) | 1 | Done: distance cull |
| 7 | **Satellite photo resolution.** 2048² over 9.6 km is ~4.7 m per pixel, blurry from the driver's seat. | 4 | 4 | Open: needs a licensed orthophoto (see next steps) |
| 8 | **Nordschleife heights** come from the banks of the terrain channel plus hand-set crests (Flugplatz, Pflanzgarten) and Karussell banking, not survey data. | 4 | 3 | Open: needs a DEM (OSM + EU-DEM mode exists, untested on real data) |
| 9 | **Nordschleife trackside furniture**: no bridges, marshal posts, distance boards, signs, spectator banks, concrete Karussell. | 3 | 4 | Open |
| 10 | **Real advertising in the GP source model**: tyre, oil, car-maker, energy, hotel and circuit logos on boards, the timing tower, marshal posts and buildings. | 3 | 2 | Done: generic signage |
| 11 | **Junction asphalt.** Where the Nordschleife meets the GP, our road overlays the GP's link road and shows as slightly different patches. | 2 | 2 | Open |
| 12 | **Layout length.** The 24h layout is 24.26 km, about 4% short of the real 25.4 km, and runs through the Mercedes Arena. | 2 | 3 | Open |
| 13 | **High preset looks milky** in the headless test renderer (SwiftShader). Most likely the N8AO pass under software GL. | ? | 1 | Check on a real GPU |

## 2. Changelog

**Client**

- `game/forest.ts` (new): about 446k trees on the GP map and 510k on the Nordschleife. Within 110–240 m (by preset) they are real 3D spruces (~122 triangles, 7 jagged tiers) and beeches (5 blobs) drawn as one `InstancedMesh` each. Beyond that, out to 0.7–2.2 km, they are camera-facing cards baked at load from the same trees. That is 4–8 draw calls in total, and the selection refreshes only after the camera moves 20 m. *Why:* the skyline and the walls of trees along the Nordschleife are what make the place recognisable.
- `game/roadWear.ts` (new): one multiply-blend decal over the full road width (about 10k triangles, 1 draw call). It carries:
  - a darker rubbered band with two wheel tracks along the AI racing line;
  - skid streaks where the speed profile brakes;
  - marbles off the line in fast corners;
  - occasional repair patches.

  It fades out by 260 m and washes out in the rain. *Why:* real asphalt shows where cars drive, and a uniform road looks synthetic.
- `game/track.ts`:
  - procedural grass detail and macro variation on ground materials;
  - guard rails, tyre walls and the pit wall are culled per mesh beyond `barrierDistance` (900/1500/2200/3500 m by preset), saving up to 35 calls in long views;
  - chunk nodes not listed for a file are pruned, so a layout can replace a base-map chunk.
- `settings.ts`: per-preset `forestNear`, `forestFar`, `forestNearDensity`, `forestDensity` and `barrierDistance`; the phone presets (`mobile/appShell.ts`) are trimmed further.
- `session.ts` wires both in. `assets.ts` accepts extra collision files.

**Asset pipeline**

- `forest_scatter.mjs` (new): renders the shipped terrain top-down in headless Chromium and classifies the satellite photo (dark and green is forest), masks out everything man-made, then places trees on a jittered 4.6 m grid with soft stand edges. Spruce or beech is chosen from the photo's hue. Output is 8 bytes per tree, sorted into 128 m cells.
- `trace_nordschleife.mjs` (new): finds the Nordschleife channel in the GP terrain, thins it to a centreline and takes heights from both banks. Offline: no downloads.
- `blender/build_nordschleife.py` (new), configured by `maps/nordschleife.json`:
  - road (crowned and banked), lines, kerbs on tight inside corners, verges, double armco on posts;
  - a satellite-textured corridor, and the GP terrain conformed to the road;
  - junctions routed onto the GP in the right direction;
  - 1 km chunks and collision.

  The corridor and the conformed terrain now share one photo texture (−0.8 MB download, −2.8 MB GPU).
- `optimize.mjs`:
  - base-map support: trims the GP's flat hole fill along the new road, cuts GP walls at the junctions, merges the GP collision, and writes the `nurburgring_24h` layout;
  - the hole fill's textures are now KTX2 (`--only fill` re-encodes an already built `map_fill.glb`);
  - its geometry stays unquantised, because 14-bit quantisation is ~12 cm steps over a 2 km fill mesh;
  - fixed the path that keeps `forest` in the layout JSON when optimize re-runs.
- `run.mjs`: new `forest` step; the `map` step runs the tracer and the builder for `"builder": "nordschleife"`.

- `signage.mjs` (new) + `maps/nurburgring.json` `"signage"`: 14 textures, with rules per texture. Ad panels are redrawn as flat boards carrying invented names (APEX FUEL, GHOST TYRES, EIFEL MOTOR OIL…), and small logos in the atlases are filled with the surrounding colour. It runs in the `map` step on the source images. Standalone (`node tools/asset-pipeline/signage.mjs --map nurburgring --preview <dir>`), it rewrites the shipped KTX2 textures in place and saves before/after PNGs. *Why:* the brief asked for no real brands, and the GP model came with dozens.

**Data:** `track/forest.*` (GP), `maps/nordschleife/*`, `tracks/nurburgring_24h.json`, the re-encoded `track/map_fill.glb` and `maps/zandvoort/map_fill.glb`. Layout JSONs were updated with `forest`, new file versions and the new layout.

## 3. Performance report

Measured in the game (`renderer.info` after one frame, Medium, clear weather) with the audit camera at driver height, 1.05 m above the road and looking ahead, or in the air (45 m up). "Before" is the same frame with the forest and road wear hidden, so it shows exactly what this pass adds. Draw calls and triangles don't depend on resolution. Frame rate could not be measured here: the renderer is software (SwiftShader). See "Check on your hardware" below.

**Budget (Medium, mid-range laptop at 1080p):** ≤ 250 draw calls and ≤ 800k triangles in driver views.

### GP layout (`nurburgring_gp_2022`)

| View | Before: calls / tris | After: calls / tris | Trees drawn |
|---|---|---|---|
| Driver, 862 m | 107 / 464k | 110 / 573k | 50k |
| Driver, 1733 m | 54 / 288k | 58 / 408k | 55k |
| Air, 3000 m (whole GP in view) | 312 / 591k | 316 / 709k | 55k |

The forest costs +3–4 calls and +110–120k triangles on Medium. On High it costs +4–8 calls and +330–800k triangles: denser cards out to 1.4 km, plus tree shadows. The air view was over budget before this pass. It is the GP's 320 m chunks × ~10 materials, and the in-car views stay well under budget.

### 24h layout (`nurburgring_24h`, new)

| View | Calls / tris | Trees drawn | Notes |
|---|---|---|---|
| Driver, GP 605 m | 200 / 696k | 27k | |
| Driver, Nordschleife km 3.5 | 57 / 313k | 31k | |
| Driver, Nordschleife km 8.0 | 61 / 396k | 42k | |
| Driver, Karussell (km 11.6) | 23 / 367k | 55k | |
| Driver, Nordschleife km 16.5 | 281 / 719k | 34k | was 316 / 770k without barrier culling |
| Driver, Nordschleife km 18.9 | 322 / 708k | 20k | was 339 / 729k without barrier culling; GP chunks in view |
| Air, exit junction | 125 / 536k | 30k | |
| High, km 8.0 | 94 / 989k | 67k | |
| High, km 18.9 | 473 / 1.17M | 31k | |

On the Nordschleife itself a frame is cheap: 20–60 calls. The two views over budget look across the valley at the whole GP complex, where the GP's ~190 track primitives are in view. The fix is a merged far version of the GP chunks (next steps).

### Texture memory (GPU, KTX2 transcoded size including mips)

| | Before | After |
|---|---|---|
| GP layout, map textures | 28.4 MB | 8.6 MB (+0.6 MB procedural grass detail and tree impostors) |
| 24h layout, map textures | 31.7 MB (first build) | 9.1 MB |
| Zandvoort hole fill | 5.6 MB | 0.7 MB |

### Download

| File | Before | After |
|---|---|---|
| `track/map_fill.glb` | 5.08 MB | 1.41 MB |
| `track/forest.bin` | — | 3.57 MB |
| `maps/zandvoort/map_fill.glb` | 1.33 MB | 0.32 MB |
| `track/map_scenery.glb`, `track/map_track.glb` (signage, re-saved) | 4.83 + 8.12 MB | 5.01 + 8.33 MB |
| `maps/nordschleife/` (all) | — | 17.4 MB (collision 6.3, forest 4.1, terrain 2.6, track 1.8, fill 1.3, scenery 1.0, junction 0.2) |

A GP race downloads about the same as before: the forest cancels the fill saving. A 24h race downloads about 33 MB of map, against about 26 MB for the GP alone. `public/assets` grew from 206 MB to 223 MB.

### Pipeline features from the brief

| Item | State |
|---|---|
| Compressed glTF | Meshopt on every GLB (positions quantised, except the hole fill) |
| KTX2 | ETC1S for colour and UASTC for normals; the hole fill now too |
| LODs | Forest: 3D trees → cards. Cars already had 3 LODs. Map chunks: distance culling by kind (trees, scenery, detail, barriers) |
| Instancing | Forest (2 near + 2 far instanced meshes) |
| Chunking / streaming | 1 km Nordschleife chunks, frustum- and distance-culled. Everything loads at race start; true streaming is a next step |
| Separate collision mesh | Yes: `collision.apxc` (asphalt, kerb, grass, wall), merged with the GP's on the 24h layout |

### Driving check

AI laps (`tools/sim/ailap.ts`, which drives the real collision):

- **GP:** unchanged, 2:19.5 at skill 0.88.
- **24h layout:** 8:51.3 at skill 0.88 (1 reset). At skill 0.97 the bot runs 9:54.9: it overcooks its tyres and spins, which is a bot-tuning issue rather than a geometry one.

The hole scan finds only small run-off gaps near 23,980 m.

### Check on your hardware

Open the perf overlay (Settings → Performance overlay) and drive both layouts on Medium at 1080p, then try High. Look for the milky High image (gap 13).

## 4. Next steps

1. **GP far version (HLOD):** a `map_track_far.glb` with the GP chunks merged per material and simplified, shown when the camera is more than ~1 km from the GP. Saves about 150 calls in the long Nordschleife views.
2. **Better photo (gap 7):** a higher-resolution orthophoto under an open licence, for example Rhineland-Palatinate's open geodata (check the licence and attribution before shipping). It would be tiled into 1 km KTX2 tiles in the existing chunks. *Needs:* the image files.
3. **Real heights (gap 8):** run `"source": "osm"` with EU-DEM, or a 1 m state DEM, and compare against the traced heights. *Needs:* network access during the build, or the DEM tiles.
4. **Nordschleife furniture (gap 9):** an instanced kit (marshal posts, distance boards, signs, bridges at the real crossings, spectator banks at Brünnchen and Pflanzgarten) placed by lap fraction in `maps/nordschleife.json`.
5. **Streaming:** load the Nordschleife chunks as the car approaches them, to cut 24h start-up time.
6. **Junction blending (gap 11):** paint the overlap with the GP asphalt material instead of `asph_ns`.
7. **Rebuild with your pipeline:** the GP fill and the signage textures were rewritten in place, and the forest was scattered from the shipped terrain. Run `pnpm assets` once on your machine with the source models to regenerate everything from scratch.
