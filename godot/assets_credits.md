# Asset credits (Godot app)

Outside assets and data used by the Godot app's own content (the Spa rebuild: `docs/prompts/spa-and-cars-rebuild.md`).
The source files stay outside the repo; the built files are under the git-ignored `godot/assets/`. This is a private
game: some licences below (CC-BY-NC, Fab Standard) allow that use only.

## Spa-Francorchamps

| What | Source | Author | Licence | Used for |
|---|---|---|---|---|
| Circuit model "circuit de spa francorchamps 2022 layout" | supplied by the user (`RESOURCES/CIRCUIT-MODELS`) | | user's own | the circuit (`tools/asset-pipeline/spa_godot`) |
| asphalt_track (diffuse, normal, ARM, 4K) | [Poly Haven](https://polyhaven.com/a/asphalt_track) | Poly Haven | CC0 | the road surface (`SpaLook.ROAD_TEX`) |
| Realistic HD Norway spruce (13/43) | [Sketchfab](https://sketchfab.com/3d-models/realistic-hd-norway-spruce-1343-8bbf8b718c58458dbc8d78d6c6694be6) | PlantCatalog | CC-BY 4.0 | forest, spruce_0 (`build_trees.py`) |
| Realistic HD Norway spruce (28/43) | [Sketchfab](https://sketchfab.com/3d-models/realistic-hd-norway-spruce-2843-03dfd6ca5d624753bbf2ef9f78371db3) | PlantCatalog | CC-BY 4.0 | forest, spruce_1 |
| Realistic HD Norway spruce (10/43) | [Sketchfab](https://sketchfab.com/3d-models/realistic-hd-norway-spruce-1043-dcc2eae5908d44e39eecc1e90bc54f0c) | PlantCatalog | CC-BY 4.0 | forest, spruce_2 |
| Beech tree | [Sketchfab](https://sketchfab.com/3d-models/beech-tree-0983d8933531491f9be71c669e8a907b) | evolveduk | CC-BY 4.0 | forest, the broadleaf (maple slot) |
| Dennis Posed 004 | [Sketchfab](https://sketchfab.com/3d-models/dennis-posed-004-male-standing-business-model-e211ffd52a96416e89c0cc415a388d61) | Renderpeople | CC-BY 4.0 | spectator sprites (`render_people.py`) |
| Mei Posed 001 | [Sketchfab](https://sketchfab.com/3d-models/mei-posed-001-female-walking-business-model-07f308b81bc045c8917104a72ce2ffe4) | Renderpeople | CC-BY 4.0 | spectator sprites |
| Sophia Animated 003 | [Sketchfab](https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf) | Renderpeople | CC-BY 4.0 | spectator sprites |
| Angry Mob of Protesters posed | [Sketchfab](https://sketchfab.com/3d-models/angry-mob-of-protesters-posed-and-animated-dca0708b0944428386c83b875d7e5547) | Jungle Jim | CC-BY 4.0 | spectator sprites (seven of its people, no signs) |
| Copernicus GLO-30 DEM (tiles N50 E005, N50 E006) | [Copernicus / AWS open data](https://registry.opendata.aws/copernicus-dem/) | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA | Copernicus DEM licence (free, attribution) | the hills around the circuit (`build_far.py`) |
| ESA WorldCover 10 m 2021 v200 (tiles N48E003, N48E006) | [ESA WorldCover](https://esa-worldcover.org) | © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium | CC-BY 4.0 | the hills' land cover |
| Circuit outline (highway=raceway) | [OpenStreetMap](https://www.openstreetmap.org/copyright) | © OpenStreetMap contributors | ODbL 1.0 | placing the circuit on the map (`geofit.json`) |
| PaintedMetal001, Plastic007, Plastic011, Fabric032, Metal032, Rubber004, Wicker005, CorrugatedSteel005 | [ambientCG](https://ambientcg.com) | ambientCG (Lennart Demes) | CC0 | the props' materials (`build_props.py`), metal grain on the model's steel |
| concrete_wall_008, painted_concrete | [Poly Haven](https://polyhaven.com/textures) | Dario Barresi, Charlotte Baglioni, Dimitrios Savva | CC0 | grain on the model's walls and buildings (`build_detail_textures.py`) |

Modelled for the app (no outside source): the props in `tools/asset-pipeline/spa_godot/build_props.py` (bollards,
feather flags, TV cranes, the balloon, podium boards, the footbridge, tents) and their printed art
(`build_prop_textures.py`, Noto Sans Bold, SIL OFL).
