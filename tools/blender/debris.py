"""Author the litter kit: what a city leaves on the ground after the fall.
Blender Z-up, metres, deterministic (seeded) shapes and palettes. Every piece is
low and cosmetic: the runtime never collides with it.
Run: blender --background --factory-startup --python tools/blender/debris.py
"""
import math
import os
import random
import sys
import bpy
sys.path.insert(0, os.path.dirname(__file__))
from propkit import reset, mat, box, cyl, beam, join, export

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/props"
os.makedirs(OUT, exist_ok=True)


def lump(radius, loc, scale, material, rng, subdivisions=1, jitter=.22, flat=0.0):
    """A deformed ico sphere: a bag, a clod, a sack. `flat` presses the bottom onto the ground."""
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=subdivisions, location=(0, 0, 0))
    ob = bpy.context.object
    for v in ob.data.vertices:
        k = 1 + (rng.random() - .5) * 2 * jitter
        v.co.x *= scale[0] * k
        v.co.y *= scale[1] * k
        v.co.z *= scale[2] * k
        if flat and v.co.z < -radius * scale[2] * (1 - flat):
            v.co.z = -radius * scale[2] * (1 - flat)
    ob.location = loc
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    ob.data.materials.append(material)
    return ob


def chunk(size, loc, rng, material, tilt=.35):
    rot = ((rng.random() - .5) * tilt, (rng.random() - .5) * tilt, rng.random() * math.pi)
    return box(size, loc, rot=rot, material=material, bevel=.03)


def rubble():
    """Concrete fallen from a facade: slabs, blocks, brick, dust and bent rebar."""
    reset()
    rng = random.Random(11)
    concrete = mat("Broken concrete", (.13, .125, .11), category="masonry")
    pale = mat("Fresh fracture", (.2, .19, .165), category="masonry")
    brick = mat("Brick", (.22, .085, .05), category="masonry")
    dust = mat("Dust and grit", (.095, .088, .07), category="masonry")
    rebar = mat("Rusted rebar", (.21, .11, .06), category="hardware")
    # The heap's body, low and spread, so the pieces sit on something.
    lump(1, (0, 0, .05), (1.05, .8, .3), dust, rng, subdivisions=2, jitter=.18, flat=.55)
    for i in range(9):
        a = rng.random() * math.tau
        r = rng.random() * .75
        w = .25 + rng.random() * .45
        chunk((w, w * (.5 + rng.random() * .5), .1 + rng.random() * .18),
              (math.cos(a) * r, math.sin(a) * r * .8, .22 + (1 - r) * .2), rng,
              pale if i % 3 == 0 else concrete, tilt=.9)
    # A slab off a balcony, broken across, leaning on the heap.
    box((1.05, .62, .09), (-.18, .12, .42), rot=(.42, -.18, .3), material=concrete, bevel=.02)
    for i in range(7):
        a = rng.random() * math.tau
        r = .5 + rng.random() * .55
        chunk((.21, .1, .065), (math.cos(a) * r, math.sin(a) * r * .8, .05), rng, brick, tilt=.5)
    for i in range(4):
        x, y = (rng.random() - .5) * .7, (rng.random() - .5) * .5
        beam((x, y, .3), (x + (rng.random() - .5) * .5, y + (rng.random() - .5) * .4, .62 + rng.random() * .3), .022, rebar)


def bags():
    """Bin bags dumped against a wall, one split open."""
    reset()
    rng = random.Random(23)
    black = mat("Black bin bag", (.035, .04, .04))
    blue = mat("Blue bag", (.07, .14, .23))
    grey = mat("Grey sack", (.17, .17, .15))
    spill = mat("Spilled waste", (.11, .095, .06))
    paper = mat("Paper", (.36, .34, .29))
    spots = [(-.45, -.05, .9), (.1, .12, 1.0), (.55, -.1, .85), (-.1, -.38, .8), (.42, .36, .75), (-.55, .4, .7)]
    for k, (x, y, s) in enumerate(spots):
        material = black if k % 3 != 2 else (blue if k == 2 else grey)
        lump(.32 * s, (x, y, .24 * s), (1, .9, .82), material, rng, subdivisions=2, jitter=.16, flat=.45)
        # The knot.
        lump(.07 * s, (x + .03, y, .5 * s), (1, 1, 1.4), material, rng, subdivisions=1, jitter=.2)
    lump(.4, (.95, -.15, .03), (1.1, .8, .14), spill, rng, subdivisions=2, jitter=.25, flat=.6)
    for i in range(6):
        box((.2, .14, .006), (.7 + rng.random() * .6, -.5 + rng.random() * .7, .07), rot=(0, 0, rng.random() * math.pi),
            material=paper, bevel=0)
    box((.3, .2, .22), (1.1, .25, .11), rot=(0, 0, .5), material=grey, bevel=.02)


