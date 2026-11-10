# Spa and cars rebuild: Milestone 1 survey (2026-11-10)

Brief: `docs/prompts/spa-and-cars-rebuild.md`. The full check-in page (frames, renders, every table) lives outside the repo
with the sources: `~/apex-ghost-sources/checkin-m1/index.html`, built by `~/apex-ghost-sources/survey-tools/make_checkin_m1.py`
from the survey data in `~/apex-ghost-sources/survey/` and `~/apex-ghost-sources/video/`. The extracted sources are in
`~/apex-ghost-sources/{spa,cars}` (never committed).

## Spa source model (`spa.glb`)

- 1.19 M triangles in one node / one mesh, 85 materials, 109 embedded images all cut to at most 256 px. Full-size files exist
  for 16 textures only (asph 1024x4096, grass detail, trees, bank 8192x1024, pit asphalt, box1, ext-top, parking, texts);
  no full-size normal map. Every material is OPAQUE (alpha mode lost); the Assetto Corsa multi-layer shaders collapsed
  (grass white, asphalt pink / blue-grey, grooves opaque black).
- True metres. Fit of the game's current centreline onto the new road: scale 0.99062, no rotation, shift X -11.3 m,
  Z +44.8 m, Y +20.2 m; all 1,401 points land on the road. Old lap 7,039.9 m = 6,974 m in the new model (official 7,004 m).
  Build at 1:1. Distances below are new-model metres.
- Turn 9 fault is still there but only in the render: the groove3 overlay floats 10-15 cm over asph_new at 3.22-3.28 km
  (a diagonal seam, as before), ~11 cm at Fagnes 4.44-4.62 km. The base layers (asph, asph_new, asph-grv, patch joints)
  are smooth there (lateral steps <= 4 cm, along the lap <= 1.2 cm): collision from the base, overlays draped onto it,
  no `smoothRoad`.
- A buried copy of groove_custom 0.8-0.9 m under the road at 6.64-6.69 km; a stray astroturf piece 23 m under the road
  edge at 3.27-3.29 km; grooves coplanar with the asphalt (652 identical triangles); no holes in the racing surface.
- Kerbs: tops 9-16 cm above the road plane in ~20 stretches (12-16 cm at Les Combes 2.61, Pouhon 3.76-4.12,
  Campus / Paul Frère 4.90-5.19 km), sunk 4-13 cm in ~15 (Pouhon worst); `kerb_conform.mjs` covers both.
- Doubled triangles: 100,839 in tree / bush cards (two-sided copies), 1-1.5k each in marshal posts, flag poles, rails.
- Missing against the reference video: the Ardennes hills (flat horizon), three green gantries (3.60, 4.47, 4.94 km),
  the footbridge before the chicane, crowd, cranes, balloon, Podium boards, feather flags, bollards, banner art, the green
  pit-exit wall. Trees are mostly round broadleaf cards where the video shows Norway spruce.

## Reference lap (video 2:39.066-4:51.066)

f001 = 2:41.066 on the main straight (6,956 m), La Source apex 2:50.0, Eau Rouge 3:03.8, Les Combes 3:24.6, Bruxelles
3:39.6, Pouhon 3:57.0, Fagnes 4:09.1, Paul Frère 4:19.0, chicane 4:48.8-4:51.1. Table in `~/apex-ghost-sources/survey/timemap.json`.
Look sheet colours in `~/apex-ghost-sources/video/look/colours.json` (sRGB and linear per patch). Sun azimuth ~135-150 deg
in the game frame (0 = -Z, 90 = +X), elevation ~30-45 deg (to be fixed at M3 by matching shadows); shade 13 % of sun on
asphalt, blue; highlights never clip (p99.9 = 218/255).

## Baseline (current Spa, PC Ultra, 2560x1440, RX 7600 XT)

144 fps (vsync), GPU 3.2 ms main + 1.2 ms mirror, 305 draw calls, 12.0 M triangles. The project uses the Mobile renderer on
PC too (`renderer/rendering_method="mobile"`). `tests/session_test.gd` now takes `TRACK=<layout id>`.

## Cars

Five use the Kunos rig (COCKPIT_HR/LR, STEER_HR, DISPLAY_DATA, WHEEL_*, RIM_BLUR) at 1:100 with pivots at the origin
(Audi, McLaren, Porsche, Mustang, AMG amg_evo_3); the 2026 BMW has proper pivots and real scale; the vecarz M4 is 2.56 M
triangles (205k per wheel); the Ferrari 296 and the 2020 AMG Evo have no named parts (cut out like the Vantage). The Audi,
AMG amg_evo_3 and Porsche liveries are separate textures the GLBs don't reference; the McLaren and Ferrari come white.
