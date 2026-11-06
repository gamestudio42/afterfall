"""
Bakes the facade and roof textures: real geometry (recessed windows, frames,
sills, boarded openings, roller shutters) rendered head-on with Cycles, so the
depth and the contact shadows are in the texture instead of faked in paint.

Each style is one module that tiles in both directions: 4 bays by 4 floors of
3.2 m (12.8 m square, the game's floor height), or 4 bays by one floor for the
storefront. The geometry is built over 3 by 3 modules and only the centre one
is rendered, so a sill near the top edge still casts into the next tile, and
the noise is sampled on a torus, so grime has no seam either.

Two images per style:
  <style>.png       colour, lit by an even sky and a soft key from above
  <style>_lit.png   white where a window is lit at night, black elsewhere

Colours are kept light and close to neutral: the renderer multiplies them by
the building's tint, which carries game information (type, explored, looted,
function, overlays) and must still read through the facade.

Usage (headless):
  blender --background --factory-startup --python tools/blender/facades.py -- <out_dir> [samples]
"""
import math
import os
import random
import sys
import zlib

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
OUT = args[0]
SAMPLES = int(args[1]) if len(args) > 1 else 48
os.makedirs(OUT, exist_ok=True)

BAY = 3.2
FLOOR = 3.2
PX_PER_M = 40  # 512 px over 12.8 m
# Which object axis runs "up" the texture: z on a facade (built in XZ), y on the roof.
VERT_AXIS = 2


# ---------------------------------------------------------------- scene setup


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.film_transparent = False
    return sc


def world(strength, color=(1.0, 1.0, 1.0)):
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1.0)
    bg.inputs["Strength"].default_value = strength
    bpy.context.scene.world = w


def camera(cx, cz, width, height, front=True):
    """Orthographic camera framing exactly one module."""
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(width, height)
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    if front:
        cam.location = (cx, -30.0, cz)
        cam.rotation_euler = (math.radians(90), 0, 0)
    else:  # roof: look straight down
        cam.location = (cx, cz, 30.0)
        cam.rotation_euler = (0, 0, 0)
    cam_data.clip_end = 100
    sc.camera = cam
    sc.render.resolution_x = round(width * PX_PER_M)
    sc.render.resolution_y = round(height * PX_PER_M)
    if width != height:
        cam_data.sensor_fit = "HORIZONTAL" if width > height else "VERTICAL"


def sun(elev_deg, azim_deg, strength):
    d = bpy.data.lights.new("key", "SUN")
    d.energy = strength
    d.angle = math.radians(8)
    o = bpy.data.objects.new("key", d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(90 - elev_deg), 0, math.radians(azim_deg))


# ---------------------------------------------------------------- materials


def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links


def periodic_noise(nodes, links, period_x, period_y, scale, detail=4.0, stretch_y=1.0):
    """Noise texture sampled on a torus: seamless with the given periods (metres).
    A `stretch_y` below 1 shrinks the vertical circle, which stretches the
    noise along the vertical axis (rain streaks) without breaking the period."""
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Object"], sep.inputs[0])
    parts = []
    for axis, period, k in ((0, period_x, 1.0), (VERT_AXIS, period_y, stretch_y)):
        mul = nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = 2 * math.pi / period
        links.new(sep.outputs[axis], mul.inputs[0])
        cos = nodes.new("ShaderNodeMath")
        cos.operation = "COSINE"
        sin = nodes.new("ShaderNodeMath")
        sin.operation = "SINE"
        links.new(mul.outputs[0], cos.inputs[0])
        links.new(mul.outputs[0], sin.inputs[0])
        r = period / (2 * math.pi) * k
        for n in (cos, sin):
            k = nodes.new("ShaderNodeMath")
            k.operation = "MULTIPLY"
            k.inputs[1].default_value = r
            links.new(n.outputs[0], k.inputs[0])
            parts.append(k)
    comb = nodes.new("ShaderNodeCombineXYZ")
    for i in range(3):
        links.new(parts[i].outputs[0], comb.inputs[i])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    links.new(comb.outputs[0], noise.inputs["Vector"])
    links.new(parts[3].outputs[0], noise.inputs["W"])
    return noise


