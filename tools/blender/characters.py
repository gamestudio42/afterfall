"""Original characters: one continuous skinned body, posed by a skeleton and baked to morphs.

Run through survivors.py / infected.py. Blender is Z-up and the character faces -Y.

The body is authored once, in a neutral upright stance, as lofted rings that
are bound to the bones of a small skeleton (two bones per ring at the joints,
so a knee or an elbow bends as skin instead of two tubes passing through each
other). Every pose is then that same mesh skinned by the skeleton: legs by
two-bone inverse kinematics from a foot path on the ground, so a planted foot
stays planted, and the spine, arms and head by forward kinematics from a
handful of angles. The vertex order never changes, so each pose exports as a
glTF morph target and three.js blends them per instance on the GPU, with no
skeleton at run time and no draw call per frame of animation.
"""
import hashlib
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

WALK_KEYS = 8
# Twelve, not eight: in a run the shin swings through a right angle in an eighth of a
# cycle, and a straight blend between two such keys flattened the knee.
RUN_KEYS = 12
POSE_NAMES = (
    [f"walk{i}" for i in range(WALK_KEYS)]
    + [f"run{i}" for i in range(RUN_KEYS)]
    + ["breath", "shift", "windup", "strike", "aim", "hit"]
)

# Metres of ground covered by one full cycle (two steps). The renderer advances
# the phase by distance over these, so they must match `characters.ts`.
CYCLE = {
    ("survivor", "walk"): 1.2,
    ("survivor", "run"): 2.5,
    ("infected", "walk"): 1.0,
    ("infected", "run"): 2.2,
}

rad = math.radians

# ------------------------------------------------------------------ skeleton

HIP_W = 0.095
SHOULDER_W = 0.195
REST = {
    "pelvis": Vector((0, 0, 0.95)),
    "spine": Vector((0, 0, 1.07)),
    "chest": Vector((0, 0, 1.25)),
    "neck": Vector((0, 0, 1.49)),
    "head": Vector((0, 0, 1.56)),
}
for _s, _n in ((-1, "L"), (1, "R")):
    REST[f"upper{_n}"] = Vector((_s * SHOULDER_W, 0, 1.43))
    REST[f"fore{_n}"] = Vector((_s * SHOULDER_W, 0, 1.155))
    REST[f"hand{_n}"] = Vector((_s * SHOULDER_W, 0, 0.895))
    REST[f"thigh{_n}"] = Vector((_s * HIP_W, 0, 0.93))
    REST[f"shin{_n}"] = Vector((_s * HIP_W, 0, 0.50))
    REST[f"foot{_n}"] = Vector((_s * HIP_W, 0, 0.085))
THIGH = 0.43
SHIN = 0.415
ANKLE_Z = 0.085


def rx(a):
    return Matrix.Rotation(a, 3, "X")


def ry(a):
    return Matrix.Rotation(a, 3, "Y")


def rz(a):
    return Matrix.Rotation(a, 3, "Z")


def euler(pitch=0.0, yaw=0.0, roll=0.0):
    """Pitch leans an upright bone forward (toward -Y), yaw turns it, roll tips it sideways."""
    return rz(yaw) @ ry(roll) @ rx(pitch)


def solve(pose):
    """Bone transforms for a pose: name -> (posed origin, rotation)."""
    out = {}

    def place(name, origin, rot):
        out[name] = (origin, rot)

    def carry(parent, child):
        o, r = out[parent]
        return o + r @ (REST[child] - REST[parent])

    p = pose.get("pelvis", {})
    r_pelvis = euler(p.get("pitch", 0), p.get("yaw", 0), p.get("roll", 0))
    place("pelvis", REST["pelvis"] + Vector((p.get("x", 0), p.get("y", 0), p.get("z", 0))), r_pelvis)
    s = pose.get("spine", {})
    r_spine = r_pelvis @ euler(s.get("pitch", 0), s.get("yaw", 0), s.get("roll", 0))
    place("spine", carry("pelvis", "spine"), r_spine)
    c = pose.get("chest", {})
    r_chest = r_spine @ euler(c.get("pitch", 0), c.get("yaw", 0), c.get("roll", 0))
    place("chest", carry("spine", "chest"), r_chest)
    h = pose.get("head", {})
    half = euler(h.get("pitch", 0) / 2, h.get("yaw", 0) / 2, h.get("roll", 0) / 2)
    place("neck", carry("chest", "neck"), r_chest @ half)
    place("head", carry("neck", "head"), r_chest @ half @ half)

    for side, n in ((-1, "L"), (1, "R")):
        a = pose.get(f"arm{n}", {})
        # Flex swings the hanging arm forward, abduct lifts it away from the body.
        r_upper = r_chest @ rz(side * a.get("twist", 0)) @ ry(-side * a.get("abduct", 0)) @ rx(-a.get("flex", 0))
        place(f"upper{n}", carry("chest", f"upper{n}"), r_upper)
        r_fore = r_upper @ rz(-side * a.get("turn", 0)) @ rx(-a.get("elbow", 0))
        place(f"fore{n}", carry(f"upper{n}", f"fore{n}"), r_fore)
        place(f"hand{n}", carry(f"fore{n}", f"hand{n}"), r_fore @ rx(-a.get("wrist", 0)))

        leg = pose.get(f"leg{n}", {})
        hip = carry("pelvis", f"thigh{n}")
        yaw = p.get("yaw", 0) * 0.5 + side * leg.get("toe_out", rad(6))
        ankle = Vector((side * HIP_W + leg.get("x", 0), leg.get("y", 0), ANKLE_Z + leg.get("z", 0)))
        delta = ankle - hip
        reach = THIGH + SHIN - 0.004
        if delta.length > reach:  # never stretch a leg: lift the foot instead
            ankle = hip + delta.normalized() * reach
            delta = ankle - hip
        dist = max(delta.length, 1e-6)
        direction = delta / dist
        along = (THIGH**2 - SHIN**2 + dist**2) / (2 * dist)
        bend = math.sqrt(max(0.0, THIGH**2 - along**2))
        forward = rz(yaw) @ Vector((0, -1, 0))
        forward = (forward - direction * direction.dot(forward)).normalized()
        knee = hip + direction * along + forward * bend
        lateral = rz(yaw) @ Vector((1, 0, 0))

        def frame(a_pt, b_pt):
            up = (a_pt - b_pt).normalized()
            x_axis = (lateral - up * up.dot(lateral)).normalized()
            y_axis = up.cross(x_axis)
            return Matrix((x_axis, y_axis, up)).transposed()

        place(f"thigh{n}", hip, frame(hip, knee))
        place(f"shin{n}", knee, frame(knee, ankle))
        place(f"foot{n}", ankle, rz(yaw) @ rx(leg.get("pitch", 0)))
    return out


