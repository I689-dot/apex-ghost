# Spa rebuild, milestone 4: the whole lap (in progress)

The approved test-slice look (M3) runs over the whole 7 km: one set of materials, so the colours were already lap-wide. M4
adds what the source model lacks around the lap, and the M3 grass fix. Compared with the reference video at 16 spots
(chase camera matched as in M3; each spot's position picked from three candidates by structure, `align_spot.py`), plus a
wet and an evening frame. Check-in images: `~/apex-ghost-sources/checkin-m4/` (outside the repo).

## Scores (PC Ultra, CIE76 ΔE road / grass / trees / sky; under 5 is hard to tell apart, 10 a clear tint)

| spot (lap m) | before M4 | now | | spot (lap m) | before M4 | now |
|---|---|---|---|---|---|---|
| f002 straight (54) | 9.1 | 9.1 | | f036 to Pouhon (3570) | 10.8 | 10.7 |
| f005 La Source (368) | 10.0 | 11.7 | | f039 Pouhon (3956) | 13.1 | 12.4 |
| f017 Kemmel (1709) | 7.1 | 7.2 | | f043 Fagnes (4442) | 8.1 | 8.2 |
| f021 Kemmel end (2287) | 3.5 | 3.7 | | f048 Campus (4911) | 10.0 | 10.1 |
| f024 Les Combes (2537) | 8.5 | 10.1 | | f051 Paul Frère (5232) | 16.0 | 16.2 |
| f028 to Bruxelles (2860) | 12.9 | 13.2 | | f055 to Blanchimont (5604) | 8.8 | 8.7 |
| f030 Bruxelles (3070) | 10.6 | 10.9 | | f060 Blanchimont (6160) | 10.4 | 10.5 |
| f033 Speakers' Corner (3250) | 8.1 | 7.8 | | f063 to the chicane (6548) | 12.0 | 13.0 |
| **mean** | **9.9** | **10.2** | | | | |

The colour score hardly moves with objects: it compares the classes' average colours. Where it stays high the spot's
framing differs (corners: the video's car is turned, the game's camera follows the track): at f063 the video's road lies
in the footbridge's shadow, at f051 its "road" takes in the light concrete run-off, at f005 the La Source asphalt is in
shade. The asphalt matches where the framing does (f021, f036: road ΔE 3-4).

## What was added

- **The Ardennes on the horizon** (`tools/asset-pipeline/spa_godot/build_far.py`, `SpaFar`): the model's terrain stops
  1.5-3.5 km out, then a flat horizon. A ring of real terrain out to 9.5 km: Copernicus GLO-30 heights (30 m, the forest
  canopy included), ESA WorldCover land cover (forest, meadow, crops, villages, coloured in `far_terrain.gdshader`). The
  game frame was put on the map by fitting the centreline to OpenStreetMap's raceway: scale 0.989 (the game frame is the
  model at 1.0103), rotation -2.35 deg, residual 1.9 m mean. Under the model's ground the ring is dropped; within 500 m
  of its edge it blends to the model's heights (no step). 65k triangles on High / Ultra, 7.5k below.
- **Green run-off paint**: the source names its painted run-off "astroturf", which the ground code took for lawn (the
  lawn photo and 3D grass on it). Spa's paint keeps its own texture, no 3D grass, every painted texel (green, the blue
  the video has not, the worn teal strip in the kerb atlas) brought to the video's green (`SpaLook.PAINT_RE`).
