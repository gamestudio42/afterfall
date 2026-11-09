"""
Generates the survivor model as a GLB: six poses of a walk cycle, exported as six
objects (`pose0`…`pose5`) in one file, each with the same three materials.

Blender is Z-up, the model faces -Y (the same convention as `walker.glb` and
`infected.glb`) and the feet sit on z = 0. The exporter converts to Y-up.

Why poses and not a skeleton: the renderer draws units with `InstancedMesh`, which
cannot carry a skeleton, and one `SkinnedMesh` per unit would cost a draw call per
survivor. Six baked poses cost `6 x materials` draw calls for the whole squad
instead, and the renderer picks the pose from the distance the unit has travelled,
so the stride matches the speed and the feet stop sliding.

Usage (headless):
  blender --background --factory-startup --python tools/blender/survivors.py -- <out_dir>
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/survivors"
os.makedirs(OUT, exist_ok=True)

POSES = 6
# Stride and proportions of an upright adult, 1.9 m tall with the feet on the ground.
HIP_Z = 0.95
SHOULDER_Z = 1.55
THIGH = 0.44
SHIN = 0.44
UPPER_ARM = 0.33
FOREARM = 0.31
LEG_SWING = 0.60  # radians at full stride, ~34 degrees
KNEE_BEND = 0.85
ARM_SWING = 0.55
# Measured: the swung foot of the contact pose reaches 0.069 m below the ground
# plane, so every pose is lifted by that much and the feet rest on z = 0.
LIFT = 0.069


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
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
        verts.append(basis @ Vector((sx * hx, sy * hy, sz * hz)) + Vector(loc))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return obj_from(name, verts, faces, material)


def prism(name, p0, p1, r0, r1, material, sides=6):
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    if axis.length < 1e-6:
        raise ValueError(f"{name}: zero-length prism")
    basis = axis.normalized().to_track_quat("Z", "Y")
    verts = []
    for radius, base in ((r0, p0), (r1, p1)):
        for k in range(sides):
            a = 2 * math.pi * k / sides
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
    b = Vector(base)
    return b + Vector((0.0, -math.sin(angle) * length, -math.cos(angle) * length))


# Six keys of a walk cycle: (left thigh, left knee, right thigh, right knee), in
# radians, thigh positive forward and knee positive folding the shin back. A sine
# wave cannot do this job: sin(60 deg) == sin(120 deg), which produced two distinct
# poses out of six on the first attempt. Poses 3-5 are the mirror of 0-2.
GAIT = (
    (0.50, 0.05, -0.45, 0.30),  # 0 contact: left heel down in front, right toe back
    (0.10, 0.10, -0.05, 0.75),  # 1 right leg passes under the body, knee folded
    (-0.35, 0.45, 0.35, 0.30),  # 2 left pushes off, right reaching forward
    (0.50, 0.05, -0.45, 0.30),  # 3 contact, mirrored (filled in below)
    (0.10, 0.10, -0.05, 0.75),  # 4 mirrored
    (-0.35, 0.45, 0.35, 0.30),  # 5 mirrored
)


def build_pose(index, skin, clothes, pack):
    """One pose of the cycle, built from the GAIT table."""
    poses = GAIT
    if index >= 3:
        # Mirror: swap the legs and the arms that carry them.
        lt, lk, rt, rk = poses[index]
        lt, lk, rt, rk = rt, rk, lt, lk
    else:
        lt, lk, rt, rk = poses[index]
    parts = []

    # The pelvis dips on the passing frames, which is what sells a walk at distance.
    dip = 0.03 if index % 3 == 1 else 0.0
    hip_z = HIP_Z - dip
    lean = 0.10
    shoulder = (0.0, -0.05 + lean * 0.4, SHOULDER_Z - dip)

    parts.append(slab("pelvis", (0.30, 0.20, 0.20), (0, 0, hip_z), material=clothes))
    parts.append(prism("torso", (0, 0, hip_z + 0.06), shoulder, 0.15, 0.19, clothes))
    parts.append(slab("chest", (0.36, 0.22, 0.24), (0, -0.04, 1.36 - dip), (lean, 0, 0), clothes))
    parts.append(slab("pack", (0.28, 0.16, 0.34), (0, 0.19, 1.28 - dip), (lean, 0, 0), pack))
    parts.append(prism("neck", shoulder, (0, -0.09, SHOULDER_Z + 0.08 - dip), 0.055, 0.055, skin))

    head_rot = (0.10, 0.0, 0.06)
    head_loc = (0.0, -0.10, 1.72 - dip)
    for ob in (
        slab("skull", (0.20, 0.23, 0.24), (0, 0, 0), material=skin),
        slab("jaw", (0.14, 0.15, 0.08), (0, -0.06, -0.10), material=skin),
    ):
        basis = Euler(head_rot, "XYZ").to_matrix()
        for v in ob.data.vertices:
            v.co = basis @ v.co + Vector(head_loc)
        parts.append(ob)

    for side in (1, -1):
        # Legs come from the table: the left is one side of the cycle, the right the other.
        thigh_angle, knee_bend = (lt, lk) if side > 0 else (rt, rk)
        hip = (0.11 * side, 0.0, hip_z)
        knee = swing(hip, THIGH, thigh_angle)
        # The knee folds back: the shin angle is the thigh angle minus the bend.
        ankle = swing(knee, SHIN, thigh_angle - knee_bend)
        parts.append(prism(f"thigh{side}", hip, knee, 0.085, 0.07, clothes))
        parts.append(prism(f"shin{side}", knee, ankle, 0.065, 0.05, skin))
        foot_rot = (thigh_angle - knee_bend, 0.0, 0.0)
        parts.append(slab(f"foot{side}", (0.10, 0.24, 0.075), (ankle.x, ankle.y - 0.05, 0.04), foot_rot, skin))

        # Arms counter-swing against the same-side leg.
        shoulder_pt = (0.20 * side, -0.04, SHOULDER_Z - dip)
        arm_angle = -0.62 * thigh_angle
        elbow = swing(shoulder_pt, UPPER_ARM, arm_angle)
        wrist = swing(elbow, FOREARM, arm_angle + 0.35)
        parts.append(prism(f"arm{side}", shoulder_pt, elbow, 0.07, 0.06, clothes))
        parts.append(prism(f"fore{side}", elbow, wrist, 0.06, 0.045, skin))
        parts.append(slab(f"hand{side}", (0.08, 0.10, 0.07), (wrist.x, wrist.y, wrist.z - 0.03), (arm_angle, 0, 0), skin))

    # Join only this pose's parts: the previous poses are still in the scene and a
    # select-all would merge every pose into one object.
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
    # A swung foot dips below the ground plane; lift the whole pose so the lowest
    # vertex of the contact pose rests on z = 0 and the others hover by millimetres.
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
    print(f"SURVIVOR {name} poses={len(objs)} tris={tris} bytes={os.path.getsize(path)}")
    # Prove the poses differ and that the legs alternate: per pose, where each foot
    # sits along the walking axis and how high it is lifted off the ground.
    ref = [v.co.copy() for v in objs[0].data.vertices]
    for ob in objs:
        verts = [v.co for v in ob.data.vertices]
        feet = [v for v in verts if v.z < 0.20 and abs(v.x) > 0.02]
        left = [v for v in feet if v.x > 0]
        right = [v for v in feet if v.x < 0]
        delta = max((a - b).length for a, b in zip(ref, verts))
        ly = sum(v.y for v in left) / max(1, len(left))
        ry = sum(v.y for v in right) / max(1, len(right))
        lz = min((v.z for v in left), default=0.0)
        rz = min((v.z for v in right), default=0.0)
        print(
            f"POSE {ob.name} left_foot_y={ly:+.3f} z={lz:.3f} right_foot_y={ry:+.3f} z={rz:.3f} "
            f"max_delta_vs_pose0={delta:.3f}"
        )


reset()
skin = mat("pele", (0.86, 0.67, 0.52), rough=0.75)
clothes = mat("roupa", (1.0, 1.0, 1.0), rough=0.9)
pack = mat("mochila", (0.35, 0.27, 0.18), rough=0.95)

poses = [build_pose(i, skin, clothes, pack) for i in range(POSES)]
export(poses, "walker")
print("SURVIVOR DONE")