# ---------------------------------------------------------------------- mesh


class Body:
    """Vertices in the rest stance, each bound to one or two bones."""

    def __init__(self):
        self.verts = []
        self.binds = []
        self.faces = []
        self.materials = []
        self.colors = []

    def add(self, points, binds, polygons, material, color):
        start = len(self.verts)
        self.verts.extend(Vector(p) for p in points)
        self.binds.extend(binds)
        for poly in polygons:
            self.faces.append(tuple(start + i for i in poly))
            self.materials.append(material)
            self.colors.append(color)

    def loft(self, rings, material, color=(1, 1, 1), sides=10, axis="z", caps=(True, True), square=1.0, segments=None, fat=(1.0, 1.0)):
        """Rings are (centre, radius a, radius b, bind). `square` > 1 flattens the sides toward a box;
        `fat` scales both radii, which is how the build of the body is tuned in one place."""
        points, binds = [], []
        for centre, ra, rb, bind in rings:
            ra, rb = ra * fat[0], rb * fat[1]
            for i in range(sides):
                t = (i + 0.5) * math.tau / sides
                ca, sa = math.cos(t), math.sin(t)
                if square != 1.0:
                    ca = math.copysign(abs(ca) ** (1 / square), ca)
                    sa = math.copysign(abs(sa) ** (1 / square), sa)
                if axis == "z":
                    off = Vector((ca * ra, sa * rb, 0))
                elif axis == "y":
                    off = Vector((ca * ra, 0, sa * rb))
                else:
                    off = Vector((0, ca * ra, sa * rb))
                points.append(Vector(centre) + off)
                binds.append(bind)
        polys, mats, cols = [], [], []
        n = len(rings)
        for j in range(n - 1):
            m, c = segments[j] if segments else (material, color)
            for i in range(sides):
                k = (i + 1) % sides
                polys.append((j * sides + i, j * sides + k, (j + 1) * sides + k, (j + 1) * sides + i))
                mats.append(m)
                cols.append(c)
        if caps[0]:
            polys.append(tuple(range(sides - 1, -1, -1)))
            m, c = segments[0] if segments else (material, color)
            mats.append(m)
            cols.append(c)
        if caps[1]:
            polys.append(tuple((n - 1) * sides + i for i in range(sides)))
            m, c = segments[-1] if segments else (material, color)
            mats.append(m)
            cols.append(c)
        start = len(self.verts)
        self.verts.extend(points)
        self.binds.extend(binds)
        for poly, m, c in zip(polys, mats, cols):
            self.faces.append(tuple(start + i for i in poly))
            self.materials.append(m)
            self.colors.append(c)

    def box(self, centre, size, bind, material, color=(1, 1, 1)):
        c = Vector(centre)
        pts = [
            c + Vector((x * size[0] / 2, y * size[1] / 2, z * size[2] / 2))
            for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
        ]
        self.add(pts, [bind] * 8, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material, color)

    def strip(self, a, b, width, depth, bind_a, bind_b, material, color=(1, 1, 1)):
        """A flat strap from a to b, facing forward; each end has its own bind."""
        a, b = Vector(a), Vector(b)
        w = Vector((width / 2, 0, 0))
        d = Vector((0, depth / 2, 0))
        pts = [a - w - d, a + w - d, a + w + d, a - w + d, b - w - d, b + w - d, b + w + d, b - w + d]
        self.add(pts, [bind_a] * 4 + [bind_b] * 4, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material, color)

    def posed(self, bones):
        out = []
        for v, bind in zip(self.verts, self.binds):
            p = Vector((0, 0, 0))
            for name, w in bind:
                o, r = bones[name]
                p += w * (o + r @ (v - REST[name]))
            out.append(p)
        return out


def one(name):
    return ((name, 1.0),)


def two(a, b, w=0.5):
    return ((a, w), (b, 1.0 - w))


# The build: a figure seen from an RTS camera is a few dozen pixels tall, so it
# is a little stockier than life, with a larger head and hands. Thin limbs read
# as a mannequin, and at that size they flicker.
LIMB = (1.24, 1.24)
TORSO = (1.1, 1.24)
HEAD = 1.13
HAND = 1.25


