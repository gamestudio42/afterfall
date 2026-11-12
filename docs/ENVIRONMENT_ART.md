# Environment art

The environment pass supports reclaiming an abandoned city while keeping travel
routes, building entrances and threats readable from the RTS camera. It changes
surfaces and vegetation without changing park generation. Abandoned vehicles also
participate in navigation, using the same placement data as the renderer.

## Surfaces and street wear

`tools/make-surfaces.ts` creates deterministic 512 px asphalt, slab paving and
grass maps. Asphalt and paving also have packed detail maps: red stores bump
height and green stores roughness. Detail maps use linear data, while colour
maps use sRGB. Asphalt and grass combine two texture scales to reduce repetition.

`tools/make-decals.ts` creates the 512 × 384 atlas of fractures, repairs, oil,
rubble, weeds, leaves, soot, manholes, drains, puddles and paper. The placement
follows each actual road segment, including imported curves, with litter at the
edges and repairs on the carriageway. The entire layer is one merged mesh.
Generated streets also have faded, chipped lane paint and zebra crossings.

```sh
node --import tsx tools/make-surfaces.ts
node --import tsx tools/make-decals.ts
pnpm exec prettier --write apps/web/public/art/manifest.json
pnpm assets:check
```

Both generators update their own manifest entries without removing other assets.
The old `sidewalk.jpg` and `roof.jpg` remain archived source assets; the renderer
uses the new PNG slabs and roofing rolls. Roof felt also carries packed height
and roughness, with staggered overlaps, repairs and mineral grit.

## Reclamation: nature taking the city back

`packages/renderer/src/reclamation.ts` builds one field per map that measures how
overgrown each square metre is. The field is a texel per metre on a generated city,
and at most 512 texels a side. It rises against walls, in the gutter and at the
curb, around parks, and in broad noise patches. The middle of a carriageway stays
the clearest surface, so streets remain readable. Distances come from a chamfer
transform over building, road and park masks, so imported maps work the same way.

The ground shaders sample that field. Soil, then moss or straw, cover the paving.
Sidewalks also break into 0.8 m slabs, each with its own shade, and heavy growth
removes some of them. Regional wear makes one stretch of paving greyer than the
next. Park lawns turn rank and dry in patches. Growth is matte, so rain sheen stops
where moss starts.

The same field drives the vegetation scatter, so ground and plants agree:

- `grass.ts` scatters up to 10,000 tufts of tall grass in one instanced draw. Each
  tuft is four splayed alpha cards with upward normals and wind sway. Tufts are
  cosmetic: they never block movement or building, stay under 1.2 m, and keep 2.8 m
  clear of doors. A software rasteriser receives a quarter of them.
- `placeVegetation` keeps the map's park trees. It then fills parks with more and
  larger trees and brush, adds up to 220 self-seeded street trees in lots and
  plazas, and puts brush against walls. Street trunks keep 6 m from doors. The total
  cap is 900 instances.

The day grade is desaturated (0.88), with olive shadows and dusty highlights. The
sun is a little warmer, the bounce light is olive, and the day haze starts nearer.
The post chain stays off on software renderers, so CI captures do not show the
grade. Force it with `renderer.setPost("on")`.

## Buildings and urban objects

The street kit now has shaped car bodies, sloped glass, wheel rims, emergency
vehicle details, corrugated containers, hinged dumpsters, jersey barriers,
planked crates and weathered fences. Car and container paint varies per instance;
glass, tyres and fittings retain their own colours. Vehicles occupy the road,
with curbside parking mixed with skewed cars stranded in traffic. One third of
cars have open doors. `packages/world/src/vehicles.ts` supplies deterministic
positions and oriented footprints to both rendering and navigation. Both agents
avoid bodies and open doors. Roads narrower than 7 m receive no vehicles; entrances
retain clearance for access and defenses. A loaded character occupying a newly
blocked vehicle cell is moved to nearby walkable ground and its route replanned.

Roof tanks have bands, braces and ladders; AC units have grilles and louvers;
stair bulkheads have door frames, a step and drainage. Antennas have guy wires.
Building batches include shallow floor bands and residential window sills, plus
subtle dampness at ground level and rain streaks. These remain in the existing
material groups and retain building ownership for picking and overlay colours.

The settlement kit adds wall joints, gate hardware, tower braces and roof seams,
raised farm beds and a hollow stone well with visible water. The geometry and
materials change; build costs, collision, save data and construction rules do not.