def grime(nodes, links, base_rgb, period_x, period_y, amount, streak=True):
    """Base colour darkened by seamless blotches and, on walls, vertical rain streaks."""
    blot = periodic_noise(nodes, links, period_x, period_y, 0.35)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.75
    v = 1 - amount
    ramp.color_ramp.elements[1].color = (v, v * 0.97, v * 0.93, 1)
    links.new(blot.outputs["Fac"], ramp.inputs["Fac"])
    out = ramp
    if streak:
        # Streaks: the same seamless noise, stretched along the vertical axis.
        st = periodic_noise(nodes, links, period_x, period_y, 2.2, 2.0, stretch_y=0.12)
        sramp = nodes.new("ShaderNodeValToRGB")
        sramp.color_ramp.elements[0].position = 0.55
        sramp.color_ramp.elements[0].color = (1, 1, 1, 1)
        sramp.color_ramp.elements[1].position = 0.8
        w = 1 - amount * 0.8
        sramp.color_ramp.elements[1].color = (w, w, w * 0.97, 1)
        links.new(st.outputs["Fac"], sramp.inputs["Fac"])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        links.new(ramp.outputs["Color"], mix.inputs[6])
        links.new(sramp.outputs["Color"], mix.inputs[7])
        out = mix
    tint = nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs[6].default_value = (*base_rgb, 1)
    links.new(out.outputs[2] if out.bl_idname == "ShaderNodeMix" else out.outputs["Color"], tint.inputs[7])
    return tint