def build_body(infected):
    b = Body()
    V = Vector
    # Vertex colours multiply the per-person tint of "cloth", "pants", "hair" and "skin";
    # "detail" keeps its own colour.
    white = (1, 1, 1)
    shade = (0.78, 0.78, 0.78)
    dark = (0.55, 0.55, 0.55)
    boot = (0.06, 0.055, 0.05)
    leather = (0.2, 0.13, 0.075)
    # Dried, not fresh: bright red patches read as price tags from the camera's height.
    blood = (0.055, 0.016, 0.013)
    grime = (0.62, 0.66, 0.56) if infected else white

    # --- torso: the jacket (or the infected's shirt) from hem to shoulders
    torso = [
        (V((0, 0.004, 0.845)), 0.178, 0.128, one("pelvis")),
        (V((0, 0.004, 0.93)), 0.168, 0.118, one("pelvis")),
        (V((0, 0.002, 1.02)), 0.152, 0.106, two("pelvis", "spine")),
        (V((0, 0, 1.11)), 0.160, 0.110, one("spine")),
        (V((0, -0.004, 1.21)), 0.184, 0.122, two("spine", "chest")),
        (V((0, -0.008, 1.32)), 0.204, 0.128, one("chest")),
        (V((0, -0.004, 1.41)), 0.196, 0.116, one("chest")),
        (V((0, 0, 1.462)), 0.118, 0.088, one("chest")),
        (V((0, 0, 1.49)), 0.070, 0.068, one("chest")),
    ]
    if infected:
        torso[0] = (V((0, 0.004, 0.875)), 0.172, 0.122, one("pelvis"))
    b.loft(torso, "cloth", grime, sides=12, caps=(True, True), fat=TORSO)

    # --- neck and head
    b.loft(
        [
            (V((0, 0, 1.47)), 0.056, 0.058, one("chest")),
            (V((0, -0.004, 1.53)), 0.050, 0.054, one("neck")),
            (V((0, -0.008, 1.585)), 0.048, 0.054, one("head")),
        ],
        "skin",
        shade,
        sides=8,
        caps=(False, False),
    )
    b.loft(
        [
            (V((0, -0.030, 1.562)), 0.040, 0.050, one("head")),
            (V((0, -0.024, 1.592)), 0.068, 0.080, one("head")),
            (V((0, -0.016, 1.636)), 0.084, 0.096, one("head")),
            (V((0, -0.010, 1.690)), 0.091, 0.104, one("head")),
            (V((0, -0.006, 1.742)), 0.089, 0.102, one("head")),
            (V((0, -0.002, 1.785)), 0.071, 0.084, one("head")),
            (V((0, 0, 1.812)), 0.034, 0.042, one("head")),
        ],
        "skin",
        white,
        sides=12,
    )
    head = one("head")
    # Brow ridge, nose, mouth and ears: enough planes for a face to read at a distance.
    b.box((0, -0.108, 1.722), (0.118, 0.02, 0.018), head, "skin", dark)
    b.loft(
        [(V((0, -0.106, 1.705)), 0.014, 0.012, head), (V((0, -0.128, 1.672)), 0.019, 0.015, head), (V((0, -0.112, 1.656)), 0.015, 0.008, head)],
        "skin",
        shade,
        sides=6,
    )
    for side in (-1, 1):
        b.box((side * 0.092, -0.004, 1.685), (0.018, 0.034, 0.05), head, "skin", shade)
        b.box((side * 0.036, -0.103, 1.702), (0.03, 0.012, 0.014), head, "eyes" if infected else "detail", (0.75, 0.86, 0.38) if infected else (0.05, 0.04, 0.035))
    if infected:
        # A slack jaw, hanging open and dark inside.
        b.box((0, -0.094, 1.612), (0.058, 0.03, 0.04), head, "detail", (0.07, 0.02, 0.02))
        b.box((0.03, -0.1, 1.64), (0.05, 0.012, 0.03), head, "detail", blood)
        b.box((-0.07, -0.05, 1.66), (0.03, 0.05, 0.05), head, "detail", blood)
    else:
        b.box((0, -0.103, 1.628), (0.044, 0.01, 0.01), head, "detail", (0.3, 0.13, 0.11))

    # --- hair: a cap over the skull, longer at the back, with a fringe
    if infected:
        b.loft(
            [
                (V((0.012, 0.012, 1.735)), 0.086, 0.094, head),
                (V((0.01, 0.01, 1.79)), 0.066, 0.078, head),
                (V((0.006, 0.008, 1.822)), 0.03, 0.04, head),
            ],
            "hair",
            shade,
            sides=10,
            caps=(False, True),
        )
    else:
        b.loft(
            [
                (V((0, 0.012, 1.70)), 0.096, 0.108, head),
                (V((0, 0.008, 1.752)), 0.094, 0.106, head),
                (V((0, 0.004, 1.797)), 0.076, 0.090, head),
                (V((0, 0.002, 1.828)), 0.036, 0.046, head),
            ],
            "hair",
            white,
            sides=12,
            caps=(False, True),
        )
        b.box((0, 0.084, 1.655), (0.16, 0.05, 0.12), head, "hair", shade)
        b.box((0, -0.088, 1.772), (0.15, 0.04, 0.04), head, "hair", shade)

    # --- arms: one skin from shoulder to cuff, bending at the elbow
    for side, n in ((-1, "L"), (1, "R")):
        x = side * SHOULDER_W
        up, fo, ha = f"upper{n}", f"fore{n}", f"hand{n}"
        bare = infected and side == -1  # one sleeve torn off at the elbow
        sleeve = ("cloth", grime)
        skin = ("skin", shade)
        arm = [
            (V((x - side * 0.012, 0, 1.468)), 0.058, 0.064, two("chest", up, 0.6)),
            (V((x, 0, 1.41)), 0.062, 0.066, one(up)),
            (V((x, 0, 1.31)), 0.053, 0.057, one(up)),
            (V((x, 0, 1.21)), 0.047, 0.051, one(up)),
            # The bend is spread over three rings: with two, 3 cm apart, the inside
            # of a bent joint was crushed flat.
            (V((x, 0, 1.19)), 0.046, 0.049, two(up, fo, 0.8)),
            (V((x, 0, 1.155)), 0.045, 0.048, two(up, fo, 0.5)),
            (V((x, 0, 1.12)), 0.045, 0.047, two(up, fo, 0.2)),
            (V((x, -0.004, 1.08)), 0.046, 0.048, one(fo)),
            (V((x, -0.002, 0.99)), 0.039, 0.041, one(fo)),
            (V((x, 0, 0.925)), 0.036 if not bare else 0.03, 0.036 if not bare else 0.03, one(fo)),
        ]
        segs = [sleeve] * 4 + ([skin] * 5 if bare else [sleeve] * 5)
        b.loft(arm, "cloth", grime, sides=8, segments=segs, fat=LIMB)
        b.loft(
            [
                (V((x, 0, 0.928)), 0.027, 0.029, two(fo, ha, 0.3)),
                (V((x, -0.004, 0.888)), 0.022, 0.036, one(ha)),
                (V((x, -0.008, 0.838)), 0.020, 0.038, one(ha)),
                (V((x, -0.014, 0.796)), 0.016, 0.028, one(ha)),
            ],
            "skin",
            white,
            sides=8,
            fat=(HAND, HAND),
        )
        b.box((x - side * 0.006, -0.05, 0.87), (0.024, 0.026, 0.055), one(ha), "skin", shade)
        if infected and side == -1:
            b.loft([(V((x, 0, 1.07)), 0.048, 0.05, one(fo)), (V((x, 0, 1.03)), 0.046, 0.048, one(fo))], "detail", blood, sides=8, caps=(False, False))

    # --- legs: trousers from hip to boot, bending at the knee
    for side, n in ((-1, "L"), (1, "R")):
        x = side * HIP_W
        th, sh, ft = f"thigh{n}", f"shin{n}", f"foot{n}"
        barefoot = infected and side == 1
        pants = ("pants", white)
        shoe = ("skin", shade) if barefoot else ("detail", boot)
        leg = [
            (V((x, 0.004, 0.945)), 0.090, 0.104, one("pelvis")),
            (V((x, 0.004, 0.895)), 0.088, 0.100, two("pelvis", th)),
            (V((x, 0.002, 0.80)), 0.080, 0.092, one(th)),
            (V((x, 0, 0.66)), 0.069, 0.079, one(th)),
            (V((x, -0.003, 0.585)), 0.061, 0.07, one(th)),
            (V((x, -0.005, 0.545)), 0.058, 0.066, two(th, sh, 0.8)),
            (V((x, -0.006, 0.50)), 0.057, 0.064, two(th, sh, 0.5)),
            (V((x, -0.002, 0.455)), 0.056, 0.063, two(th, sh, 0.2)),
            (V((x, 0.008, 0.41)), 0.057, 0.064, one(sh)),
            (V((x, 0.008, 0.33)), 0.052, 0.058, one(sh)),
            (V((x, 0.002, 0.225)), 0.043, 0.047, one(sh)),
            (V((x, 0, 0.215)), 0.049 if not barefoot else 0.04, 0.053 if not barefoot else 0.044, one(sh)),
            (V((x, 0, 0.115)), 0.046 if not barefoot else 0.036, 0.052 if not barefoot else 0.042, two(sh, ft, 0.6)),
        ]
        b.loft(leg, "pants", white, sides=10, segments=[pants] * 10 + [shoe] * 2, fat=LIMB)
        b.loft(
            [
                (V((x, 0.062, 0.05)), 0.040, 0.048, one(ft)),
                (V((x, 0.0, 0.058)), 0.047, 0.056, one(ft)),
                (V((x, -0.09, 0.044)), 0.051, 0.042, one(ft)),
                (V((x, -0.152, 0.034)), 0.048, 0.032, one(ft)),
                (V((x, -0.19, 0.027)), 0.034, 0.023, one(ft)),
            ],
            shoe[0],
            shoe[1],
            sides=8,
            axis="y",
            fat=(1.22, 1.12),
        )

    gear_from = len(b.verts)
    if infected:
        # Wounds and what the infection did to the clothes.
        # Stains, low and uneven: a wide one high on the chest, a narrow one running down from it.
        b.box((0.05, -0.127, 1.3), (0.13, 0.008, 0.07), one("chest"), "detail", blood)
        b.box((0.075, -0.124, 1.2), (0.05, 0.008, 0.15), two("spine", "chest"), "detail", blood)
        b.box((-0.08, -0.118, 1.07), (0.07, 0.008, 0.05), one("spine"), "detail", blood)
        b.box((0.0, 0.126, 1.33), (0.16, 0.012, 0.12), one("chest"), "detail", (0.09, 0.025, 0.02))
        for i, xx in enumerate((-0.12, -0.04, 0.05, 0.13)):
            b.strip((xx, -0.118, 0.875), (xx + 0.012, -0.124, 0.80 - 0.02 * (i % 2)), 0.05, 0.012, one("pelvis"), one("pelvis"), "cloth", grime)
    else:
        chest, spine = one("chest"), one("spine")
        # An open jacket: the shirt shows down the front, with a collar around the neck.
        b.strip((0, -0.128, 1.44), (0, -0.115, 1.2), 0.07, 0.014, chest, two("spine", "chest"), "detail", (0.42, 0.4, 0.36))
        b.strip((0, -0.115, 1.2), (0, -0.117, 0.93), 0.06, 0.014, two("spine", "chest"), one("pelvis"), "detail", (0.42, 0.4, 0.36))
        b.loft(
            [(V((0, 0.002, 1.445)), 0.094, 0.088, chest), (V((0, 0.004, 1.512)), 0.078, 0.08, two("chest", "neck"))],
            "cloth",
            dark,
            sides=10,
            caps=(False, False),
        )
        # Belt and a pouch on the hip.
        b.loft(
            [(V((0, 0.004, 0.94)), 0.176, 0.126, one("pelvis")), (V((0, 0.004, 0.975)), 0.172, 0.122, one("pelvis"))],
            "detail",
            leather,
            sides=12,
            caps=(False, False),
        )
        b.box((-0.168, 0.0, 0.915), (0.05, 0.1, 0.11), one("pelvis"), "detail", (0.25, 0.2, 0.12))
        # Backpack with a bedroll strapped on top, and its two shoulder straps.
        b.loft(
            [
                (V((0, 0.178, 1.0)), 0.118, 0.062, spine),
                (V((0, 0.19, 1.07)), 0.142, 0.082, two("spine", "chest")),
                (V((0, 0.196, 1.3)), 0.142, 0.086, chest),
                (V((0, 0.182, 1.4)), 0.118, 0.064, chest),
            ],
            "detail",
            (0.27, 0.23, 0.14),
            sides=8,
            square=2.2,
        )
        b.box((0, 0.288, 1.13), (0.19, 0.04, 0.14), two("spine", "chest"), "detail", (0.34, 0.29, 0.18))
        b.loft(
            [(V((-0.175, 0.185, 1.468)), 0.06, 0.06, chest), (V((0.175, 0.185, 1.468)), 0.06, 0.06, chest)],
            "detail",
            (0.36, 0.38, 0.33),
            sides=8,
            axis="x",
        )
        for xx in (-0.1, 0.1):
            b.box((xx, 0.185, 1.468), (0.022, 0.135, 0.135), chest, "detail", leather)
        for side in (-1, 1):
            b.strip((side * 0.115, -0.108, 1.45), (side * 0.128, -0.128, 1.3), 0.036, 0.016, chest, chest, "detail", leather)
            b.strip((side * 0.128, -0.128, 1.3), (side * 0.15, -0.105, 1.1), 0.036, 0.016, chest, spine, "detail", leather)
            b.strip((side * 0.115, -0.108, 1.45), (side * 0.11, 0.12, 1.455), 0.036, 0.016, chest, chest, "detail", leather)

        # Weapons ride the right hand along its fingers; the renderer draws only the equipped one.
        hand = one("handR")
        x = SHOULDER_W
        steel = (0.26, 0.28, 0.3)
        bar_from = len(b.verts)
        b.loft([(V((x, -0.034, 0.97)), 0.011, 0.011, hand), (V((x, -0.034, 0.44)), 0.011, 0.011, hand)], "crowbar", steel, sides=6)
        b.loft([(V((x, -0.034, 0.44)), 0.011, 0.011, hand), (V((x, -0.09, 0.40)), 0.009, 0.012, hand)], "crowbar", steel, sides=6)
        b.loft([(V((x, -0.034, 0.97)), 0.011, 0.011, hand), (V((x, -0.07, 1.0)), 0.008, 0.012, hand)], "crowbar", steel, sides=6)
        # Held in the fist at an angle, not along the forearm: straight, a running
        # survivor carried it out in front like a lance.
        grip = V((x, -0.034, 0.855))
        tilt = rx(rad(-38))
        for i in range(bar_from, len(b.verts)):
            b.verts[i] = grip + tilt @ (b.verts[i] - grip)
        b.box((x, -0.04, 0.845), (0.03, 0.05, 0.1), hand, "pistol", (0.07, 0.07, 0.075))
        b.box((x, -0.062, 0.775), (0.03, 0.04, 0.17), hand, "pistol", (0.13, 0.135, 0.14))
        b.box((x, -0.058, 0.93), (0.045, 0.075, 0.26), hand, "rifle", leather)
        b.box((x, -0.062, 0.72), (0.042, 0.065, 0.22), hand, "rifle", (0.1, 0.11, 0.105))
        b.loft([(V((x, -0.066, 0.61)), 0.013, 0.013, hand), (V((x, -0.066, 0.3)), 0.012, 0.012, hand)], "rifle", (0.08, 0.085, 0.09), sides=6)
    # The head and everything on it grows about the head joint; gear that sits on
    # the torso is pushed out to the fatter torso's surface.
    for i, (v, bind) in enumerate(zip(b.verts, b.binds)):
        if len(bind) == 1 and bind[0][0] == "head":
            b.verts[i] = REST["head"] + (v - REST["head"]) * HEAD
    for i in range(gear_from, len(b.verts)):
        v, bind = b.verts[i], b.binds[i]
        if all(name in ("pelvis", "spine", "chest") for name, _ in bind):
            b.verts[i] = Vector((v.x * 1.07, v.y * 1.2 if abs(v.y) > 0.09 else v.y, v.z))
    return b


