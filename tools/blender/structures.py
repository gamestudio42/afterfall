"""
Generates the player-built structures as GLB files: the wall, the gate, the watch
tower, the garden and the well.

Before this kit every structure was the same box scaled per kind, so a tower and a
wall differed only in height and colour. Each model below is authored to the footprint
the simulation already uses (one navigation cell is 2 m), with Z up and the front
facing -Y. Authored colours are packed by propkit into one material batch per model.

Usage (headless):
  blender --background --factory-startup --python tools/blender/structures.py -- <out_dir>
"""
import math
import os
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/structures"
os.makedirs(OUT, exist_ok=True)


sys.path.insert(0, os.path.dirname(__file__))
from propkit import reset, mat, box, cyl, beam, mesh, join, export as export_packed


CONCRETE = None
WOOD = None
METAL = None
SOIL = None
PLANT = None
STONE = None
WATER = None


def materials():
    global CONCRETE, WOOD, METAL, SOIL, PLANT, STONE, WATER
    CONCRETE = mat("concrete", (0.48, 0.45, 0.41), 0.95)
    WOOD = mat("wood", (0.42, 0.30, 0.18), 0.9)
    # Metalness stays low: three.js has no environment map here, and a metallic
# surface without one renders black.
    METAL = mat("metal", (0.46, 0.48, 0.51), 0.65, 0.15)
    SOIL = mat("soil", (0.23, 0.16, 0.11), 1.0)
    PLANT = mat("plant", (0.27, 0.44, 0.16), 0.95)
    STONE = mat("stone", (0.55, 0.53, 0.49), 0.95)
    WATER = mat("water", (0.20, 0.32, 0.36), 0.3)


def export(name, ob):
    export_packed(name, ob, OUT)


def wall():
    """2 m of wall, 2.6 m tall: a concrete slab, timber bracing on both faces, a ruined top."""
    reset()
    materials()
    parts = []
    parts.append(box((2.0, 0.50, 1.9), (0, 0, 0.95), material=CONCRETE))
    parts.append(box((2.0, 0.44, 0.7), (0, 0, 2.25), material=CONCRETE))
    # A broken top: two blocks of different heights, so the silhouette is not a slab.
    parts.append(box((0.9, 0.38, 0.26), (-0.5, 0, 2.73), material=CONCRETE))
    parts.append(box((0.5, 0.36, 0.16), (0.66, 0, 2.68), material=CONCRETE))
    # A timber band across both faces and a diagonal brace, what makes it read as
    # something people built rather than a poured block.
    for y in (-0.24, 0.24):
        parts.append(box((2.0, 0.10, 0.16), (0, y, 1.35), material=WOOD))
        brace = box((0.12, 0.10, 1.5), (-0.62, y - 0.02 * (1 if y > 0 else -1), 0.85), material=WOOD)
        brace.rotation_euler = (0, math.radians(24), 0)
        bpy.ops.object.transform_apply(rotation=True)
        parts.append(brace)
    for x in (-0.85, 0.85):
        parts.append(box((0.16, 0.60, 0.16), (x, 0, 1.9), material=WOOD))
    # Rubble at the foot.
    parts.append(box((0.5, 0.35, 0.18), (-0.6, 0.28, 0.09), material=CONCRETE))
    parts.append(box((0.35, 0.3, 0.14), (0.5, -0.3, 0.07), material=CONCRETE))
    # Mortar seams and bolt plates break up the broad concrete face.
    dark = mat("Mortar", (.16,.15,.12))
    for side in (-1,1):
        for z in (.58,1.18,1.88):
            parts.append(box((1.94,.012,.025),(0,side*.258,z),material=dark,bevel=0))
        for x,z in ((-.55,.88),(.5,1.57),(-.1,2.25)):
            parts.append(box((.025,.012,.5),(x,side*.258,z),material=dark,bevel=0))
        for x in (-.8,.8):
            parts.append(cyl(.038,.035,(x,side*.31,1.35),rot=(math.pi/2,0,0),verts=6,material=METAL))
    return join("wall", parts)


