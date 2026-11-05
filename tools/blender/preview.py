"""
Renders a preview of every prop in the kit, so an exported GLB can be looked at
instead of trusted. Uses the Workbench engine: no lights, no samples, fast.

Usage:
  blender --background --factory-startup --python tools/blender/preview.py -- <props_dir> <out_dir>
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
SRC = args[0]
OUT = args[1]
os.makedirs(OUT, exist_ok=True)

names = sorted(f[:-4] for f in os.listdir(SRC) if f.endswith(".glb"))

for name in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f"{name}.glb"))
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        print(f"PREVIEW {name} no mesh")
        continue

    # Bounding box of the whole kit piece.
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.2)

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    direction = Vector((1.0, -1.4, 0.9)).normalized()
    cam.location = center + direction * radius * 3.0
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (center - cam.location).to_track_quat("-Z", "Y")
    cam_data.lens = 50
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 220
    scene.render.resolution_y = 220
    scene.render.film_transparent = False
    scene.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {name} {scene.render.filepath}")

print("PREVIEW DONE")