# --------------------------------------------------------------------- poses


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def foot_path(q, gait):
    """A foot's place for its phase q in [0, 1): planted through the stance, carried through the swing."""
    duty, ahead, behind, lift = gait["duty"], gait["ahead"], gait["behind"], gait["lift"]
    toe_off, strike = gait["toe_off"], gait["strike"]
    heel = 0.12  # ankle to ball of the foot
    if q < duty:
        u = q / duty
        y = -ahead + (ahead + behind) * u
        pitch = -strike * max(0.0, 1 - u / 0.14)
        if u > 0.55:
            pitch = toe_off * ((u - 0.55) / 0.45) ** 1.6
        return {"y": y - heel * (1 - math.cos(max(pitch, 0))), "z": heel * math.sin(max(pitch, 0)), "pitch": pitch}
    v = (q - duty) / (1 - duty)
    y = behind - (ahead + behind) * smooth(v)
    carry = heel * math.sin(toe_off) * (1 - v) ** 2
    z = carry + lift * math.sin(math.pi * v**0.75) ** 1.2
    pitch = toe_off * (1 - v) ** 2 * (1 - smooth(v * 1.6)) + gait["tuck"] * math.sin(math.pi * min(1.0, v * 1.4)) - strike * v**3
    return {"y": y - heel * (1 - math.cos(toe_off)) * (1 - v) ** 2, "z": z, "pitch": pitch}


