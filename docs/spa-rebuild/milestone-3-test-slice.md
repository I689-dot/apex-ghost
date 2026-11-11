# Spa rebuild, milestone 3: the Eau Rouge – Raidillon test slice

The slice from La Source exit to the Kemmel straight (lap 0.55–1.45 km), at full quality, compared with the reference
video (ACC, 2:39.066–4:51.066) at seven matched spots. Chase camera matched to the video's (8.5 m back, 1.95 m up,
vertical FOV 45°), sun 38° up at 142° (fitted to the video's shadows), clear weather, no bots.

## Scores

CIE76 ΔE between the video and the game per class (road, lawn, trees, sky), measured with
`~/apex-ghost-sources/survey-tools/cmp_measure.py`. Under 5 is hard to tell apart side by side; 10 is a clear tint.

| spot (lap m, video frame) | before (r10) | PC Ultra (Forward+) | phone tier (Mobile, Medium) |
|---|---|---|---|
| s1 555 La Source exit (f008) | road 8, lawn 11, trees 27, sky 2 (misplaced spot) | 4 / 15 / 4 / 5 | 9 / 11 / 5 / 2 |
| s2 785 descent, pit exit (f010) | 6 / 4 / 12 / 3 | 3 / 4 / 9 / 6 | 6 / 1 / 8 / 3 |
| s3 849 descent (f011) | 4 / 10 / 17 / 4 | 3 / 11 / 4 / 4 | 6 / 9 / 5 / 2 |
| s4 1000 Eau Rouge (f012) | 3 / 10 / 10 / 7 | 3 / 8 / 4 / 7 | 5 / 6 / 3 / 6 |
| s5 1198 Raidillon (T3) | 20 / 7 / 6 / 12 | 20 / 3 / 1 / 12 | 4 / 2 / 4 / 11 |
| s6 1254 Raidillon top (f014) | 7 / 24 / 11 / 6 | 7 / 28 / 5 / 6 | 18 / 24 / 7 / 6 |
| s7 1450 Kemmel (f015) | 3 / 6 / 7 / 5 | 5 / 10 / 6 / 5 | 5 / 11 / 12 / 2 |
| **mean of all classes** | **9.1** | **7.2** | **7.0** |

(The Mobile renderer at Ultra scores 7.0.) Where a number stays high, the class covers different things in the two
pictures: s1's "lawn" in the video is the green-painted run-off, s6's is a sun-dried bank, and at s5 the video's camera is
pitched up the hill (more deep-blue zenith sky, the road beside the car in full sun) where the game's chase camera follows
the track.

## What changed

- **Forest.** The source has trees only as cards beside the track and bare ground behind (the dirt hill after La Source,
  the banks above Raidillon). `tools/asset-pipeline/spa_godot/build_forest.py` plants 236,493 trees on the open ground
  within 1.6 km (6.5 m jittered grid, 24 m from the centreline, 6 m from walls / buildings / kerbs / card trees, lawns kept
  open to 45 m, meadows from a smooth noise field), packed by `tools/godot/pack-forest.mjs`. The source's aerial photo was
  tried as the forest map: at ~10 m a texel, and mapped piecewise, it does not line up with the circuit.
- **Species.** Norway spruce 13/43, 28/43 and 10/43 (PlantCatalog, Sketchfab; crown width / height 0.29–0.39: the first
  picks were columnar, 0.19–0.27, and read as cypresses) and a beech with fuller leaf cards. Each 11–12k triangles near,
  plus a 1.8–2.2k "_lod" model (`build_trees.py`).
- **Trackside trees.** The 128,105 card trees are scaled 1.35x (source 2–18 m; at most 30 m, bushes left alone) and about a
  third turned to broadleaf (the video's beech and birch in front of the spruce).
- **Look.** Fog 0.4 → 0.15 (the far forest had turned blue-grey; the video's is olive), scattered cumulus instead of
  cirrus, the bare dirt as dark forest floor.
- **Lawn under the 3D grass.** Where the 3D grass ended (16 m on a phone, 60 m on Ultra) the lawn beyond showed as a lighter,
  washed-out band: it had its own colour and texture, and the default material's sky reflection, which the grass has not
  (measured in the same frame with the grass on and off: 1.7x as bright, 2.5-3x the blue). Spa's lawns now draw as the
  grass does (the same photo at the same world-space tiling, its tint and average shading, no specular;
  `SpaLook.LAWN_RE`), and the grass's shading settles on that as it fades out (`lawn_edge`). Within 0-5 % on the phone
  tier, 5-10 % on Ultra; the grass scores went down with it (phone s2 7 -> 1, s5 9 -> 2).
- **Renderer.** The PC now uses Forward+ (Android keeps Mobile): TAA, which Ultra asks for, only exists on Forward+, so
  PC Ultra had no anti-aliasing at all. The Mobile renderer halves every multiply-blended pass (its 10-bit buffer
  stores colour at half value and the multiply pass is written at half value too): Zandvoort's road measured 35/255 on
  Mobile and 158 on Forward+, 155 on Mobile with the pass doubled. The circuits were tuned on Mobile, so Forward+ halves
  those passes too (`mul_gain`): every circuit looks as before on both renderers (checked on the Nordschleife and
  Zandvoort: within 1–2 levels). Spa's sky is a little dimmer on Forward+ (`SpaLook.ENV_FP`).
- **Replay fix.** A replayed car jittered: my car's model is a child of the live car, which kept rolling under physics
  between frames. Replayed models are placed in world space while the replay is open (features_test: 1 failure in 3 runs
  before, 0 in 4 after).

## Performance (RX 7600 XT, 2560 x 1440, Ultra, chase, no bots; 60 s AI drive from 0.5 km, the last 30 s measured)

| | avg fps | 1 % low | GPU ms | shadow pass |
|---|---|---|---|---|
| first forest (15k-tri trees to 220 m) | 8 | – | 53 | – |
| + light models past 60 m, near range x0.6 at Spa | 56 | 29 | 17 | 63 M prims |
| + light models cast the shadows (to 90 m) | 103 | 62 | 8.8 | 13 M |
| **Forward+ (final)** | **80** | **50** | 11.5 | 11 M |
| Nordschleife, same run | 158 | 62 | – | 5 M |

The tree shadows were the cost: Ultra's 8192 px shadow map over 200 m drew every near tree's leaf cards. The full models
now cast none; their light models cast the shadows to 1.5x the hero range (`Forest.SHADOW_REACH`).

## Not done in this slice

- No grandstand and crowd on the hill after La Source, no banner art on the Raidillon boards, no orange bollards: the
  source model has none (M1 list). Planned with the boards in M4.
- The far hills on the horizon are still flat (M4).
- The phone tier is the Mobile renderer at Medium on this PC (2400 x 1080); no phone was measured.
- The sky on Forward+ is a little less saturated than the video's.