def gate():
    """A 2 m gateway: two posts, a timber lintel and a closed steel-bar leaf."""
    reset()
    materials()
    parts = []
    for x in (-0.95, 0.95):
        parts.append(box((0.30, 0.42, 2.1), (x, 0, 1.05), material=CONCRETE))
        parts.append(box((0.38, 0.50, 0.16), (x, 0, 0.08), material=CONCRETE))
    # Lintel over the opening.
    parts.append(box((2.2, 0.36, 0.22), (0, 0, 2.2), material=WOOD))
    parts.append(box((2.2, 0.10, 0.10), (0, 0, 2.33), material=WOOD))
    # The leaf: a frame, vertical bars, a diagonal brace and two hinges.
    parts.append(box((1.56, 0.07, 0.09), (0, 0, 1.86), material=METAL))
    parts.append(box((1.56, 0.07, 0.09), (0, 0, 0.18), material=METAL))
    parts.append(box((0.09, 0.07, 1.72), (-0.76, 0, 1.02), material=METAL))
    parts.append(box((0.09, 0.07, 1.72), (0.76, 0, 1.02), material=METAL))
    for i in range(7):
        x = -0.66 + i * 0.22
        parts.append(box((0.055, 0.055, 1.7), (x, 0, 1.02), material=METAL))
    diagonal = box((0.06, 0.06, 1.95), (0, 0, 1.02), material=METAL)
    diagonal.rotation_euler = (0, math.radians(38), 0)
    bpy.ops.object.transform_apply(rotation=True)
    parts.append(diagonal)
    for z in (0.55, 1.55):
        parts.append(box((0.22, 0.12, 0.09), (-0.9, 0, z), material=METAL))
    for x in (-.4,.4):
        parts.append(box((.07,.12,.22),(x,-.075,1.05),material=WOOD))
    parts.append(box((.2,.12,.07),(.55,-.11,1.04),material=WOOD))
    return join("gate", parts)


def tower():
    """A 4 m square watch tower, just over 6 m tall: legs, a railed platform, a roof."""
    reset()
    materials()
    parts = []
    half = 1.6
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box((0.20, 0.20, 4.6), (sx * half, sy * half, 2.3), material=WOOD))
    for z in (1.1, 2.6):
        parts.append(box((half * 2 + 0.2, 0.10, 0.10), (0, -half, z), material=WOOD))
        parts.append(box((half * 2 + 0.2, 0.10, 0.10), (0, half, z), material=WOOD))
        parts.append(box((0.10, half * 2 + 0.2, 0.10), (-half, 0, z), material=WOOD))
        parts.append(box((0.10, half * 2 + 0.2, 0.10), (half, 0, z), material=WOOD))
    # Platform.
    parts.append(box((half * 2 + 0.3, half * 2 + 0.3, 0.16), (0, 0, 4.68), material=WOOD))
    # Railing: corner and mid posts, two rails, open at the -Y side for the ladder.
    rail_z = (5.24, 5.62)
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            if sx == 0 and sy == -1:
                continue
            parts.append(box((0.09, 0.09, 1.0), (sx * (half + 0.1), sy * (half + 0.1), 5.26), material=WOOD))
    for sx in (-1, 1):
        for sy in (-0.5, 0, 0.5):
            parts.append(box((0.09, 0.09, 1.0), (sx * (half + 0.1), sy * (half + 0.1), 5.26), material=WOOD))
    for z in rail_z:
        parts.append(box((half * 2 + 0.3, 0.07, 0.07), (0, half + 0.1, z), material=WOOD))
        parts.append(box((0.07, half * 2 + 0.3, 0.07), (-half - 0.1, 0, z), material=WOOD))
        parts.append(box((0.07, half * 2 + 0.3, 0.07), (half + 0.1, 0, z), material=WOOD))
        parts.append(box((half * 2 + 0.3, 0.07, 0.07), (0, -half - 0.1, z), material=WOOD))
    # Sandbags stacked on the open face.
    for row, z in enumerate((4.86, 5.08)):
        for i in range(4):
            parts.append(
                box((0.52, 0.30, 0.20), (-1.0 + i * 0.66 + (0.3 if row else 0), -half + 0.12, z), material=STONE)
            )
    # Roof: four posts and a sheet, slightly smaller than the platform and tilted.
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box((0.10, 0.10, 0.55), (sx * half, sy * half, 5.95), material=WOOD))
    roof = box((half * 2 + 0.5, half * 2 + 0.5, 0.09), (0, 0, 6.26), material=METAL)
    roof.rotation_euler = (math.radians(5), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    parts.append(roof)
    # Ladder, from the ground to the platform.
    for sx in (-0.32, 0.32):
        parts.append(box((0.07, 0.07, 4.6), (sx, -half - 0.2, 2.3), material=METAL))
    for i in range(10):
        parts.append(box((0.70, 0.06, 0.05), (0, -half - 0.2, 0.3 + i * 0.44), material=METAL))
    for side in (-1,1):
        parts.append(beam((-half,side*half,.25),(half,side*half,4.5),.12,WOOD))
    for x in (-1.5,-1,-.5,0,.5,1,1.5):
        parts.append(box((.055,3.6,.055),(x,0,6.34),rot=(math.radians(5),0,0),material=METAL,bevel=0))
    for y in (-1.3,-.8,-.3,.2,.7,1.2):
        parts.append(box((3.3,.025,.012),(0,y,4.77),material=METAL,bevel=0))
    return join("tower", parts)


def garden():
    """An 8 m plot: five raised beds, cabbages, a low fence and a water barrel."""
    reset()
    materials()
    parts = []
    for i in range(5):
        y = -3.0 + i * 1.5
        parts.append(box((7.0, 1.0, 0.26), (0, y, 0.13), material=SOIL))
        for edge in (-.52,.52):
            parts.append(box((7.1,.07,.3),(0,y+edge,.15),material=WOOD))
        # Two rows of cabbages per bed, sized to read from the game camera.
        for row in (-0.24, 0.24):
            for j in range(7):
                x = -2.9 + j * 0.97
                bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.30, location=(x, y + row, 0.40))
                plant = bpy.context.object
                plant.scale = (1.0, 1.0, 0.8)
                bpy.ops.object.transform_apply(scale=True)
                plant.data.materials.append(PLANT)
                parts.append(plant)
    # Fence on three sides, open on the +Y side where the workers come in.
    for i in range(6):
        parts.append(box((0.10, 0.10, 0.95), (-3.7, -3.7 + i * 1.5, 0.47), material=WOOD))
        parts.append(box((0.10, 0.10, 0.95), (3.7, -3.7 + i * 1.5, 0.47), material=WOOD))
    for i in range(5):
        parts.append(box((0.10, 0.10, 0.95), (-3.7 + i * 1.85, -3.7, 0.47), material=WOOD))
    for z in (0.45, 0.85):
        parts.append(box((0.06, 7.6, 0.06), (-3.7, 0, z), material=WOOD))
        parts.append(box((0.06, 7.6, 0.06), (3.7, 0, z), material=WOOD))
        parts.append(box((7.6, 0.06, 0.06), (0, -3.7, z), material=WOOD))
    # Water barrel and a crate in the corner.
    parts.append(cyl(0.34, 0.85, (3.0, 3.1, 0.42), verts=10, material=WOOD))
    parts.append(cyl(0.29, 0.04, (3.0, 3.1, 0.86), verts=10, material=WATER))
    parts.append(box((0.55, 0.45, 0.45), (-3.0, 3.1, 0.22), material=WOOD))
    return join("farm", parts)