def stand(infected):
    """The relaxed stance every pose is a change from; it is also the morph basis."""
    if infected:
        return {
            "pelvis": {"z": -0.075, "pitch": rad(8), "roll": rad(-3)},
            "spine": {"pitch": rad(16), "roll": rad(4)},
            "chest": {"pitch": rad(14), "roll": rad(3)},
            "head": {"pitch": rad(-12), "roll": rad(-14), "yaw": rad(6)},
            "armL": {"flex": rad(22), "abduct": rad(7), "elbow": rad(28), "wrist": rad(25)},
            "armR": {"flex": rad(6), "abduct": rad(5), "elbow": rad(12), "wrist": rad(15)},
            "legL": {"y": -0.05, "toe_out": rad(-4)},
            "legR": {"y": 0.07, "x": 0.02, "toe_out": rad(16)},
        }
    return {
        "pelvis": {"z": -0.012},
        "spine": {"pitch": rad(2)},
        "chest": {"pitch": rad(1)},
        "head": {"pitch": rad(-2)},
        "armL": {"flex": rad(4), "abduct": rad(5), "elbow": rad(12)},
        "armR": {"flex": rad(8), "abduct": rad(6), "elbow": rad(22), "wrist": rad(-8)},
        "legL": {"y": -0.03, "x": -0.012},
        "legR": {"y": 0.04, "x": 0.012, "toe_out": rad(12)},
    }