def mat_flat(name, rgb, rough=0.8, metal=0.0, period=(12.8, 12.8), dirt=0.0):
    m, nodes, links = node_mat(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if dirt > 0:
        g = grime(nodes, links, rgb, period[0], period[1], dirt, streak=False)
        links.new(g.outputs[2], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    return m


def mat_brick(name, brick_rgb, mortar_rgb, period, dirt):
    m, nodes, links = node_mat(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    coord = nodes.new("ShaderNodeTexCoord")
    brick = nodes.new("ShaderNodeTexBrick")
    # Object space, metres: 0.32 m bricks and 0.08 m rows divide the module exactly.
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Brick Width"].default_value = 0.32
    brick.inputs["Row Height"].default_value = 0.08
    brick.inputs["Mortar Size"].default_value = 0.008
    brick.inputs["Color1"].default_value = (*brick_rgb, 1)
    brick.inputs["Color2"].default_value = tuple(c * 0.9 for c in brick_rgb) + (1,)
    brick.inputs["Mortar"].default_value = (*mortar_rgb, 1)
    brick.offset = 0.5
    brick.squash = 1.0
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (math.radians(90), 0, 0)  # wall is in XZ
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], brick.inputs["Vector"])
    g = grime(nodes, links, (1, 1, 1), period[0], period[1], dirt)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    links.new(brick.outputs["Color"], mix.inputs[6])
    links.new(g.outputs[2], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    links.new(brick.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_corrugated(name, rgb, period, dirt):
    m, nodes, links = node_mat(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.6
    bsdf.inputs["Metallic"].default_value = 0.35
    coord = nodes.new("ShaderNodeTexCoord")
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    # Bands run sin(20 * scale * x): 0.2 m ribs, 64 per module, so they wrap exactly.
    wave.inputs["Scale"].default_value = 2 * math.pi / (20 * 0.2)
    wave.inputs["Distortion"].default_value = 0.0
    wave.inputs["Detail"].default_value = 0.0
    links.new(coord.outputs["Object"], wave.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    links.new(wave.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    g = grime(nodes, links, rgb, period[0], period[1], dirt)
    rib = nodes.new("ShaderNodeMapRange")
    rib.inputs["To Min"].default_value = 0.78
    rib.inputs["To Max"].default_value = 1.0
    links.new(wave.outputs["Fac"], rib.inputs["Value"])
    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    links.new(g.outputs[2], shade.inputs[6])
    links.new(rib.outputs[0], shade.inputs[7])
    links.new(shade.outputs[2], bsdf.inputs["Base Color"])
    return m


def mat_glass(name, rgb=(0.05, 0.065, 0.08), rough=0.12):
    m, nodes, links = node_mat(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


def mat_wood(name, period):
    m, nodes, links = node_mat(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    g = grime(nodes, links, (0.42, 0.32, 0.22), period[0], period[1], 0.35, streak=False)
    links.new(g.outputs[2], bsdf.inputs["Base Color"])
    return m


def mat_emit(name, strength):
    m, nodes, links = node_mat(name)
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1, 1, 1, 1)
    em.inputs["Strength"].default_value = strength
    links.new(em.outputs[0], out.inputs[0])
    return m


# ---------------------------------------------------------------- geometry


def box(name, x0, x1, y0, y1, z0, z1, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.name = name
    o.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True)
    if mat:
        o.data.materials.append(mat)
    return o


def slab_with_holes(name, holes, mat, x0, x1, z0, z1, depth=0.3, cut_to=0.2):
    """Wall slab over [x0,x1]x[z0,z1], front face at y=0, with rectangular holes
    cut back to `cut_to`; whatever sits in a hole must stay in front of that."""
    slab = box(name, x0, x1, 0.0, depth, z0, z1, mat)
    cutters = []
    for i, (hx0, hx1, hz0, hz1) in enumerate(holes):
        cutters.append(box(f"cut{i}", hx0, hx1, -0.5, cut_to, hz0, hz1, None))
    if cutters:
        # One union of all cutters, then a single difference: far faster than one modifier per hole.
        bpy.ops.object.select_all(action="DESELECT")
        for c in cutters:
            c.select_set(True)
        bpy.context.view_layer.objects.active = cutters[0]
        bpy.ops.object.join()
        cut = bpy.context.active_object
        mod = slab.modifiers.new("holes", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cut
        bpy.context.view_layer.objects.active = slab
        bpy.ops.object.modifier_apply(modifier="holes")
        bpy.data.objects.remove(cut, do_unlink=True)
    return slab


def tile_offsets(w, h, rows=True):
    """The 3x3 (or 3x1 for one-floor modules) copies of a module."""
    zs = (-h, 0.0, h) if rows else (0.0,)
    return [(dx, dz) for dz in zs for dx in (-w, 0.0, w)]


# ---------------------------------------------------------------- styles


def window_cell(prefix, x, z, w, h, mats, kind, recess=0.2, sill=True, mullion=True):
    """One window opening's contents: glass, frame, sill, or boards."""
    parts = []
    gy = recess - 0.03
    if kind == "boarded":
        parts.append(box(prefix + "back", x, x + w, gy, gy + 0.02, z, z + h, mats["glass"]))
        n = 4
        for i in range(n):
            bz = z + 0.1 + i * (h - 0.2) / n
            tilt = (i % 2) * 0.03
            parts.append(box(prefix + f"board{i}", x - 0.08, x + w + 0.08, -0.05, -0.02, bz + tilt, bz + tilt + (h - 0.2) / n * 0.82, mats["wood"]))
    else:
        pick = zlib.crc32(prefix.encode())
        glass = mats["lit_v"][pick % len(mats["lit_v"])] if kind == "lit" else mats["glass_v"][pick % len(mats["glass_v"])]
        parts.append(box(prefix + "glass", x, x + w, gy, gy + 0.02, z, z + h, glass))
        f = 0.06
        fm = mats["frame"]
        parts.append(box(prefix + "fl", x, x + f, gy - 0.05, gy, z, z + h, fm))
        parts.append(box(prefix + "fr", x + w - f, x + w, gy - 0.05, gy, z, z + h, fm))
        parts.append(box(prefix + "ft", x, x + w, gy - 0.05, gy, z + h - f, z + h, fm))
        parts.append(box(prefix + "fb", x, x + w, gy - 0.05, gy, z, z + f, fm))
        if mullion:
            parts.append(box(prefix + "mv", x + w / 2 - 0.03, x + w / 2 + 0.03, gy - 0.04, gy, z, z + h, fm))
            parts.append(box(prefix + "mh", x, x + w, gy - 0.04, gy, z + h * 0.62, z + h * 0.62 + 0.05, fm))
    if sill:
        parts.append(box(prefix + "sill", x - 0.1, x + w + 0.1, -0.1, recess, z - 0.08, z, mats["sill"]))
    return parts


def build_residential(mats, rng, lit_mode):
    W = H = 12.8
    plan = {}
    for fl in range(4):
        for bay in range(4):
            r = rng.random()
            plan[(bay, fl)] = "boarded" if r < 0.12 else ("lit" if r < 0.6 else "dark")
    holes = []
    for dx, dz in tile_offsets(W, H):
        for (bay, fl), kind in plan.items():
            x = dx + bay * BAY + 0.95
            z = dz + fl * FLOOR + 0.9
            holes.append((x, x + 1.3, z, z + 1.6))
            k = kind if (lit_mode or kind != "lit") else "dark"
            window_cell(f"w{dx}_{dz}_{bay}_{fl}_", x, z, 1.3, 1.6, mats, k)
        # Floor line: a thin band at each slab.
        for fl in range(4):
            box(f"band{dx}_{dz}_{fl}", dx - 0.01, dx + W + 0.01, -0.04, 0.0, dz + fl * FLOOR - 0.06, dz + fl * FLOOR + 0.1, mats["sill"])
    slab_with_holes("wall", holes, mats["wall"], -W, 2 * W, -H, 2 * H, cut_to=0.2)
    return plan


def build_office(mats, rng, lit_mode):
    W = H = 12.8
    plan = {}
    for fl in range(4):
        for bay in range(8):
            plan[(bay, fl)] = "lit" if rng.random() < 0.38 else "dark"
    holes = []
    for dx, dz in tile_offsets(W, H):
        for fl in range(4):
            z = dz + fl * FLOOR + 0.85
            holes.append((dx - 0.01, dx + W + 0.01, z, z + 1.9))
            for bay in range(8):
                x = dx + bay * 1.6
                kind = plan[(bay, fl)]
                k = kind if lit_mode else ("dark" if kind == "lit" else kind)
                cool = [g for g in mats["glass_v"] if "curtain" not in g.name] or mats["glass_v"]
                pick = bay * 7 + fl * 3
                glass = mats["lit_v"][pick % len(mats["lit_v"])] if k == "lit" else cool[pick % len(cool)]
                box(f"g{dx}_{dz}_{fl}_{bay}", x, x + 1.6, 0.15, 0.17, z, z + 1.9, glass)
                box(f"m{dx}_{dz}_{fl}_{bay}", x - 0.06, x + 0.06, 0.02, 0.15, z, z + 1.9, mats["mullion"])
            box(f"t{dx}_{dz}_{fl}", dx - 0.01, dx + W + 0.01, 0.06, 0.15, z + 1.84, z + 1.9, mats["frame"])
            box(f"b{dx}_{dz}_{fl}", dx - 0.01, dx + W + 0.01, -0.06, 0.15, z - 0.05, z + 0.02, mats["sill"])
    slab_with_holes("wall", holes, mats["wall"], -W, 2 * W, -H, 2 * H, depth=0.25, cut_to=0.18)
    return plan


def build_industrial(mats, rng, lit_mode):
    W = H = 12.8
    plan = {}
    for fl in range(4):
        for bay in range(4):
            plan[(bay, fl)] = ("lit" if rng.random() < 0.25 else "dark") if fl % 2 == 1 else None
    holes = []
    for dx, dz in tile_offsets(W, H):
        for (bay, fl), kind in plan.items():
            if kind is None:
                continue
            x = dx + bay * BAY + 0.3
            z = dz + fl * FLOOR + 1.9
            holes.append((x, x + 2.6, z, z + 0.8))
            k = kind if lit_mode else "dark"
            window_cell(f"w{dx}_{dz}_{bay}_{fl}_", x, z, 2.6, 0.8, mats, k, recess=0.12, sill=False, mullion=False)
        for bay in range(4):
            # Steel columns between the bays.
            x = dx + bay * BAY
            box(f"col{dx}_{dz}_{bay}", x - 0.12, x + 0.12, -0.12, 0.0, dz, dz + H, mats["frame"])
    slab_with_holes("wall", holes, mats["wall"], -W, 2 * W, -H, 2 * H, depth=0.2, cut_to=0.12)
    return plan


def build_storefront(mats, rng, lit_mode):
    """Ground floor of shops: two shop windows and a door per module, a sign
    band above, and roller shutters pulled part way or all the way down."""
    W, H = 12.8, 3.2
    plan = {}
    for bay in range(2):
        r = rng.random()
        plan[bay] = "shutter" if r < 0.4 else ("lit" if r < 0.7 else "dark")
    holes = []
    for dx, _ in tile_offsets(W, H, rows=False):
        for bay in range(2):
            x = dx + 0.5 + bay * 6.4
            holes.append((x, x + 5.0, 0.35, 2.55))
            kind = plan[bay]
            k = kind if lit_mode else ("dark" if kind == "lit" else kind)
            box(f"g{dx}_{bay}", x, x + 5.0, 0.2, 0.22, 0.35, 2.55, mats["lit_v"][bay % len(mats["lit_v"])] if k == "lit" else mats["glass"])
            box(f"door{dx}_{bay}", x + 3.6, x + 3.66, 0.12, 0.2, 0.35, 2.55, mats["frame"])
            box(f"mul{dx}_{bay}", x + 1.8, x + 1.86, 0.12, 0.2, 0.35, 2.55, mats["frame"])
            # Roller shutter: down to the sill when closed, half way otherwise.
            drop = 2.2 if kind == "shutter" else (0.35 + rng.random() * 0.5)
            box(f"sh{dx}_{bay}", x, x + 5.0, 0.04, 0.1, 2.55 - drop, 2.55, mats["shutter"])
            box(f"box{dx}_{bay}", x - 0.1, x + 5.1, -0.12, 0.1, 2.55, 2.8, mats["frame"])
        # Sign band and base course.
        box(f"sign{dx}", dx - 0.01, dx + W + 0.01, -0.08, 0.0, 2.85, 3.2, mats["sign"])
        box(f"base{dx}", dx - 0.01, dx + W + 0.01, -0.05, 0.0, -0.1, 0.35, mats["sill"])
    slab_with_holes("wall", holes, mats["wall"], -W, 2 * W, -0.5, H + 0.5, depth=0.3, cut_to=0.25)
    return plan


def build_roof(mats, rng):
    """Flat roof seen from above: membrane with seams, gravel, vents, a hatch."""
    W = H = 12.8
    for dx, dy in tile_offsets(W, H):
        box(f"deck{dx}_{dy}", dx, dx + W, dy, dy + H, -0.2, 0.0, mats["roof"])
        for i in range(4):
            box(f"seam{dx}_{dy}_{i}", dx + i * 3.2 - 0.03, dx + i * 3.2 + 0.03, dy, dy + H, 0.0, 0.02, mats["seam"])
    r = random.Random(7)
    items = [(r.uniform(1, 11), r.uniform(1, 11)) for _ in range(5)]
    for dx, dy in tile_offsets(W, H):
        for j, (x, y) in enumerate(items):
            if j == 0:
                box(f"hatch{dx}_{dy}", dx + x, dx + x + 1.0, dy + y, dy + y + 1.0, 0, 0.35, mats["frame"])
            else:
                s = 0.35 + 0.1 * j
                bpy.ops.mesh.primitive_cylinder_add(radius=s / 2, depth=0.5, vertices=12, location=(dx + x, dy + y, 0.25))
                bpy.context.active_object.data.materials.append(mats["frame"])


# ---------------------------------------------------------------- render


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"FACADE wrote {path}")


STYLES = {
    "facade_residential": (build_residential, (12.8, 12.8), 11),
    "facade_office": (build_office, (12.8, 12.8), 23),
    "facade_industrial": (build_industrial, (12.8, 12.8), 37),
    "facade_storefront": (build_storefront, (12.8, 3.2), 41),
}

only = set(args[2].split(",")) if len(args) > 2 else None

for name, (build, (w, h), seed) in STYLES.items():
    if only and name not in only:
        continue
    period = (w, h)
    for lit_mode in (False, True):
        reset()
        rng = random.Random(seed)
        if not lit_mode:
            wall = {
                "facade_residential": lambda: mat_brick("wall", (0.8, 0.72, 0.64), (0.85, 0.84, 0.8), period, 0.4),
                "facade_office": lambda: mat_flat("wall", (0.8, 0.79, 0.76), 0.85, period=period, dirt=0.25),
                "facade_industrial": lambda: mat_corrugated("wall", (0.74, 0.75, 0.74), period, 0.3),
                "facade_storefront": lambda: mat_flat("wall", (0.78, 0.76, 0.72), 0.85, period=period, dirt=0.3),
            }[name]()
            mats = {
                "wall": wall,
                "glass": mat_glass("glass"),
                "lit": mat_glass("glass"),
                "lit_v": [mat_glass("glass_lit")],
                "glass_v": [
                    mat_glass("glass_plain"),
                    mat_glass("glass_curtain", (0.32, 0.27, 0.22), 0.7),
                    mat_glass("glass_dusty", (0.12, 0.13, 0.13), 0.45),
                    mat_glass("glass_sky", (0.1, 0.14, 0.18), 0.05),
                ],
                "frame": mat_flat("frame", (0.55, 0.56, 0.57), 0.5, 0.3),
                "mullion": mat_flat("mullion", (0.22, 0.23, 0.24), 0.45, 0.5),
                "sill": mat_flat("sill", (0.84, 0.83, 0.8), 0.9, period=period, dirt=0.2),
                "wood": mat_wood("wood", period),
                "shutter": mat_corrugated("shutter", (0.6, 0.6, 0.6), period, 0.35),
                "sign": mat_flat("sign", (0.5, 0.5, 0.52), 0.7, period=period, dirt=0.35),
            }
            world(0.5, (0.92, 0.95, 1.0))
            sun(55, 20, 1.3)
        else:
            black = mat_emit("black", 0.0)
            mats = {k: black for k in ("wall", "glass", "frame", "mullion", "sill", "wood", "shutter", "sign")}
            mats["glass_v"] = [black]
            mats["lit"] = mat_emit("lit", 1.0)
            # Lit rooms differ: a bright kitchen, a lamp behind a curtain, a TV glow.
            mats["lit_v"] = [mat_emit("lit_full", 1.0), mat_emit("lit_mid", 0.7), mat_emit("lit_dim", 0.45)]
            world(0.0)
        build(mats, rng, lit_mode)
        camera(w / 2, h / 2, w, h)
        bpy.context.scene.cycles.samples = SAMPLES if not lit_mode else 4
        bpy.context.scene.cycles.use_denoising = not lit_mode
        render(os.path.join(OUT, f"{name}{'_lit' if lit_mode else ''}.png"))

if not only or "roof" in only:
    VERT_AXIS = 1
    reset()
    period = (12.8, 12.8)
    mats = {
        "roof": mat_flat("roof", (0.34, 0.33, 0.32), 0.95, period=period, dirt=0.45),
        "seam": mat_flat("seam", (0.22, 0.22, 0.22), 0.9),
        "frame": mat_flat("frame", (0.5, 0.51, 0.52), 0.5, 0.4),
    }
    world(0.5, (0.92, 0.95, 1.0))
    sun(60, 30, 1.3)
    build_roof(mats, random.Random(5))
    camera(6.4, 6.4, 12.8, 12.8, front=False)
    render(os.path.join(OUT, "roof.png"))
