"""
Generates the low-poly prop kit as GLB files: the abandoned car, the dumpster,
the fence, the sign, the lamp post and the jersey barrier.

Blender is Z-up: every size below is (x, y, z) metres, with z the height. The
exporter converts to Y-up for the renderer.

Everything is built from primitives with flat materials, so it matches the
game's look (no textures, colour comes from the material) and each prop stays
under a few hundred triangles.

Usage (headless):
  blender --background --factory-startup --python tools/blender/props.py -- <out_dir>
"""
import math
import os
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/props"
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def box(size, loc, rot=(0, 0, 0), material=None):
    """Box of `size` (x, y, z) metres centred at `loc`."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if material:
        ob.data.materials.append(material)
    return ob


def cyl(radius, depth, loc, rot=(0, 0, 0), verts=10, material=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.object
    if material:
        ob.data.materials.append(material)
    return ob


def join(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0] if bpy.context.selected_objects else None
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
    print(f"PROP {name} verts={len(ob.data.vertices)} tris={tris} bytes={os.path.getsize(path)}")


# --- abandoned car: body, cabin, four wheels, headlights --------------------
reset()
body_mat = mat("car_body", (0.30, 0.33, 0.36), rough=0.55, metal=0.3)
glass_mat = mat("car_glass", (0.09, 0.11, 0.12), rough=0.25)
tyre_mat = mat("tyre", (0.05, 0.05, 0.05), rough=0.95)
lamp_mat = mat("lamp", (0.90, 0.86, 0.70), rough=0.3)
box((1.80, 4.30, 0.62), (0, 0, 0.62), material=body_mat)
box((1.66, 2.10, 0.58), (0, -0.15, 1.14), material=glass_mat)
for sx in (-0.86, 0.86):
    for sy in (-1.35, 1.35):
        cyl(0.33, 0.22, (sx, sy, 0.33), rot=(0, math.pi / 2, 0), material=tyre_mat)
for sx in (-0.58, 0.58):
    box((0.34, 0.08, 0.16), (sx, 2.16, 0.70), material=lamp_mat)
export("car", join("car"))

# --- dumpster: body, sloped lid, two wheels ---------------------------------
reset()
steel = mat("steel", (0.18, 0.31, 0.24), rough=0.7, metal=0.2)
rust = mat("rust", (0.28, 0.16, 0.10), rough=0.95)
# `reset()` frees the previous scene's data, so materials are made per prop.
tyre_mat = mat("tyre", (0.05, 0.05, 0.05), rough=0.95)
box((2.20, 1.30, 1.10), (0, 0, 0.66), material=steel)
box((2.26, 1.36, 0.08), (0, -0.03, 1.26), rot=(0.07, 0, 0), material=rust)
for sx in (-0.85, 0.85):
    cyl(0.14, 0.10, (sx, 0.52, 0.14), rot=(0, math.pi / 2, 0), material=tyre_mat)
export("dumpster", join("dumpster"))

# --- fence: two posts and three rails ---------------------------------------
reset()
wood = mat("wood", (0.32, 0.26, 0.19), rough=0.95)
for sx in (-1.0, 1.0):
    box((0.12, 0.12, 1.35), (sx, 0, 0.67), material=wood)
for z in (0.35, 0.78, 1.18):
    box((2.12, 0.07, 0.14), (0, 0, z), material=wood)
export("fence", join("fence"))

# --- sign: post and panel ---------------------------------------------------
reset()
post = mat("post", (0.35, 0.36, 0.38), rough=0.7, metal=0.4)
panel = mat("panel", (0.75, 0.72, 0.62), rough=0.85)
box((0.09, 0.09, 2.20), (0, 0, 1.10), material=post)
box((1.10, 0.06, 0.72), (0, 0, 1.95), material=panel)
export("sign", join("sign"))

# --- lamp post: pole, arm, head --------------------------------------------
reset()
metal = mat("metal", (0.30, 0.31, 0.33), rough=0.5, metal=0.6)
glow = mat("glow", (1.00, 0.92, 0.72), rough=0.2)
cyl(0.09, 5.40, (0, 0, 2.70), verts=10, material=metal)
box((0.90, 0.09, 0.09), (0.45, 0, 5.32), material=metal)
box((0.50, 0.28, 0.14), (0.85, 0, 5.20), material=glow)
export("lamp", join("lamp"))

# --- jersey barrier: tapered profile, wider at the base --------------------
reset()
concrete = mat("concrete", (0.55, 0.54, 0.50), rough=0.95)
half_w, half_d, h = 1.00, 0.30, 0.84

# Six-vertex profile in the XZ plane, extruded along Y.
profile = [
    (-half_w, 0.0),
    (half_w, 0.0),
    (half_w, 0.16),
    (half_w * 0.42, h),
    (-half_w * 0.42, h),
    (-half_w, 0.16),
]
verts = []
for y in (-half_d, half_d):
    for x, z in profile:
        verts.append((x, y, z))
faces = []
n = len(profile)
for i in range(n):
    j = (i + 1) % n
    faces.append((i, j, n + j, n + i))
faces.append(tuple(range(n - 1, -1, -1)))
faces.append(tuple(range(n, 2 * n)))

mesh = bpy.data.meshes.new("barrier")
mesh.from_pydata(verts, [], faces)
mesh.validate()
mesh.update()
ob = bpy.data.objects.new("barrier", mesh)
bpy.context.scene.collection.objects.link(ob)
ob.data.materials.append(concrete)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.shade_flat()
export("barrier", ob)

print("PROPS DONE")