def tires():
    """Old tyres: two lying stacked, one on its side, one half sunk."""
    reset()
    rubber = mat("Perished rubber", (.04, .042, .04))
    worn = mat("Worn tread", (.085, .085, .08))
    steel = mat("Rusted rim", (.23, .13, .07), category="hardware")

    def tyre(loc, rot, material):
        bpy.ops.mesh.primitive_torus_add(major_radius=.31, minor_radius=.11, major_segments=14, minor_segments=6,
                                         location=loc, rotation=rot)
        ob = bpy.context.object
        ob.scale = (1, 1, .85)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        ob.data.materials.append(material)

    tyre((0, 0, .1), (0, 0, 0), rubber)
    tyre((.06, .03, .29), (.06, 0, 0), worn)
    tyre((.75, .25, .4), (math.pi / 2, 0, .4), rubber)
    cyl(.2, .14, (.75, .25, .4), rot=(math.pi / 2, 0, .4), verts=10, material=steel)
    tyre((-.6, .5, .05), (.25, .1, 1.1), worn)


def planks():
    """A broken pallet, loose boards and a sheet of corrugated roofing."""
    reset()
    rng = random.Random(37)
    timber = mat("Grey timber", (.17, .145, .11), category="timber")
    pale = mat("Split boards", (.25, .2, .13), category="timber")
    zinc = mat("Corrugated zinc", (.22, .225, .21), category="hardware")
    rust = mat("Rust bloom", (.29, .15, .07), category="hardware")
    # Pallet, one end collapsed.
    for y in (-.45, 0, .45):
        box((1.2, .1, .1), (0, y, .05), rot=(0, .06 if y > 0 else 0, 0), material=timber, bevel=.01)
    for i in range(6):
        if i == 4:
            continue
        x = -.5 + i * .2
        box((.14, 1.0, .025), (x, 0, .115 + (.03 if i == 5 else 0)), rot=(0, 0, (rng.random() - .5) * .08),
            material=pale if i % 2 else timber, bevel=0)
    for i in range(5):
        box((.12, .9 + rng.random() * .7, .025), (.95 + rng.random() * .5, (rng.random() - .5) * .6, .02 + i * .025),
            rot=(0, 0, (rng.random() - .5) * 1.1), material=pale if i % 2 else timber, bevel=0)
    # Roofing sheet: a corrugated profile, bent where it hit the ground.
    ridges = 8
    for r in range(ridges):
        x = -.7 + r * .14
        box((.075, 1.3, .012), (x, -.95, .09 + .03 * (r % 2)), rot=(.1, (.35 if r % 2 else -.35), 0),
            material=rust if r in (2, 5) else zinc, bevel=0)
    box((1.15, .06, .03), (-.21, -1.58, .14), rot=(.1, 0, 0), material=rust, bevel=0)


def mattress():
    """A mattress dragged out and left in the rain, and a chair with a leg gone."""
    reset()
    rng = random.Random(41)
    cloth = mat("Stained ticking", (.27, .25, .2))
    stain = mat("Water stain", (.12, .1, .06))
    seam = mat("Piping", (.27, .29, .3))
    wood = mat("Chair wood", (.27, .17, .1), category="timber")
    box((1.9, .95, .2), (0, 0, .13), rot=(0, .05, .03), material=cloth, bevel=.07)
    for _ in range(6):
        box((.35 + rng.random() * .5, .25 + rng.random() * .35, .01), ((rng.random() - .5) * 1.3, (rng.random() - .5) * .5, .24),
            rot=(0, .05, rng.random()), material=stain, bevel=0)
    for y in (-.47, .47):
        box((1.92, .03, .03), (0, y, .23), rot=(0, .05, .03), material=seam, bevel=0)
    for x in (-.6, -.2, .2, .6):
        for y in (-.2, .2):
            cyl(.025, .01, (x, y, .235), verts=6, material=seam)
    # The chair lies on its back beside the mattress.
    cx, cy = 1.35, .55
    box((.45, .45, .05), (cx, cy, .26), rot=(1.2, 0, .3), material=wood, bevel=.01)
    box((.45, .05, .55), (cx + .06, cy - .22, .05), rot=(0, 0, .3), material=wood, bevel=.01)
    for dx, dy in ((-.18, .2), (.18, .2), (.18, -.05)):
        beam((cx + dx, cy + dy, .1), (cx + dx, cy + dy + .15, .5), .04, wood)
    beam((cx - .6, cy - .5, .02), (cx - .2, cy - .45, .03), .04, wood)


for name, build in dict(litter_rubble=rubble, litter_bags=bags, litter_tires=tires,
                        litter_planks=planks, litter_mattress=mattress).items():
    build()
    export(name, join(name), OUT)
