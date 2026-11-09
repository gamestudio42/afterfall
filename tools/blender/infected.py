"""
Generates the infected model as a GLB: six poses of a lurching walk, exported as six
objects (`pose0`…`pose5`) in one file, each with the same three materials.

Blender is Z-up, the model faces -Y (the same convention as `walker.glb`) and the
feet sit on z = 0. The exporter converts to Y-up, so the renderer receives a model
facing +Z.

Poses instead of a skeleton: the renderer draws units with `InstancedMesh`, which
cannot carry a skeleton, and one `SkinnedMesh` per infected would cost a draw call
per unit at six hundred of them. Six baked poses cost `6 x materials` draw calls for
the whole horde, and the renderer picks the pose from the distance each unit has
travelled, so the stagger matches the speed.

The point of the silhouette is legibility at RTS distance, not detail: a broken
spine, arms long enough to reach past the knees, torn cloth and two emissive eyes.
Three materials only (`skin`, `rags`, `eyes`): `skin` carries the per-kind tint,
`rags` stays dark, `eyes` is emissive so the infected read at night.

The kind is not modelled here: `INFECTED[kind].scale` and `.color` in
`@afterfall/content` separate walker, runner and brute, and the renderer feeds both
into the instance matrix and the skin colour.

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
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/infected"
os.makedirs(OUT, exist_ok=True)

POSES = 6
# Hunched: hips low, shoulders forward, arms hanging past the knees.
HIP_Z = 0.92
SHOULDER_Z = 1.36
THIGH = 0.44
SHIN = 0.42
UPPER_ARM = 0.46
FOREARM = 0.40
LEAN = 0.34
# The swung foot dips below the ground plane; every pose is lifted by this much so
# the planted foot rests on z = 0.
LIFT = 0.05

# Six keys of a walk: (left thigh, left knee, right thigh, right knee), radians,
# thigh positive forward and knee positive folding the shin back. A sine wave cannot
# do this job: sin(60 deg) == sin(120 deg) collapses six poses into two. Poses 3-5
# are the mirror of 0-2.
GAIT = (
    (0.46, 0.10, -0.40, 0.45),
    (0.08, 0.15, -0.04, 0.95),
    (-0.32, 0.55, 0.34, 0.35),
)


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


def swing(base, length, angle):
    """A point `length` below `base`, swung `angle` forward (the model faces -Y)."""
    return Vector(base) + Vector((0.0, -math.sin(angle) * length, -math.cos(angle) * length))


def build_pose(index, skin, rags, eyes):
    """One pose of the lurching walk, from the GAIT table."""
    key = GAIT[index % 3]
    if index >= 3:
        lt, lk, rt, rk = key[2], key[3], key[0], key[1]
    else:
        lt, lk, rt, rk = key

    dip = 0.04 if index % 3 == 1 else 0.0
    hip_z = HIP_Z - dip
    shoulder = (0.0, -0.10, SHOULDER_Z - dip)
    parts = []

    # Pelvis and spine: hips low and pushed back, chest pulled forward.
    parts.append(slab("pelvis", (0.30, 0.22, 0.20), (0, 0.02, hip_z), (0.12, 0, 0), rags))
    parts.append(prism("torso", (0, 0.02, hip_z + 0.06), shoulder, 0.15, 0.185, skin))
    parts.append(slab("chest", (0.38, 0.21, 0.26), (0, -0.07, 1.27 - dip), (LEAN, 0, 0), rags))
    parts.append(slab("shoulders", (0.46, 0.20, 0.13), (0, -0.10, 1.36 - dip), (LEAN, 0, 0), rags))
    parts.append(prism("neck", shoulder, (0.01, -0.21, 1.44 - dip), 0.055, 0.055, skin))

    # The head is authored around its own origin, then tilted down and set crooked
    # so the skull reads as broken rather than as a soldier looking ahead.
    head_rot = (0.45, 0.0, 0.18)
    head_loc = (0.015, -0.27, 1.50 - dip)
    head = [
        slab("skull", (0.21, 0.23, 0.22), (0, 0, 0), material=skin),
        slab("jaw", (0.15, 0.13, 0.07), (0, -0.055, -0.10), (0.25, 0, 0), skin),
    ]
    for sx in (-0.055, 0.055):
        head.append(slab(f"eye{sx:+.2f}", (0.05, 0.03, 0.032), (sx, -0.115, -0.005), material=eyes))
    for ob in head:
        basis = Euler(head_rot, "XYZ").to_matrix()
        for v in ob.data.vertices:
            v.co = basis @ v.co + Vector(head_loc)
        parts.append(ob)

    for side in (1, -1):
        thigh_angle, knee_bend = (lt, lk) if side > 0 else (rt, rk)
        hip = (0.10 * side, 0.02, hip_z)
        knee = swing(hip, THIGH, thigh_angle)
        ankle = swing(knee, SHIN, thigh_angle - knee_bend)
        parts.append(prism(f"thigh{side}", hip, knee, 0.09, 0.075, rags))
        parts.append(prism(f"shin{side}", knee, ankle, 0.07, 0.05, skin))
        parts.append(
            slab(f"foot{side}", (0.10, 0.24, 0.075), (ankle.x, ankle.y - 0.05, 0.04), (thigh_angle - knee_bend, 0, 0), skin)
        )

        # Long arms that counter-swing, the forearm trailing a little behind.
        shoulder_pt = (0.235 * side, -0.08, SHOULDER_Z - dip)
        arm_angle = -0.55 * thigh_angle + 0.12
        elbow = swing(shoulder_pt, UPPER_ARM, arm_angle)
        wrist = swing(elbow, FOREARM, arm_angle + 0.30)
        parts.append(prism(f"arm{side}", shoulder_pt, elbow, 0.075, 0.065, skin))
        parts.append(prism(f"fore{side}", elbow, wrist, 0.06, 0.048, skin))
        parts.append(slab(f"hand{side}", (0.085, 0.13, 0.055), (wrist.x, wrist.y, wrist.z - 0.02), (arm_angle, 0, 0), skin))

    # Cloth: a shirt over the chest and torn strips at the waist. They hang from the
    # pelvis, which dips with the stride, so they follow the body without extra keys.
    parts.append(prism("shirt", (0, 0.02, hip_z + 0.08), shoulder, 0.19, 0.215, rags))
    for i, (angle, drop, width) in enumerate(
        [(-2.44, 0.20, 0.10), (-1.57, 0.30, 0.09), (-0.70, 0.16, 0.11), (0.17, 0.26, 0.08), (1.05, 0.19, 0.10), (1.92, 0.31, 0.09)]
    ):
        x = math.cos(angle) * 0.17
        y = math.sin(angle) * 0.17 + 0.02
        parts.append(
            slab(f"hem{i}", (width, 0.025, drop), (x, y, hip_z + 0.10 - drop / 2), (0, 0, angle), rags)
        )

    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = f"pose{index}"
    # Name the mesh data too: the glTF mesh name is what three.js keeps on the
    # primitive, so without this every pose arrives called "pelvis".
    ob.data.name = ob.name
    for v in ob.data.vertices:
        v.co.z += LIFT
    return ob


def export(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
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
    tris = sum(len(p.vertices) - 2 for p in objs[0].data.polygons) * len(objs)
    slots = ", ".join(m.name for m in objs[0].data.materials)
    hi = max(v.co.z for v in objs[0].data.vertices)
    print(
        f"INFECTED {name} poses={len(objs)} tris={tris} bytes={os.path.getsize(path)} "
        f"height={hi:.3f} materials=[{slots}]"
    )
    # Prove the poses differ and that the legs alternate, per foot, along the walk axis.
    ref = [v.co.copy() for v in objs[0].data.vertices]
    for ob in objs:
        verts = [v.co for v in ob.data.vertices]
        feet = [v for v in verts if v.z < 0.20 and abs(v.x) > 0.02]
        left = [v for v in feet if v.x > 0]
        right = [v for v in feet if v.x < 0]
        delta = max((a - b).length for a, b in zip(ref, verts))
        ly = sum(v.y for v in left) / max(1, len(left))
        ry = sum(v.y for v in right) / max(1, len(right))
        print(
            f"POSE {ob.name} left_foot_y={ly:+.3f} right_foot_y={ry:+.3f} max_delta_vs_pose0={delta:.3f}"
        )


reset()

# `skin` is white on purpose: the renderer tints it with INFECTED[kind].color, so
# the base colour must not pre-darken it. `rags` stays nearly black and `eyes` is
# the only emissive surface, which is what makes a horde readable at night.
skin = mat("skin", (1.0, 1.0, 1.0), rough=0.8)
rags = mat("rags", (0.16, 0.15, 0.13), rough=0.95)
eyes = mat("eyes", (0.10, 0.12, 0.06), rough=0.4, emit=(0.62, 0.95, 0.36), emit_strength=6.0)

poses = [build_pose(i, skin, rags, eyes) for i in range(POSES)]
export(poses, "infected")
print("INFECTED DONE")