GAITS = {
    ("survivor", "walk"): {"duty": 0.62, "ahead": 0.30, "behind": 0.444, "lift": 0.07, "toe_off": rad(38), "strike": rad(14), "tuck": rad(4)},
    ("survivor", "run"): {"duty": 0.30, "ahead": 0.25, "behind": 0.50, "lift": 0.22, "toe_off": rad(48), "strike": rad(4), "tuck": rad(30)},
    ("infected", "walk"): {"duty": 0.68, "ahead": 0.27, "behind": 0.41, "lift": 0.045, "toe_off": rad(24), "strike": rad(2), "tuck": 0.0},
    ("infected", "run"): {"duty": 0.34, "ahead": 0.26, "behind": 0.488, "lift": 0.17, "toe_off": rad(42), "strike": rad(0), "tuck": rad(20)},
}
for (_who, _kind), _g in GAITS.items():
    # The stance has to cover exactly the ground the renderer moves the body over, or feet slide.
    assert abs(_g["ahead"] + _g["behind"] - _g["duty"] * CYCLE[(_who, _kind)]) < 1e-3, (_who, _kind)


def locomotion(infected, kind, p):
    who = "infected" if infected else "survivor"
    gait = GAITS[(who, kind)]
    run = kind == "run"
    c1, s1 = math.cos(math.tau * p), math.sin(math.tau * p)
    left = foot_path(p % 1, gait)
    right = foot_path((p + 0.5) % 1, gait)
    if infected and not run:
        # The right leg drags: it barely leaves the ground and turns out.
        right["z"] *= 0.35
        right["pitch"] *= 0.4
    pose = {"legL": dict(left), "legR": dict(right)}
    pose["legR"]["toe_out"] = rad(18 if infected else 7)
    pose["legL"]["toe_out"] = rad(-2 if infected else 7)
    if run:
        # Lowest in the middle of each stance, highest in flight.
        bob = -0.038 * math.cos(2 * math.tau * (p - gait["duty"] / 2))
        base = -0.085 if infected else -0.06
    else:
        # Lowest with both feet down, highest over the planted leg.
        bob = -0.017 * math.cos(2 * math.tau * p)
        base = -0.095 if infected else -0.047
    sway = (0.05 if infected else 0.022) * (1.0 if not run else 0.5)
    mid = gait["duty"] / 2
    pose["pelvis"] = {
        "z": base + bob,
        "x": -sway * math.sin(math.tau * (p - mid + 0.25)),
        "yaw": rad(9 if run else 6) * c1,
        "roll": rad(3.5 if not infected else 6) * math.sin(math.tau * (p - mid + 0.25)),
        "pitch": rad(10 if run else 3) + (rad(8 if not run else 3) if infected else 0),
    }
    twist = pose["pelvis"]["yaw"]
    if infected:
        lurch = math.sin(math.tau * p + 0.6)
        # A runner leans into it, but not so far that its hands drag on the ground.
        pose["spine"] = {"pitch": rad(15 if not run else 13), "yaw": -twist * 0.7, "roll": rad(5) * lurch}
        pose["chest"] = {"pitch": rad(13 if not run else 9), "yaw": -twist * 0.9, "roll": rad(4) * lurch}
        pose["head"] = {"pitch": rad(-14), "roll": rad(-12) + rad(7) * math.sin(math.tau * p - 0.8), "yaw": rad(5) * c1}
        if run:
            # Both arms out in front, clawing, a beat apart.
            pose["armL"] = {"flex": rad(84) + rad(16) * s1, "abduct": rad(8), "elbow": rad(30) - rad(14) * s1, "wrist": rad(30)}
            pose["armR"] = {"flex": rad(76) - rad(16) * s1, "abduct": rad(10), "elbow": rad(38) + rad(14) * s1, "wrist": rad(30)}
        else:
            pose["armL"] = {"flex": rad(34) + rad(9) * s1, "abduct": rad(7), "elbow": rad(34) + rad(8) * c1, "wrist": rad(28)}
            pose["armR"] = {"flex": rad(4) + rad(13) * c1, "abduct": rad(5), "elbow": rad(14), "wrist": rad(16)}
    else:
        pose["spine"] = {"pitch": rad(5 if run else 1.5), "yaw": -twist * 0.9}
        pose["chest"] = {"pitch": rad(4 if run else 1), "yaw": -twist * 1.1}
        pose["head"] = {"pitch": rad(-9 if run else -3), "yaw": twist * 1.0}
        swing = rad(38 if run else 24)
        # An arm swings against its own leg: the left leg is forward at p = 0, so the left arm is back.
        for n, a in (("L", -c1), ("R", c1)):
            forward = max(0.0, a)
            pose[f"arm{n}"] = {
                "flex": swing * a + rad(6 if run else 2),
                "abduct": rad(7),
                "elbow": (rad(74) + rad(16) * forward) if run else (rad(14) + rad(16) * forward),
                "wrist": rad(-6) if n == "R" else 0.0,
            }
    return pose