`tools/blender/propkit.py` shares geometry helpers and packs authored palettes into
vertex colours. Each of the 21 GLBs uses one to three material batches, at most
6,500 triangles and at most 512 KiB. This lets the existing instanced renderer
retain small details without a draw call for every paint colour. Large street
silhouettes, roof tanks and stair bulkheads cast shadows; small roof clutter does not.

```sh
blender --background --factory-startup --python tools/blender/props.py
blender --background --factory-startup --python tools/blender/roof_props.py
blender --background --factory-startup --python tools/blender/structures.py
pnpm assets:props props structures
pnpm exec prettier --write apps/web/public/art/manifest.json
pnpm assets:check
```

The optional directory arguments update only those manifest entries, preserving
other kits' generator provenance.

## Refloreste source and adaptation

The four GLBs and leaf mask in `apps/web/public/art/vegetation/` come from the
GameStudio42 Refloreste vegetation kit supplied for this task. The kit describes
its meshes as procedurally generated with Blender for Refloreste. Exact source
paths and checksums are recorded in the art manifest. The selection contains
mature manacá, mature pequi, dead manacá and a Mata Atlântica bush.

```sh
node --import tsx tools/import-vegetation.ts /path/to/vegetacao-refloreste
pnpm exec prettier --write apps/web/public/art/manifest.json
```

The importer copies assets without modifying the source kit. Afterfall loads only
LOD0 into instanced Three.js batches, normalizes model height, applies its own
materials and animates a small wind displacement in both colour and shadow
passes. The kit's Godot shaders and their third-party shader code are not used.
The original leaf mask provides alpha-cutout foliage. Scale, rotation and shade
vary per instance, with occasional bare trees, low bushes and soft earth around
the roots. Trunk placement
excludes roads and building margins; total placement is capped at 600 plants.

Primitive trees remain visible until every requested model has loaded. An asset
failure keeps that fallback rather than displaying a partially loaded park.

## Verification

`packages/renderer/tests/decals.test.ts` checks that complete decal footprints
stay within a bent imported carriageway. `vegetation.test.ts` checks deterministic
placement, diversity, the instance cap and exclusion of roads/buildings.
`tests/e2e/environment.spec.ts` checks actual WebGL loading, instancing, material
maps, fallback replacement and shader errors. A second browser case deliberately
fails one model and the decal atlas, verifying that primitive trees remain visible,
partial vegetation is released, blank decal rectangles never appear and a base
can still be established.

```sh
ENVIRONMENT_SHOT=1 pnpm test:e2e tests/e2e/environment.spec.ts --workers=1
```

Optional captures are written to the Playwright output directory, showing a street
and park by day and a park at night. They are renderer inspections, not a human
playtest or a player-hardware performance benchmark.

`urbanAssets.test.ts` loads all 21 shipped GLBs, checks colour attributes and
geometry/batch budgets, and casts rays to detect inward-facing vehicle surfaces
or a well shaft blocked above its water. `props.test.ts` checks vehicle alignment
and rejects footprints that intersect a wall even when their centre is free.
`urban-kit.spec.ts` verifies the actual runtime colours, instancing and linear
roof detail map in WebGL.

```sh
URBAN_SHOT=1 pnpm test:e2e tests/e2e/urban-kit.spec.ts --workers=1
```

That capture includes normal city views at 10:00 and 22:00, a residential facade
close-up, and three inspection arrangements of the runtime models in a cleared
park. The latter are art fixtures, not a settlement built through gameplay.

`URBAN_PROFILE=1 pnpm test:e2e tests/e2e/urban-kit.spec.ts --workers=1` compares
five frozen render frames with props, trim or prop shadows disabled in turn.
It synchronizes WebGL with `finish()` and reports submitted triangles and calls.
This diagnostic excludes simulation, camera motion and asset loading; it is not
a gameplay FPS benchmark.

## Defense surfaces and junctions

Walls now use authored masonry piers at orthogonal junctions, plus regular and
salvaged-sheet repair variants. Only adjacent walls and gates influence alignment.
The pier occupies the existing full navigation cell without stretching the wall's
bracing. Module rotation and tint vary deterministically by cell.

Structure materials preserve masonry, timber and hardware roughness/metalness.
`structureMaterial.ts` adds metre-scaled procedural grain, pores, rust and base
soiling; no external texture downloads or simulation randomness are required.
An instance damage attribute reveals dark fractures as health falls, alongside
subtle darkening. These are surface cracks, not destructible mesh fragments.

`structure-joints.spec.ts` renders real structure instances in L and T layouts,
checks unit-scale piers, excludes an adjacent well from wall connections, and
checks the damage attribute. `STRUCTURE_SHOT=1` saves its inspection image.
