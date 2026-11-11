"""Original low-poly characters with topology-stable morph animation.

Run through survivors.py / infected.py. Blender Z-up, facing -Y. Every pose
shares vertex order; glTF morph targets let Three.js blend per instance, including
shadow passes, without a skeleton or a draw call for each animation frame.
"""
import math
import os
import hashlib
import json

import bpy
from mathutils import Euler, Vector

WALK_KEYS = 8
POSE_NAMES = [f"walk{i}" for i in range(WALK_KEYS)] + ["breath", "windup", "strike", "aim"] + [f"run{i}" for i in range(4)]


def build(infected, pose="rest"):
    verts, faces, materials, colors = [], [], [], []

    def shape(points, polygons, material="detail", color=(1, 1, 1)):
        start = len(verts)
        verts.extend(tuple(p) for p in points)
        faces.extend(tuple(start + i for i in face) for face in polygons)
        materials.extend([material] * len(polygons))
        colors.extend([color] * len(polygons))

    def rings(centers, radii, material, color=(1, 1, 1), sides=8):
        points = []
        for center, (rx, ry) in zip(centers, radii):
            for i in range(sides):
                a = (i + .5) * math.tau / sides
                points.append(Vector(center) + Vector((math.cos(a) * rx, math.sin(a) * ry, 0)))
        polygons = [tuple(range(sides - 1, -1, -1))]
        for j in range(len(centers) - 1):
            for i in range(sides):
                n = (i + 1) % sides
                polygons.append((j*sides+i, j*sides+n, (j+1)*sides+n, (j+1)*sides+i))
        polygons.append(tuple((len(centers)-1)*sides+i for i in range(sides)))
        shape(points, polygons, material, color)

    def box(center, size, material="detail", color=(1, 1, 1)):
        c = Vector(center)
        points = [c + Vector((x*size[0]/2, y*size[1]/2, z*size[2]/2))
                  for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                                  (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        shape(points, [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], material, color)

    def limb(a, b, r0, r1, material, color=(1, 1, 1), sides=6):
        a, b = Vector(a), Vector(b)
        axis = (b-a).normalized()
        # Keep the ring's X axis stable through a stride. A tracking quaternion
        # flips its roll when a limb crosses vertical; blending those two rings
        # collapses the arm/calf to a line even though both endpoint poses look fine.
        tangent = (Vector((1,0,0)) - axis * axis.x).normalized()
        bitangent = axis.cross(tangent)
        points = [p + (tangent*math.cos(i*math.tau/sides) + bitangent*math.sin(i*math.tau/sides))*r
                  for p, r in [(a,r0),(b,r1)] for i in range(sides)]
        shape(points, [tuple(range(sides-1,-1,-1)), tuple(range(sides,2*sides))] +
              [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)], material, color)

    running = pose.startswith("run")
    walking = pose.startswith("walk") or running
    phase = int(pose[3:]) / 4 if running else int(pose[4:]) / WALK_KEYS if walking else 0
    breath = 1 if pose == "breath" else 0
    windup, strike, aim = (float(pose == name) for name in ("windup", "strike", "aim"))
    bob = (.045 if running else .018)*math.cos(phase*math.tau*2) if walking else 0
    sway = .025*math.sin(phase*math.tau) if walking else 0
    hip = Vector((sway, 0, .94 + bob))
    lean = (.25 if infected else .065) + (.08 if running else 0)
    chest = hip + Vector((-.035 if infected else 0, -lean - .09*strike + .04*windup, (.40 if infected else .47) + .012*breath))
    neck = chest + Vector((.025 if infected else 0, -.065 if infected else -.035, .11 if infected else .14))
    head = neck + Vector((.035 if infected else 0, -.075 if infected else -.005, .15))
    cloth = (.54,.58,.52) if infected else (1,1,1)
    pants = (.095,.115,.10) if infected else (.075,.105,.135)
    leather = (.12,.085,.05)
    boot = (.035,.042,.045)
    hair = (.045,.027,.018)
    blood = (.20,.035,.022)
    # Tapered pelvis, waist, ribcage and shoulder planes, rather than stacked cubes.
    rings([hip+Vector((0,0,-.08)),hip+Vector((0,0,.06)),chest+Vector((0,0,-.13)),chest],
          [(.17,.115),(.155,.105),(.235 if infected else .225,.135),(.235,.12)], "cloth", cloth)
    rings([hip+Vector((0,0,-.085)),hip+Vector((0,0,-.025))],[(.18,.12),(.18,.12)],"detail",pants)
    limb(neck-Vector((0,0,.09)),head-Vector((0,0,.07)),.067,.061,"skin")
    # Skull, cheekbones and a narrower jaw give the face an actual profile.
    rings([head+Vector((0,0,z)) for z in [-.13,-.075,.055,.12]],
          [(.065,.071),(.102,.098),(.108,.102),(.073,.075)],"skin")
    for side in (-1,1):
        limb(head+Vector((side*.104,0,-.03)),head+Vector((side*.115,0,.025)),.025,.023,"skin")
        box(head+Vector((side*.043,-.092,.008)),(.039,.021,.025),"detail",(.055,.045,.035))
        box(head+Vector((side*.043,-.105,.009)),(.021,.009,.011),"eyes" if infected else "detail",
            (.7,.83,.35) if infected else (.33,.35,.29))
        box(head+Vector((side*.045,-.098,.035)),(.054,.015,.014),"detail",hair)
    limb(head+Vector((0,-.095,.015)),head+Vector((0,-.129,-.036)),.024,.021,"skin")
    box(head+Vector((0,-.089,-.076)),(.057,.012,.015),"detail",blood if infected else (.22,.12,.08))
    if infected:
        # Recessed cheek wounds, torn shirt edges and asymmetrical exposed flesh.
        box(head+Vector((.079,-.075,-.055)),(.033,.012,.055),"detail",blood)
        for side in (-1,1):
            for j in range(3):
                x = side*(.04+j*.05)
                shape([(x,-.125,.94),(x+.032,-.125,.94),(x+.012,-.14,.84-j*.015)],[(0,1,2)],"cloth",cloth)
        for z in (1.21,1.27,1.33):
            box((-.09,-lean-.137,z+bob),(.085,.012,.016),"detail",blood)
        rings([head+Vector((0,.018,.078)),head+Vector((0,.022,.125))],[(.099,.079),(.063,.053)],"detail",hair)
    else:
        # Cropped hair with a swept crown, sideburns and an open jacket collar.
        rings([head+Vector((0,.018,.052)),head+Vector((.012,.016,.13)),head+Vector((.022,.015,.15))],
              [(.111,.09),(.09,.084),(.045,.05)],"detail",hair)
        for side in (-1,1):
            box(head+Vector((side*.10,.018,.01)),(.019,.11,.09),"detail",hair)
            limb(chest+Vector((side*.055,-.12,.075)),chest+Vector((side*.105,-.14,-.05)),.035,.024,"cloth",(.55,.65,.67))
            box(chest+Vector((side*.12,-.135,-.13)),(.105,.035,.105),"cloth",(.72,.8,.83))
            box(chest+Vector((side*.12,-.159,-.09)),(.11,.009,.027),"detail",(.48,.37,.22))
            # Shoulder straps sit proud of the jacket and travel with the chest.
            limb(chest+Vector((side*.15,-.13,.025)),hip+Vector((side*.11,-.12,.13)),.024,.021,"detail",leather,4)
        box(chest+Vector((0,-.142,-.13)),(.012,.012,.32),"detail",(.31,.32,.28))
        rings([chest+Vector((0,.19,-.37)),chest+Vector((0,.21,-.13)),chest+Vector((0,.19,.015))],
              [(.135,.075),(.155,.09),(.13,.065)],"detail",(.24,.20,.115))
        box(chest+Vector((0,.294,-.25)),(.21,.045,.13),"detail",(.32,.27,.16))
        box(hip+Vector((.20,0,.015)),(.09,.13,.15),"detail",leather)

    upper_ranges = [(0, len(verts))]
    for side in (-1,1):
        p = (phase + (0 if side == -1 else .5)) % 1
        foot_y, lift = (side*.035,0)
        if walking:
            if p < .5:
                foot_y = -.33 + p*1.32
            else:
                u = (p-.5)*2
                foot_y = .33 - .66*(u*u*(3-2*u))
                lift = math.sin(u*math.pi)*(.115 if infected and side == 1 else .20)
            if running:
                foot_y *= 1.25
                lift *= 1.7
        ankle = Vector((side*.115,foot_y,.13+lift))
        hip_side = hip + Vector((side*.115,0,-.015))
        # Two-bone inverse kinematics keeps the sole planted on the stance half.
        delta = ankle-hip_side
        distance = delta.length
        midpoint = hip_side+delta*.5
        bend = math.sqrt(max(0,.455**2-(distance*.5)**2))
        forward = Vector((0,delta.z,-delta.y)).normalized()
        knee = midpoint+forward*bend
        limb(hip_side,knee,.10,.077,"detail",pants)
        limb(knee,ankle,.079,.052,"skin" if infected and side == 1 else "detail",(1,1,1) if infected and side == 1 else pants)
        box(ankle+Vector((0,-.046,-.063)),(.125,.255,.105),"detail",boot)
        box(ankle+Vector((0,-.052,-.112)),(.132,.265,.031),"detail",(.075,.068,.055))
        if not infected:
            box(knee+Vector((0,-.059,0)),(.112,.055,.12),"detail",(.13,.16,.17))
        arm_start = len(verts)
        shoulder = chest+Vector((side*.23,0,-.005))
        swing = (.25 if running else .12 if infected else .20)*math.cos(p*math.tau) if walking else 0
        elbow = shoulder+Vector((side*.045,.04+swing-.19*aim+.12*windup-.20*strike,-.27+.20*aim+.19*windup+.10*strike))
        wrist = elbow+Vector((side*.015,-.10+swing*.4-.18*aim-.24*strike,-.25+.28*aim+.38*windup+.10*strike))
        if running:
            wrist.y -= .16
            wrist.z += .16
        if infected:
            elbow.y -= .09 if side == 1 else 0
            wrist.y -= .12
            wrist.z -= .045
        sleeve_end = shoulder.lerp(elbow,.68 if infected else .83)
        limb(shoulder,sleeve_end,.095,.074,"cloth",cloth)
        limb(sleeve_end,elbow,.074,.063,"skin")
        limb(elbow,wrist,.065,.043,"skin")
        limb(wrist,wrist+Vector((0,-.017,-.085)),.049,.037,"skin",sides=6)
        limb(wrist+Vector((-side*.031,-.025,-.015)),wrist+Vector((-side*.045,-.046,-.06)),.018,.012,"skin",sides=5)
        if infected:
            limb(elbow.lerp(wrist,.3),elbow.lerp(wrist,.45),.066,.06,"detail",blood)
        else:
            limb(elbow.lerp(wrist,.77),elbow.lerp(wrist,.94),.05,.046,"detail",(.38,.36,.27))
        if side == 1 and not infected:
            # Separate primitives: the renderer only instances the equipped weapon.
            bar_start = len(verts)
            tip = wrist+Vector((0,-.05,.05))
            limb(tip,tip+Vector((0,-.055,.42)),.018,.015,"crowbar",(.24,.27,.28),5)
            limb(tip+Vector((0,-.055,.42)),tip+Vector((0,-.12,.46)),.017,.014,"crowbar",(.24,.27,.28),5)
            bar_rotation = Euler((strike*1.5 - windup*.45,0,0)).to_matrix()
            for i in range(bar_start,len(verts)):
                verts[i] = tuple(wrist + bar_rotation @ (Vector(verts[i])-wrist))
            box(wrist+Vector((0,-.05,.02)),(.055,.09,.12),"pistol",(.09,.10,.105))
            box(wrist+Vector((0,-.12,.09)),(.065,.24,.06),"pistol",(.18,.19,.19))
            box(wrist+Vector((0,-.11,.065)),(.065,.30,.08),"rifle",(.13,.15,.14))
            limb(wrist+Vector((0,-.26,.08)),wrist+Vector((0,-.57,.08)),.019,.016,"rifle",(.10,.12,.13),5)
            box(wrist+Vector((0,.08,.055)),(.07,.18,.10),"rifle",leather)
        upper_ranges.append((arm_start, len(verts)))
    # Counter-rotation of shoulders and hips, with a stronger uneven sway on walkers.
    twist = math.sin(phase*math.tau) * (.07 if infected else .045) if walking else 0
    roll = math.sin(phase*math.tau) * .045 if walking and infected and not running else 0
    rotation = Euler((0,roll,twist)).to_matrix()
    for start, end in upper_ranges:
        for i in range(start,end):
            verts[i] = tuple(hip + rotation @ (Vector(verts[i])-hip))
    return verts, faces, materials, colors


def generate(infected, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(out_dir, exist_ok=True)
    vertices, faces, names, colors = build(infected)
    mesh = bpy.data.meshes.new("infected" if infected else "survivor")
    mesh.from_pydata(vertices, [], faces)
    assert not mesh.validate(), "Generated character mesh is invalid"
    mesh.update()
    ob = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    material_names = list(dict.fromkeys(names))
    for name in material_names:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = .86
        attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Color"
        mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        mesh.materials.append(mat)
    attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for poly, name, color in zip(mesh.polygons, names, colors):
        poly.material_index = material_names.index(name)
        for loop in poly.loop_indices:
            attr.data[loop].color = (*color,1)
    ob.shape_key_add(name="Basis")
    for name in POSE_NAMES:
        points, check_faces, _, _ = build(infected,name)
        assert check_faces == faces and len(points) == len(vertices), "Morph topology changed"
        key = ob.shape_key_add(name=name)
        for vertex, point in zip(key.data,points):
            vertex.co = point
    path = os.path.join(out_dir,"infected.glb" if infected else "walker.glb")
    bpy.ops.export_scene.gltf(filepath=path,export_format="GLB",use_selection=True,
        export_yup=True,export_normals=True,export_texcoords=False,export_animations=False,
        export_morph=True,export_morph_normal=False,export_morph_tangent=False,
        export_cameras=False,export_lights=False)
    size = os.path.getsize(path)
    assert size <= 512*1024, f"Character exceeds asset budget: {size}"
    print(f"CHARACTER {path}: {len(vertices)} vertices, {len(POSE_NAMES)} morphs, {size} bytes")
    # Update provenance only when regenerating an asset inside the shipped art directory.
    manifest_path = os.path.abspath(os.path.join(os.path.dirname(__file__),"../../apps/web/public/art/manifest.json"))
    with open(manifest_path,encoding="utf8") as f:
        manifest = json.load(f)
    matched = False
    for asset in manifest["assets"]:
        if os.path.realpath(os.path.join(os.path.dirname(manifest_path),asset["file"])) == os.path.realpath(path):
            with open(path,"rb") as f:
                asset["sha256"] = hashlib.sha256(f.read()).hexdigest()
            asset["bytes"] = size
            asset["generator"] = "tools/blender/infected.py" if infected else "tools/blender/survivors.py"
            matched = True
    if matched:
        with open(manifest_path,"w",encoding="utf8") as f:
            json.dump(manifest,f,indent=2)
            f.write("\n")