def merge(base, change):
    out = {k: dict(v) for k, v in base.items()}
    for k, v in change.items():
        out.setdefault(k, {}).update(v)
    return out


def pose_for(infected, name):
    base = stand(infected)
    if name == "stand":
        return base
    if name.startswith("walk"):
        return locomotion(infected, "walk", int(name[4:]) / WALK_KEYS)
    if name.startswith("run"):
        return locomotion(infected, "run", int(name[3:]) / RUN_KEYS)
    if name == "breath":
        # The ribs lift and the shoulders follow; the arms ride out with them.
        return merge(
            base,
            {
                "spine": {"pitch": base["spine"]["pitch"] - rad(2)},
                "chest": {"pitch": base["chest"]["pitch"] - rad(3)},
                "pelvis": {**base["pelvis"], "z": base["pelvis"]["z"] + 0.006},
                "armL": {"abduct": base["armL"]["abduct"] + rad(3)},
                "armR": {"abduct": base["armR"]["abduct"] + rad(3)},
                "head": {"pitch": base["head"]["pitch"] + rad(2)},
            },
        )
    if name == "shift":
        # Weight onto the other leg and a look over the shoulder: what someone standing around does.
        return merge(
            base,
            {
                "pelvis": {**base["pelvis"], "x": 0.035, "roll": base["pelvis"].get("roll", 0) + rad(5), "yaw": rad(-6)},
                "spine": {"roll": base["spine"].get("roll", 0) - rad(4)},
                "chest": {"yaw": rad(10)},
                "head": {"yaw": rad(32) if not infected else rad(-28), "pitch": base["head"]["pitch"] - rad(2)},
                "legL": {"z": 0.012, "pitch": rad(14)},
            },
        )
    if name == "windup":
        if infected:
            return merge(
                base,
                {
                    "pelvis": {**base["pelvis"], "y": 0.04, "pitch": rad(-2)},
                    "spine": {"pitch": rad(4)},
                    "chest": {"pitch": rad(-2)},
                    "head": {"pitch": rad(-22), "roll": rad(-6)},
                    "armL": {"flex": rad(-25), "abduct": rad(38), "elbow": rad(70), "wrist": rad(30)},
                    "armR": {"flex": rad(-30), "abduct": rad(34), "elbow": rad(64), "wrist": rad(30)},
                },
            )
        return merge(
            base,
            {
                "pelvis": {**base["pelvis"], "yaw": rad(-16), "y": 0.03},
                "spine": {"yaw": rad(-14), "pitch": rad(-2)},
                "chest": {"yaw": rad(-18)},
                "head": {"yaw": rad(30), "pitch": rad(-4)},
                "armR": {"flex": rad(150), "abduct": rad(24), "elbow": rad(86), "wrist": rad(-30)},
                "armL": {"flex": rad(36), "abduct": rad(16), "elbow": rad(48)},
                "legR": {"y": 0.16},
                "legL": {"y": -0.1},
            },
        )
    if name == "strike":
        if infected:
            return merge(
                base,
                {
                    "pelvis": {**base["pelvis"], "y": -0.14, "z": -0.1, "pitch": rad(16)},
                    "spine": {"pitch": rad(24)},
                    "chest": {"pitch": rad(20)},
                    "head": {"pitch": rad(-30), "roll": rad(-4)},
                    "armL": {"flex": rad(96), "abduct": rad(6), "elbow": rad(20), "wrist": rad(40)},
                    "armR": {"flex": rad(88), "abduct": rad(8), "elbow": rad(26), "wrist": rad(40)},
                    "legL": {"y": -0.3},
                    "legR": {"y": 0.26, "z": 0.03, "pitch": rad(28)},
                },
            )
        return merge(
            base,
            {
                "pelvis": {**base["pelvis"], "yaw": rad(20), "y": -0.08, "z": -0.05, "pitch": rad(8)},
                "spine": {"yaw": rad(16), "pitch": rad(14)},
                "chest": {"yaw": rad(20), "pitch": rad(10)},
                "head": {"yaw": rad(-30), "pitch": rad(-14)},
                "armR": {"flex": rad(58), "abduct": rad(-8), "elbow": rad(14), "wrist": rad(34)},
                "armL": {"flex": rad(-12), "abduct": rad(18), "elbow": rad(40)},
                "legL": {"y": -0.27},
                "legR": {"y": 0.24, "z": 0.03, "pitch": rad(30)},
            },
        )
    if name == "aim":
        # A bladed stance: gun arm out straight, the other hand under it, knees soft.
        return merge(
            base,
            {
                "pelvis": {**base["pelvis"], "z": -0.05, "yaw": rad(-22), "pitch": rad(4)},
                "spine": {"yaw": rad(8), "pitch": rad(5)},
                "chest": {"yaw": rad(10), "pitch": rad(3)},
                "head": {"yaw": rad(6), "pitch": rad(-7), "roll": rad(6)},
                "armR": {"flex": rad(86), "abduct": rad(-6), "elbow": rad(8), "wrist": rad(2)},
                "armL": {"flex": rad(74), "abduct": rad(-44), "elbow": rad(22)},
                "legL": {"y": -0.19, "x": -0.03},
                "legR": {"y": 0.2, "x": 0.05, "toe_out": rad(34)},
            },
        )
    if name == "hit":
        # Knocked back: the chest snaps away from the blow and the knees give.
        return merge(
            base,
            {
                "pelvis": {**base["pelvis"], "y": 0.07, "z": base["pelvis"]["z"] - 0.05, "pitch": rad(-10)},
                "spine": {"pitch": rad(-12), "roll": rad(6)},
                "chest": {"pitch": rad(-10), "yaw": rad(14)},
                "head": {"pitch": rad(16), "roll": rad(10)},
                "armL": {"flex": rad(30), "abduct": rad(30), "elbow": rad(50)},
                "armR": {"flex": rad(18), "abduct": rad(26), "elbow": rad(46)},
                "legR": {"y": 0.18},
            },
        )
    raise ValueError(name)


