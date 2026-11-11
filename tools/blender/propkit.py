"""Shared authored geometry and vertex-colour packing for the static city kit."""
import os
import bpy
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.85, metal=0.0, category="detail"):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    m["category"] = category
    return m


def box(size, loc, rot=(0, 0, 0), material=None, bevel=0.018):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        ob.data.materials.append(material)
    if bevel:
        mod = ob.modifiers.new("Edge highlights", "BEVEL")
        mod.width = min(bevel, min(size) * 0.18)
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def cyl(radius, depth, loc, rot=(0, 0, 0), verts=12, material=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.object
    if material:
        ob.data.materials.append(material)
    return ob


def cone(r1, r2, depth, loc, verts=12, material=None):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts, location=loc)
    ob = bpy.context.object
    if material:
        ob.data.materials.append(material)
    return ob


def beam(a, b, width, material, depth=None):
    a, b = Vector(a), Vector(b)
    ob = box((width, depth or width, (b-a).length), (a+b)/2, material=material, bevel=0)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = (b-a).to_track_quat("Z", "Y")
    return ob


def mesh(name, vertices, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    assert not data.validate(), name
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def loft(sections, material):
    """A longitudinal hull with a trapezoid at each (y, width, base, top) station."""
    vertices = []
    for y, w, low, high in sections:
        vertices += [(-w, y, low), (w, y, low), (w*.94, y, high), (-w*.94, y, high)]
    faces = [(3, 2, 1, 0)]
    for i in range(len(sections)-1):
        for k in range(4):
            a = i*4+k
            b = i*4+(k+1)%4
            faces.append((a, b, b+4, a+4))
    n = len(vertices)
    faces.append((n-4, n-3, n-2, n-1))
    return mesh("Shaped hull", vertices, [tuple(reversed(face)) for face in faces], material)


def join(name, objects=None):
    bpy.ops.object.select_all(action="DESELECT")
    objects = objects or [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    # A stable origin simplifies runtime placement and footprint inspection.
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return ob


def export(name, ob, out):
    """Keep authored palettes, with at most three draw batches per kit piece."""
    data = ob.data
    colors = data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    sources = list(data.materials)
    categories = []
    face_categories = []
    for poly in data.polygons:
        source = sources[poly.material_index]
        rgb = source.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:3]
        category = source.get("category", "detail")
        if category not in categories:
            categories.append(category)
        face_categories.append(category)
        tone = 0.94 + ((poly.index * 13) % 17) / 17 * 0.06
        if poly.normal.z < -0.2:
            tone *= 0.74
        for loop in poly.loop_indices:
            colors.data[loop].color = (*(c*tone for c in rgb), 1)
    data.materials.clear()
    for category in categories:
        material = mat("surface_" + category, (1, 1, 1), .3 if category == "glass" else .82,
                       .12 if category in ("paint", "glass") else 0)
        node = material.node_tree.nodes.new("ShaderNodeVertexColor")
        node.layer_name = "Color"
        material.node_tree.links.new(node.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
        data.materials.append(material)
    for poly, category in zip(data.polygons, face_categories):
        poly.material_index = categories.index(category)
    ob["art_revision"] = "urban-kit-2"
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(out, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True, export_texcoords=False,
        export_cameras=False, export_lights=False, export_animations=False, export_extras=True)
    tris = sum(len(p.vertices)-2 for p in data.polygons)
    assert os.path.getsize(path) <= 512*1024, f"{name} exceeds the asset budget"
    assert tris <= 6500, f"{name} exceeds the geometry budget: {tris}"
    print(f"KIT {name}: {tris} triangles, {len(categories)} batches, {os.path.getsize(path)} bytes")
