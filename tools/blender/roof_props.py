"""
Generates the rooftop kit as GLB files: a water tank on legs, an AC unit, the
stair bulkhead, an antenna mast and a mushroom vent. Same contract as
`props.py`: Blender is Z-up, sizes are (x, y, z) metres, and propkit packs the
authored palette into vertex colours. Each piece uses one material batch and
a few hundred triangles because the city instances hundreds of them.

Usage (headless):
  blender --background --factory-startup --python tools/blender/roof_props.py -- <out_dir>
"""
import math
import os
import sys

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/props"
os.makedirs(OUT, exist_ok=True)


sys.path.insert(0, os.path.dirname(__file__))
from propkit import reset, mat, box, cyl, cone, beam, join, export as export_packed


def export(name, ob):
    export_packed(name, ob, OUT)


# --- water tank: four legs, cross braces, a drum and its conical lid --------
reset()
steel = mat("steel", (0.36, 0.37, 0.38), rough=0.6, metal=0.5)
drum = mat("drum", (0.55, 0.52, 0.47), rough=0.85)
rust = mat("rust", (0.36, 0.2, 0.12), rough=0.95)
for sx in (-0.7, 0.7):
    for sy in (-0.7, 0.7):
        box((0.1, 0.1, 1.5), (sx, sy, 0.75), material=steel)
for sy in (-0.7, 0.7):
    box((1.5, 0.06, 0.08), (0, sy, 0.7), material=steel)
box((1.65, 1.65, 0.1), (0, 0, 1.52), material=steel)
cyl(0.85, 1.7, (0, 0, 2.42), verts=16, material=drum)
cyl(0.87, 0.12, (0, 0, 1.9), verts=16, material=rust)
cone(0.92, 0.12, 0.5, (0, 0, 3.52), verts=16, material=rust)
# Raised seams, an access ladder and bracing give the silhouette a purpose.
for z in (1.66, 2.35, 3.18):
    cyl(.87, .055, (0, 0, z), verts=16, material=steel)
for x in (-.22,.22):
    beam((x,-.93,.12),(x,-.93,3.38),.045,steel)
for i in range(11):
    beam((-.24,-.93,.18+i*.29),(.24,-.93,.18+i*.29),.035,steel)
for y in (-.7,.7):
    beam((-.7,y,.15),(.7,y,1.4),.055,steel)
export("roof_tank", join("roof_tank"))

# --- AC unit: casing, fan grille on top, two refrigerant pipes --------------
reset()
casing = mat("casing", (0.5, 0.5, 0.49), rough=0.7, metal=0.2)
dark = mat("grille", (0.12, 0.12, 0.12), rough=0.8)
pipe = mat("pipe", (0.3, 0.3, 0.3), rough=0.5, metal=0.6)
box((1.4, 0.95, 0.85), (0, 0, 0.47), material=casing)
cyl(0.36, 0.06, (0, 0, 0.92), verts=14, material=dark)
box((0.06, 0.6, 0.55), (0.72, 0, 0.45), material=dark)
for sy in (-0.2, 0.0):
    cyl(0.04, 0.9, (-0.78, sy, 0.3), rot=(0, math.pi / 2, 0), verts=6, material=pipe)
box((1.5, 1.05, 0.06), (0, 0, 0.03), material=pipe)
for y in (-.28,0,.28):
    box((1.16,.055,.025),(0,y,.963),material=pipe,bevel=0)
for x in (-.45,0,.45):
    box((.035,.7,.025),(x,0,.98),material=pipe,bevel=0)
for z in (.22,.34,.46,.58,.7):
    box((1.15,.018,.035),(0,-.485,z),material=dark,bevel=0)
for x in (-.52,.52):
    box((.12,1.1,.1),(x,0,.05),material=pipe)
export("roof_ac", join("roof_ac"))

# --- stair bulkhead: the box over the stairwell, its slab and a door --------
reset()
wall = mat("wall", (0.3, 0.29, 0.27), rough=0.9)
slab = mat("slab", (0.24, 0.24, 0.23), rough=0.9)
door = mat("door", (0.28, 0.3, 0.31), rough=0.6, metal=0.4)
box((2.6, 3.0, 2.5), (0, 0, 1.25), material=wall)
box((2.9, 3.3, 0.18), (0, 0, 2.59), material=slab)
box((1.0, 0.06, 2.05), (0, -1.53, 1.03), material=door)
box((0.3, 0.3, 0.6), (0.8, 0.9, 2.98), material=slab)
for x in (-.56,.56):
    box((.08,.12,2.16),(x,-1.55,1.08),material=slab)
box((1.2,.12,.09),(0,-1.55,2.13),material=slab)
box((.035,.07,.23),(.34,-1.6,1.03),material=slab)
for z in (.3,.65,1,1.35,1.7):
    box((.85,.012,.025),(0,-1.57,z),material=slab,bevel=0)
box((.09,.09,2.65),(1.2,1.48,1.32),material=door)
box((1.25,.6,.12),(0,-1.6,.06),material=slab)
export("roof_stairs", join("roof_stairs"))

# --- antenna: a guyed mast with three crossbars -----------------------------
reset()
metal = mat("metal", (0.34, 0.35, 0.37), rough=0.5, metal=0.7)
box((0.6, 0.6, 0.08), (0, 0, 0.04), material=metal)
cyl(0.045, 4.2, (0, 0, 2.1), verts=6, material=metal)
for z, w in ((2.6, 1.4), (3.2, 1.1), (3.8, 0.8)):
    box((w, 0.04, 0.04), (0, 0, z), material=metal)
    box((0.04, w * 0.6, 0.04), (0, 0, z - 0.15), material=metal)
for x,y in ((.48,0),(-.3,.4),(-.3,-.4)):
    beam((x,y,.08),(0,0,2.1),.018,metal)
export("roof_antenna", join("roof_antenna"))

# --- mushroom vent: base, stem and cap --------------------------------------
reset()
metal = mat("metal", (0.48, 0.49, 0.5), rough=0.55, metal=0.6)
# Six sides: a vent is a few pixels from the RTS camera, and there is one on
# most roofs, so its triangles add up faster than anything else in the kit.
cyl(0.24, 0.08, (0, 0, 0.04), verts=6, material=metal)
cyl(0.14, 0.6, (0, 0, 0.36), verts=6, material=metal)
cone(0.34, 0.08, 0.2, (0, 0, 0.76), verts=6, material=metal)
for z in (.16,.58):
    cyl(.17,.035,(0,0,z),verts=8,material=metal)
export("roof_vent", join("roof_vent"))
