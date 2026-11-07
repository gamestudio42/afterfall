"""
Generates the infected walking model as a GLB: one hunched silhouette that
replaces the capsule the renderer has used since phase 5.

Blender is Z-up: every coordinate below is metres, the feet sit on z = 0 and the
model faces -Y, the same convention `walker.glb` was authored in. The exporter
converts to Y-up, so the renderer receives a model facing +Z.

The point of the model is legibility at RTS distance, not detail: a broken spine,
arms long enough to reach past the knees, torn cloth and two emissive eyes. Three
materials only (`skin`, `rags`, `eyes`) so the renderer draws it with three
instanced meshes, exactly like the survivor kit: `skin` carries the per-kind tint,
`rags` stays dark, `eyes` is emissive so the infected read at night.

The kind is not modelled here. `INFECTED[kind].scale` and `.color` in
`@afterfall/content` already separate walker, runner and brute, and the renderer
feeds both into the instance matrix and the skin colour, so one mesh covers the
three kinds with no extra draw call.

Usage (headless):
  blender --background --factory-startup --python tools/blender/infected.py -- <out_dir>

Then look at it instead of trusting it:
  blender --background --factory-startup --python tools/blender/preview.py -- \
    apps/web/public/art/infected ~/.hermes/cache/scratch/infected-preview
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/infected"
os.makedirs(OUT, exist_ok=True)

FRONT = -1.0  # the model looks down -Y, as walker.glb does


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.85, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        # Blender 4+ names the socket "Emission Color"; older builds said
        # "Emission". Both are tried so the script survives either.
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emit, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


def obj_from(name, verts, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate()
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = False
    return ob


def slab(name, size, loc, rot=(0.0, 0.0, 0.0), material=None):
    """Box of `size` (x, y, z) metres, rotated by an XYZ Euler, centred at `loc`."""
    hx, hy, hz = (s / 2 for s in size)
    basis = Euler(rot, "XYZ").to_matrix()
    verts = []
    for sx, sy, sz in (
        (-1, -1, -1),
        (1, -1, -1),
        (1, 1, -1),
        (-1, 1, -1),
        (-1, -1, 1),
        (1, -1, 1),
        (1, 1, 1),
        (-1, 1, 1),
    ):
        local = Vector((sx * hx, sy * hy, sz * hz))
        verts.append(basis @ local + Vector(loc))
    faces = [
        (0, 1, 2, 3),
        (7, 6, 5, 4),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    return obj_from(name, verts, faces, material)


def prism(name, p0, p1, r0, r1, material, sides=6, roll=0.0):
    """Tapered prism between two points: limbs, neck, torso, sleeves."""
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    if axis.length < 1e-6:
        raise ValueError(f"{name}: zero-length prism")
    basis = axis.normalized().to_track_quat("Z", "Y")
    verts = []
    for radius, base in ((r0, p0), (r1, p1)):
        for k in range(sides):
            a = roll + 2 * math.pi * k / sides
            verts.append(base + basis @ Vector((math.cos(a) * radius, math.sin(a) * radius, 0)))
    faces = []
    for k in range(sides):
        n = (k + 1) % sides
        faces.append((k, n, sides + n, sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    return obj_from(name, verts, faces, material)


def move(ob, rot=(0.0, 0.0, 0.0), loc=(0.0, 0.0, 0.0)):
    """Rotates and translates an existing mesh, for parts authored in local space."""
    basis = Euler(rot, "XYZ").to_matrix()
    for v in ob.data.vertices:
        v.co = basis @ v.co + Vector(loc)
    return ob


def join(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    if len(bpy.context.selected_objects) > 1:
        bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    return ob


def export(name, ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_cameras=False,
        export_lights=False,
    )
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    lo = Vector((min(v.co.x for v in ob.data.vertices), min(v.co.y for v in ob.data.vertices), min(v.co.z for v in ob.data.vertices)))
    hi = Vector((max(v.co.x for v in ob.data.vertices), max(v.co.y for v in ob.data.vertices), max(v.co.z for v in ob.data.vertices)))
    slots = ", ".join(m.name for m in ob.data.materials)
    print(
        f"INFECTED {name} verts={len(ob.data.vertices)} tris={tris} bytes={os.path.getsize(path)} "
        f"bbox_min={tuple(round(v, 3) for v in lo)} bbox_max={tuple(round(v, 3) for v in hi)} "
        f"height={hi.z - lo.z:.3f} materials=[{slots}]"
    )


reset()

# `skin` is white on purpose: the renderer tints it with INFECTED[kind].color, so
# the base colour must not pre-darken it. `rags` stays nearly black and `eyes`
# is the only emissive surface, which is what makes a horde readable at night.
skin = mat("skin", (1.0, 1.0, 1.0), rough=0.8)
rags = mat("rags", (0.16, 0.15, 0.13), rough=0.95)
eyes = mat("eyes", (0.10, 0.12, 0.06), rough=0.4, emit=(0.62, 0.95, 0.36), emit_strength=6.0)

# --- pelvis and spine: hips low and pushed back, chest pulled forward ---------
slab("pelvis", (0.30, 0.22, 0.20), (0, 0.02, 0.94), (0.12, 0, 0), rags)
prism("torso", (0, 0.02, 1.00), (0, -0.07, 1.34), 0.15, 0.185, skin)
slab("chest", (0.38, 0.21, 0.26), (0, -0.06, 1.29), (0.30, 0, 0), rags)
slab("shoulders", (0.46, 0.20, 0.13), (0, -0.09, 1.40), (0.30, 0, 0), rags)
prism("neck", (0, -0.09, 1.40), (0.01, -0.20, 1.49), 0.055, 0.055, skin)

# Head is authored around its own origin, then tilted down and set crooked so the
# skull reads as broken rather than as a soldier looking straight ahead.
head_rot = (0.45, 0.0, 0.18)
head_loc = (0.015, -0.26, 1.55)
head = [
    move(slab("skull", (0.21, 0.23, 0.22), (0, 0, 0), material=skin), head_rot, head_loc),
    move(slab("jaw", (0.15, 0.13, 0.07), (0, -0.055, -0.10), (0.25, 0, 0), skin), head_rot, head_loc),
]
for sx in (-0.055, 0.055):
    head.append(move(slab(f"eye{sx:+.2f}", (0.05, 0.03, 0.032), (sx, -0.115, -0.005), material=eyes), head_rot, head_loc))

# --- arms: past the knees, one reaching forward, one hanging ------------------
prism("arm_upper_l", (0.235, -0.09, 1.38), (0.31, -0.33, 1.14), 0.075, 0.065, skin)
prism("arm_fore_l", (0.31, -0.33, 1.14), (0.27, -0.54, 0.97), 0.065, 0.05, skin)
slab("hand_l", (0.085, 0.13, 0.055), (0.27, -0.585, 0.945), (0.40, 0, 0), skin)
prism("arm_upper_r", (-0.235, -0.09, 1.38), (-0.30, -0.13, 1.08), 0.075, 0.065, skin)
prism("arm_fore_r", (-0.30, -0.13, 1.08), (-0.30, -0.22, 0.78), 0.065, 0.05, skin)
slab("hand_r", (0.085, 0.12, 0.05), (-0.30, -0.26, 0.745), (0.30, 0, 0), skin)

# --- legs: mid-stride, knees bent, the back foot up on its toes --------------
prism("thigh_l", (0.10, 0.02, 0.92), (0.115, -0.15, 0.50), 0.09, 0.075, skin)
prism("shin_l", (0.115, -0.15, 0.50), (0.115, -0.20, 0.09), 0.07, 0.05, skin)
slab("foot_l", (0.10, 0.24, 0.08), (0.115, -0.30, 0.045), (-0.05, 0, 0), skin)
prism("thigh_r", (-0.10, 0.02, 0.90), (-0.125, 0.10, 0.48), 0.09, 0.075, skin)
prism("shin_r", (-0.125, 0.10, 0.48), (-0.125, 0.19, 0.09), 0.07, 0.05, skin)
slab("foot_r", (0.10, 0.24, 0.08), (-0.125, 0.14, 0.055), (0.55, 0, 0), skin)

# --- cloth: a shirt over the chest, torn strips at the waist, short sleeves --
prism("shirt", (0, 0.02, 1.02), (0, -0.07, 1.33), 0.19, 0.215, rags)
for i, (angle, drop, width) in enumerate(
    [(-2.44, 0.20, 0.10), (-1.57, 0.30, 0.09), (-0.70, 0.16, 0.11), (0.17, 0.26, 0.08), (1.05, 0.19, 0.10), (1.92, 0.31, 0.09)]
):
    x = math.cos(angle) * 0.17
    y = math.sin(angle) * 0.17
    slab(f"hem{i}", (width, 0.025, drop), (x, y + 0.01, 1.02 - drop / 2), (0, 0, angle), rags)
prism("sleeve_l", (0.235, -0.09, 1.38), (0.27, -0.21, 1.26), 0.10, 0.085, rags)
prism("sleeve_r", (-0.235, -0.09, 1.38), (-0.27, -0.11, 1.23), 0.10, 0.085, rags)
prism("trousers_l", (0.10, 0.02, 0.96), (0.112, -0.09, 0.72), 0.115, 0.095, rags)
prism("trousers_r", (-0.10, 0.02, 0.94), (-0.118, 0.07, 0.70), 0.115, 0.095, rags)

export("infected", join("infected"))
print("INFECTED DONE")