def well():
    """A well pit with a stone rim, an A-frame, a rope and a bucket, under a small roof."""
    reset()
    materials()
    parts = []
    # Individual annular bricks leave the shaft genuinely open above the water.
    for row in range(3):
        z0 = row*.35 if row < 2 else .7
        z1 = z0 + (.335 if row < 2 else .13)
        outer = .97 if row < 2 else 1.02
        for i in range(12):
            a = (i + (row%2)*.5)*math.tau/12 + .012
            b = a + math.tau/12 - .024
            ring = [(r*math.cos(t),r*math.sin(t)) for r,t in ((.7,a),(outer,a),(outer,b),(.7,b))]
            vertices = [(x,y,z) for z in (z0,z1) for x,y in ring]
            faces = [(3,2,1,0),(4,5,6,7)]+[(k,(k+1)%4,(k+1)%4+4,k+4) for k in range(4)]
            parts.append(mesh("Well stone",vertices,faces,STONE))
    parts.append(cyl(.72,.025,(0,0,.18),verts=16,material=WATER))
    # A-frame and windlass.
    for sx in (-0.9, 0.9):
        parts.append(box((0.13, 0.13, 1.75), (sx, 0, 1.42), material=WOOD))
    parts.append(box((1.9, 0.14, 0.14), (0, 0, 2.2), material=WOOD))
    parts.append(cyl(0.07, 1.62, (0, 0, 2.02), rot=(0, math.radians(90), 0), verts=8, material=WOOD))
    parts.append(cyl(0.05, 0.05, (0.55, 0, 2.02), rot=(0, math.radians(90), 0), verts=6, material=METAL))
    # Rope from the windlass down to the bucket.
    parts.append(box((0.035, 0.035, 0.72), (0, 0, 1.62), material=STONE))
    parts.append(cyl(0.17, 0.28, (0, 0, 1.12), verts=8, material=WOOD))
    parts.append(cyl(0.15, 0.03, (0, 0, 1.27), verts=8, material=WATER))
    # Roof: four short posts and a small sheet.
    # The canopy sits on the A-frame's crossbar instead of floating above it: a plate on
    # stilts read as a table from the game camera, which is what this replaced.
    roof = box((1.35, 0.85, 0.06), (0, 0, 2.34), material=METAL)
    roof.rotation_euler = (math.radians(7), 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    parts.append(roof)
    return join("well", parts)


def main():
    models = {"wall": wall, "gate": gate, "tower": tower, "farm": garden, "well": well}
    for name, build in models.items():
        ob = build()
        export(name, ob)
    print(f"STRUCTURES {len(models)} models written to {OUT}")


main()
