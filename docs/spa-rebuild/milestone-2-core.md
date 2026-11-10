# Spa and cars rebuild: Milestone 2, Spa core (2026-11-10)

## Frame: the game's existing one, not 1:1

The new source model (`spa.glb`) is the same geometry as the one the web game's Spa was built from: an exact similarity
fit on rigid props (marshal posts, start lights, flag poles, houses, grandstands; Umeyama ICP on 12k vertices) gives
`game = 1.010261 * glTF + (10.680, -19.554, -47.352)`, rotation 0.0001 deg, median residual 1.0 cm
(`tools/asset-pipeline/spa_godot/config.json` `toGameFrame`). Spa for Godot is built in that frame so the shared
server's centreline, gates, sectors and pit distances (`packages/shared/src/generated/tracks-race.json`, which time online
laps) stay valid with no server change. The world is therefore 1.03 % larger than the source's metres, as before.

Kept from the current layout, checked against the new collision: all 491 pit-lane points on asphalt (within 1.8 cm of
their heights), the 12 grid slots, the start and finish lines, 1,397 of 1,401 centreline points on asphalt (4 on
kerbs at apexes), track limits on the new asphalt edge (median +0.01 m left, +0.07 m right). Minimap, gates and sectors
come from the same centreline.

## Collision (`node tools/asset-pipeline/spa_godot/collision.mjs`)

- Rubber layers (`groove1/2/3/custom`) and paint are left out: they float up to 26 cm over the asphalt at T9 and 11 cm
  at Fagnes (the old "seam"); 99 % of them lie over base asphalt, the rest over kerbs, astroturf or gravel that have
  their own collision. `smoothRoad` removed.
- Kerbs levelled by `spa_godot/kerb_level.mjs` instead of `conformKerbs` (which the web pipeline keeps): each vertex at
  most 4 cm above the higher of the road within 2 m and the ground right beside it, at most 1.5 cm under the lowest
  surface round it, and no local hump more than 5 cm over the kerb within 1 m. `conformKerbs` left kerbs set in the
  grass sunk 4-8 cm (Pouhon exit) and cut a 7 cm step across a kerb between two road levels (Paul Frère).
- Grass, gravel, sand and walls as the web pipeline makes them (same triangle counts within 0.1 %).

| Check | Old collision | New collision |
|---|---|---|
| `road_bumps.py` stretches over 5 cm | 75 (T9 29.8 cm, Fagnes 20.3 cm, 277 / 184 cm outliers) | 17 (chicane 13 cm at +3 m, the rest at the kerbs; two 81-88 cm where a lower road runs alongside behind the barrier) |
| `road_bumps.py` on the road centre | — | none over 3 cm on the whole lap |
| `kerb_scan.py` steps over 5 cm | 8 (worst 11.9 cm, T9) | 21 (worst 8.9 cm Campus, chicane 7.6 cm, the rest 5.0-6.3 cm) |
| `kerb_test.gd` worst roll, T9 lane -5.8 | 18.9 deg | 5.8 deg |
| `kerb_test.gd` worst roll, Campus lane -6 | 3.4 deg | 4.8 deg |
| `kerb_test.gd` worst roll, Les Combes +3.2 / Pouhon -6 / chicane +3.5 / -4 | — | 3.2 / 2.6 / 3.5 / 4.4 deg |

`road_bumps.py` was fixed: its cross-sections used each centreline segment's own normal, so points off the centre jumped
sideways at every vertex, which on a steep road (Raidillon, 14 %) read as a full-width bump of 7-15 cm that is not in
the surface. The direction is now interpolated between vertex tangents.

## Bots

`ai_learn.gd` (8 laps, real time) wrote `data/ai_learned/spa.json`: off or sliding stretches 14 -> 3, plan grip x1.023
(lap times 2:41.1 -> 2:47.0 over the 8 laps on one set of tyres: wear). `ailap.gd` (Porsche 992 GT3 R, skill 0.97) with
the learned plan: **2:39.04, 0 resets**, top 244 km/h (2:40.19 before learning; the old collision 2:40.3).

On Wayland a covered window gets no frames and a vsync'd game then crawls (13 min a lap): run the training with
`--disable-vsync --always-on-top`.

## Not yet

The render is still the old one (Milestone 3). The collision and layout files are git-ignored outputs: rebuild with the
command above from the source GLB (Milestone 5's download pack will carry them).