def build(infected, pose="stand"):
    body = build_body(infected)
    return body.posed(solve(pose_for(infected, pose))), body.faces, body.materials, body.colors


# -------------------------------------------------------------------- export


def make_object(name, vertices, faces, names, colors):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in vertices], [], faces)
    assert not mesh.validate(), "Generated character mesh is invalid"
    # One consistent outward winding, decided on the rest stance and kept for every pose.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    material_names = list(dict.fromkeys(names))
    for mname in material_names:
        mat = bpy.data.materials.new(mname)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.86
        attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Color"
        mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        mesh.materials.append(mat)
    attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for poly, mname, color in zip(mesh.polygons, names, colors):
        poly.material_index = material_names.index(mname)
        # Smooth, so the exporter keeps one vertex where faces meet; the renderer shades flat.
        poly.use_smooth = True
        for loop in poly.loop_indices:
            attr.data[loop].color = (*color, 1)
    return ob


def generate(infected, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(out_dir, exist_ok=True)
    vertices, faces, names, colors = build(infected)
    ob = make_object("infected" if infected else "survivor", vertices, faces, names, colors)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    ob.shape_key_add(name="Basis")
    for name in POSE_NAMES:
        points, check_faces, _, _ = build(infected, name)
        assert check_faces == faces and len(points) == len(vertices), "Morph topology changed"
        key = ob.shape_key_add(name=name)
        for vertex, point in zip(key.data, points):
            vertex.co = point
    path = os.path.join(out_dir, "infected.glb" if infected else "walker.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_normals=False,
        export_texcoords=False,
        export_animations=False,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_cameras=False,
        export_lights=False,
    )
    size = os.path.getsize(path)
    assert size <= 512 * 1024, f"Character exceeds asset budget: {size}"
    tris = sum(len(f) - 2 for f in faces)
    print(f"CHARACTER {path}: {len(vertices)} vertices, {tris} triangles, {len(POSE_NAMES)} morphs, {size} bytes")
    # Update provenance only when regenerating an asset inside the shipped art directory.
    manifest_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../apps/web/public/art/manifest.json"))
    with open(manifest_path, encoding="utf8") as f:
        manifest = json.load(f)
    matched = False
    for asset in manifest["assets"]:
        if os.path.realpath(os.path.join(os.path.dirname(manifest_path), asset["file"])) == os.path.realpath(path):
            with open(path, "rb") as f:
                asset["sha256"] = hashlib.sha256(f.read()).hexdigest()
            asset["bytes"] = size
            asset["generator"] = "tools/blender/infected.py" if infected else "tools/blender/survivors.py"
            matched = True
    if matched:
        with open(manifest_path, "w", encoding="utf8") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")


def preview(out_png, rows):
    """Renders poses side by side, so a gait can be looked at instead of trusted.

    `rows` is a list of (infected, [pose names]); each row is drawn from the side
    and, behind it, from the front.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tints = {"cloth": (0.42, 0.5, 0.44), "pants": (0.2, 0.24, 0.32), "hair": (0.16, 0.1, 0.06), "skin": (0.82, 0.62, 0.48)}
    widest = max(len(names) for _, names in rows)
    for r, (infected, names) in enumerate(rows):
        for i, name in enumerate(names):
            verts, faces, mats, colors = build(infected, name)
            # Show one weapon, as the game does: the rifle when aiming, the crowbar otherwise.
            held = "rifle" if name == "aim" else "crowbar"
            keep = [k for k, m in enumerate(mats) if m not in ("crowbar", "pistol", "rifle") or m == held]
            faces, mats, colors = [faces[k] for k in keep], [mats[k] for k in keep], [colors[k] for k in keep]
            for view, depth in ((0, 0.0), (1, 3.0)):
                tinted = []
                for m, c in zip(mats, colors):
                    t = tints.get(m, (1, 1, 1))
                    if infected and m == "skin":
                        t = (0.56, 0.62, 0.46)
                    tinted.append((c[0] * t[0], c[1] * t[1], c[2] * t[2]))
                ob = make_object(f"{name}_{r}_{view}", verts, faces, mats, tinted)
                for poly in ob.data.polygons:
                    poly.use_smooth = False
                ob.location = (i * 1.15, depth, -r * 2.25)
                ob.rotation_euler = (0, 0, math.radians(90 if view == 0 else 0))
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.display.shading.show_cavity = True
    sc.display.shading.show_shadows = False
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.32, 0.34, 0.36)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    width = widest * 1.15 * 2 + 0.6
    height = len(rows) * 2.25
    cam_data.ortho_scale = max(width, height * 1.0)
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (width / 2 - 0.6, -20, 1.0 - (len(rows) - 1) * 1.125)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    # The front views sit behind the side views in depth; shift them right in the frame.
    for ob in sc.objects:
        if ob.type == "MESH" and ob.location.y > 1:
            ob.location.x += widest * 1.15
            ob.location.y = 0
    sc.render.resolution_x = int(width * 190)
    sc.render.resolution_y = int(height * 190)
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {out_png}")