- **Gantries** at Fagnes (4.495 km) and Campus (4.985 km): the model's TotalEnergies gantry (3.60 km) repeated, its steel
  green (`SpaProps.COPIES`; positions from the banner's size in f042-f043, f047-f048).
- **Spectators** (`SpaCrowd`): scanned people (Renderpeople and a crowd scene on Sketchfab, CC-BY) rendered to sprites
  (`render_people.py`: 10 people x 3 views) that turn to face the camera. On the grandstands' seating, and 1,680 on the
  banks and fences where the video has them (`build_places.py` ZONES: the hill after La Source, Kemmel, Les Combes,
  Pouhon, Fagnes, Campus).
- **Props** modelled at real size (`build_props.py`, art from `build_prop_textures.py`): the Audi Sport balloon at La
  Source, five TV cranes, four Fanatec Podium boards, the footbridge before the chicane, 22 bollards on the pit-exit line,
  30 feather flags, 19 tents. Off-track ones placed from the video: the angle from the pixel column, the distance from
  the known size (`build_places.py` PROPS).
- **The pit-exit wall** green (white in the model): repainted in place (`SpaProps.REPAINT`).
- **Grass band** (M3 check-in): the lawn draws as the 3D grass does (M3 notes).

## Wet and evening

`checkin-m4/wet_and_evening.jpg`: light rain in the afternoon (overcast, darker wet road, rain streaks) and the evening
19:45 (low sun with glare off the road, long shadows, the hills in haze). The same materials hold up in both.

## Performance (RX 7600 XT, 60 s AI drive from 0.5 km, the last 30 s measured)

**Correction.** The M3 and first M4 figures said 2560 x 1440 but were measured at 1920 x 1043: this PC's screens are
1920 x 1080 and the game window is capped at the screen. The test now reports what it drew and takes RENDER_SCALE (the 3D
drawn at a multiple of the window: 1.333 is the 2560 x 1440 pixel count). Also: in the app, Ultra renders the 3D at 2x the
window (`superSample: 2`, Graphics; the tests skip it), on these screens 3840 x 2160.

| | 3D drawn at | avg fps | 1 % low | GPU ms |
|---|---|---|---|---|
| M4 content, old forest switching (as first reported) | 1920 x 1043 | 79.5 | 50.7 | – |
| same, at the target's pixel count | 2560 x 1391 | 48.1 | 31.1 | – |
| blended forest, light shadow models (now) | 2560 x 1391 | 48.5 | 32.3 | 18.5 |
| the same as the app's Ultra draws it on a 1080p screen | 3840 x 2086 | 38.5 | 27.4 | 24.1 |
| phone tier (Mobile, Medium, on this PC) | 1920 x 1043 | 350 | 114 | – |

Below the 45 fps target at 2560 x 1440: the forest is most of the frame (alpha-tested crowns of ~4,000 near trees).

## The forest's level changes (user report: trees bare until passed, filling in as the car went by)

The cards far away were hidden inside the near range every frame, the near models picked only every 20 m of travel:
for a moment after each pick the trees entering the range ahead had neither, and the light model past 60 m had kept
about 40 % of the crown's leaf cover (a floor in the card growth capped it at 4.5x whatever the limit), so it stood
bare until the full model took over. Now (Spa: `Forest.fades`): each level change is a dithered cross-fade the GPU works
out per frame from the tree's own distance (full / light model over 55-65 m, light model / card over 10 m past the near
range), the layers picked every 5 m with a 6 m margin; the light models keep the crown's cover with fewer, larger cards
(8x), drawn in the full model's frame (they were up to a fifth smaller); the shadows come from a separate 1,200-triangle
model (the light model as caster made a 25 M primitive shadow pass).

## Spectators behind the fences (user report)

`build_places.py` casts a ray from the centreline to every spectator: each one stands at least 1.2 m behind the
outermost fence, rail, wall or grille within 35 m (one short of it steps back past it; with none between him and the
track he is left out).

## Checklist items still open

- The grandstands on the hill after La Source (f008-f011; the model has a bare bank there): the crowd stands on the bank.
- Banner art on the Raidillon boards and the Armco banners (blank in the model).
- The green wall at T15 (f049-f050), the green paint at Blanchimont where the model has lawn (f058-f063).
- The pit building's glass front and fins (plain grey in the model), containers and marquees on the hill at the start.
- Detail: the footbridge is a truss; the video's is a deeper box girder. The phone tier was not measured on a phone.
