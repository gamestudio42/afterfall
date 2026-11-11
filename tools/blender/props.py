"""Author the abandoned street kit. Blender Z-up, metres, deterministic palettes.
Run: blender --background --factory-startup --python tools/blender/props.py
"""
import math
import os
import sys
import bpy
sys.path.insert(0, os.path.dirname(__file__))
from propkit import reset, mat, box, cyl, cone, beam, mesh, loft, join, export

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "apps/web/public/art/props"
os.makedirs(OUT, exist_ok=True)


def wheel(x, y, z, rubber, steel, radius=.34):
    cyl(radius, .23, (x,y,z), rot=(0,math.pi/2,0), verts=16, material=rubber)
    side = 1 if x > 0 else -1
    cyl(radius*.57, .025, (x+side*.124,y,z), rot=(0,math.pi/2,0), verts=12, material=steel)
    cyl(radius*.22, .035, (x+side*.14,y,z), rot=(0,math.pi/2,0), verts=8, material=rubber)


def car():
    reset()
    paint = mat("Car paint", (.52,.54,.55), category="paint")
    glass = mat("Dusty glass", (.055,.085,.095), category="glass")
    rubber = mat("Rubber", (.025,.029,.028))
    steel = mat("Oxidised trim", (.27,.29,.28))
    rust = mat("Flaked paint", (.19,.10,.055))
    lamp = mat("Headlamp", (.72,.68,.49))
    red = mat("Taillamp", (.27,.045,.025))
    loft([(-2.1,.79,.35,.68),(-1.72,.9,.32,.84),(.95,.9,.32,.84),(1.95,.84,.38,.74),(2.12,.76,.42,.65)], paint)
    loft([(-1.25,.78,.82,.88),(-.68,.77,.82,1.42),(.57,.75,.82,1.44),(1.18,.79,.82,.9)], glass)
    box((1.46,1.3,.08),(0,-.05,1.46),material=paint,bevel=.035)
    for side in (-1,1):
        for a,b in [((side*.77,-1.25,.87),(side*.72,-.68,1.46)),((side*.72,.57,1.46),(side*.79,1.18,.87)),((side*.77,-.05,.85),(side*.72,-.05,1.46))]:
            beam(a,b,.055,paint)
        box((.07,2.25,.07),(side*.87,-.05,.82),material=steel)
        for y in (-.77,.38):
            box((.026,.26,.045),(side*.9,y,.76),material=steel,bevel=0)
        box((.027,1.5,.055),(side*.905,-.2,.38),material=rust,bevel=0)
        box((.12,.27,.11),(side*.92,.7,1.03),material=paint)
        for y in (-1.36,1.32):
            wheel(side*.87,y,.34,rubber,steel)
        box((.43,.08,.19),(side*.52,2.08,.61),material=lamp)
        box((.37,.06,.14),(side*.52,-2.10,.61),material=red)
    for y in (-2.13,2.15):
        box((1.54,.1,.13),(0,y,.43),material=steel)
        box((.38,.012,.14),(0,y*1.025,.58),material=lamp,bevel=0)
    for x in (-.3,-.15,0,.15,.3):
        box((.07,.04,.14),(x,2.14,.68),material=rubber,bevel=0)
    # Hood seam, wipers and a small rust scar remain readable at close zoom.
    beam((-.61,1.13,.9),(.1,1.15,.94),.022,steel)
    beam((.12,1.12,.91),(.64,1.15,.94),.022,steel)
    box((.36,.48,.008),(-.47,1.61,.795),rot=(0,.06,.12),material=rust,bevel=0)


def ambulance():
    reset()
    paint = mat("Ivory ambulance", (.62,.61,.52), category="paint")
    glass = mat("Cab glass", (.045,.08,.095), category="glass")
    dark = mat("Tyres and seals", (.025,.03,.03))
    metal = mat("Trim", (.27,.29,.28))
    stripe = mat("Emergency stripe", (.49,.12,.055))
    blue = mat("Emergency blue", (.04,.17,.3))
    box((2.05,3.45,1.8),(0,-.65,1.38),material=paint,bevel=.07)
    loft([(.83,.99,.35,1.83),(1.65,.88,.35,1.82),(2.53,.83,.35,.89)],paint)
    mesh("Windscreen",[(-.78,1.72,1.78),(.78,1.72,1.78),(.76,2.29,1.13),(-.76,2.29,1.13)],[(0,1,2,3)],glass)
    for side in (-1,1):
        box((.025,3.35,.2),(side*1.035,-.65,1.12),material=stripe,bevel=0)
        box((.025,.68,.55),(side*.965,1.14,1.45),material=glass)
        box((.04,.8,.08),(side*1.045,-.4,1.78),material=blue)
        box((.04,.08,.8),(side*1.045,-.4,1.78),material=blue)
        for y in (-1.66,1.73):
            wheel(side*1.0,y,.36,dark,metal,.36)
        box((.45,.09,.18),(side*.53,2.5,.73),material=paint)
        box((.12,.04,.4),(side*.88,-2.41,1.05),material=stripe)
        box((.14,.35,.14),(side*1.03,1.65,1.43),material=metal)
    box((1.8,.14,.17),(0,2.54,.44),material=metal)
    box((1.12,.3,.13),(0,1.05,1.96),material=metal)
    for x in (-.36,.36):
        box((.46,.24,.16),(x,1.05,2.07),material=blue if x > 0 else stripe)
    for x in (-.49,.49):
        box((.93,.025,1.55),(x,-2.39,1.41),material=paint)
        box((.65,.028,.45),(x,-2.41,1.86),material=glass)
        box((.05,.05,.19),(x*.3,-2.44,1.23),material=metal)


def dumpster():
    reset()
    green = mat("Paint", (.11,.22,.16))
    rim = mat("Worn rims", (.22,.25,.19))
    rust = mat("Rust", (.22,.11,.055))
    black = mat("Interior", (.025,.035,.03))
    box((2.2,1.3,.14),(0,0,.22),material=black)
    for y in (-.63,.63):
        box((2.2,.09,1.0),(0,y,.74),material=green)
        box((2.23,.12,.08),(0,y,1.23),material=rim)
        for x in (-.7,0,.7):
            box((.07,.03,.78),(x,y*1.085,.72),material=rim,bevel=0)
    for x in (-1.06,1.06):
        box((.1,1.3,1.0),(x,0,.74),material=green)
        box((.17,.42,.07),(x,0,.94),material=rust)
    box((2.24,1.36,.09),(0,-.12,1.37),rot=(.2,0,0),material=green)
    for x in (-.8,-.4,0,.4,.8):
        box((.06,1.21,.04),(x,-.12,1.44),rot=(.2,0,0),material=rim,bevel=0)
    for x in (-.82,.82):
        for y in (-.44,.44):
            cyl(.13,.12,(x,y,.13),rot=(0,math.pi/2,0),verts=8,material=black)
    box((.42,.012,.19),(-.52,-.689,.91),material=rust,bevel=0)


def fence():
    reset()
    timber = mat("Weathered timber", (.26,.21,.14))
    pale = mat("Exposed grain", (.39,.33,.22))
    metal = mat("Nails", (.1,.11,.1))
    for x in (-1,1):
        box((.15,.16,1.4),(x,0,.7),material=timber)
    for z in (.35,.97):
        box((2.12,.09,.12),(0,0,z),material=timber)
    for i in range(7):
        x=-.9+i*.3
        height=1.15 if i != 4 else .77
        box((.19,.075,height),(x,-.09,height/2+.07),rot=(0,.035*(i%3-1),0),material=pale if i%3 else timber)
        for z in (.35,.97):
            if z < height:
                cyl(.019,.012,(x,-.134,z),rot=(math.pi/2,0,0),verts=6,material=metal)


def sign():
    reset()
    metal=mat("Steel",(.24,.27,.26))
    green=mat("Faded sign",(.10,.23,.19))
    cream=mat("Paint",(.59,.60,.47))
    cyl(.055,2.5,(0,0,1.25),verts=8,material=metal)
    box((1.22,.07,.5),(0,0,2.13),material=green)
    box((1.3,.04,.06),(0,-.045,2.39),material=cream)
    # Directional chevron instead of unreadable decorative text.
    for side in (-1,1):
        beam((-.15,side*.049,2.13),(.34,side*.049,2.13),.055,cream)
        beam((.17,side*.049,2.29),(.35,side*.049,2.13),.055,cream)
        beam((.17,side*.049,1.97),(.35,side*.049,2.13),.055,cream)
    box((.35,.35,.13),(0,0,.065),material=metal)


def lamp():
    reset()
    steel=mat("Galvanised pole",(.23,.26,.25))
    dark=mat("Housing",(.11,.14,.14))
    glow=mat("Lens",(.82,.72,.46))
    base=mat("Concrete foot",(.31,.3,.25))
    box((.42,.42,.22),(0,0,.11),material=base)
    cone(.11,.065,5.25,(0,0,2.77),material=steel)
    beam((0,0,5.35),(.45,0,5.53),.09,steel)
    beam((.45,0,5.53),(1.05,0,5.53),.09,steel)
    box((.64,.29,.14),(.99,0,5.42),material=dark,bevel=.035)
    box((.49,.23,.026),(1.01,0,5.34),material=glow)
    box((.14,.035,.45),(0,-.095,.78),material=dark)


def barrier():
    reset()
    concrete=mat("Concrete",(.39,.38,.32))
    ochre=mat("Warning paint",(.55,.39,.12))
    dark=mat("Dark warning",(.055,.06,.055))
    profile=[(-.32,0),(.32,0),(.32,.14),(.12,.57),(.12,.85),(-.12,.85),(-.12,.57),(-.32,.14)]
    vertices=[(x,y,z) for x in (-1,1) for y,z in profile]
    faces=[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    mesh("Jersey profile",vertices,faces,concrete)
    for side in (-1,1):
        box((1.9,.012,.23),(0,side*.127,.71),material=ochre,bevel=0)
        for i in range(6):
            x=-.84+i*.29
            mesh("Hazard slash",[(x,side*.136,.6),(x+.13,side*.136,.6),(x+.26,side*.136,.82),(x+.13,side*.136,.82)],[(0,1,2,3) if side < 0 else (3,2,1,0)],dark)
    for x in (-.6,.6):
        box((.24,.08,.055),(x,0,.87),material=dark)


def container():
    reset()
    paint=mat("Container paint",(.47,.45,.39),category="paint")
    rust=mat("Edges",(.22,.12,.065))
    steel=mat("Door fittings",(.37,.38,.33))
    box((2.42,6.04,2.5),(0,0,1.31),material=paint,bevel=.04)
    for i in range(17):
        y=-2.83+i*.35
        for side in (-1,1):
            box((.06,.09,2.26),(side*1.23,y,1.31),material=paint,bevel=0)
        box((2.32,.09,.045),(0,y,2.58),material=paint,bevel=0)
    for x in (-1.15,1.15):
        for y in (-2.98,2.98):
            box((.17,.17,2.6),(x,y,1.3),material=rust)
    for x in (-.6,.6):
        box((1.14,.06,2.35),(x,3.055,1.32),material=paint)
        for dx in (-.34,.34):
            cyl(.035,2.15,(x+dx,3.11,1.32),verts=6,material=steel)
        box((.42,.06,.045),(x,3.17,1.1),material=steel)
    box((.62,.012,.22),(-.4,-3.04,1.9),material=steel,bevel=0)


def crates():
    reset()
    timber=mat("Wood",(.32,.23,.13))
    pale=mat("Boards",(.45,.34,.21))
    iron=mat("Straps",(.13,.15,.12))
    for y in (-.43,0,.43):
        box((1.35,.12,.12),(0,y,.06),material=timber)
    for y in (-.48,-.24,0,.24,.48):
        box((1.35,.15,.045),(0,y,.14),material=pale)
    for x,y,z,w,d,h in [(-.33,-.12,.45,.62,.68,.56),(.35,.15,.43,.57,.54,.52),(-.1,-.02,.95,.61,.5,.43)]:
        box((w,d,h),(x,y,z),material=timber)
        for k in (-1,0,1):
            box((w-.03,d+.016,.04),(x,y,z+k*h*.29),material=pale,bevel=0)
        for sx in (-1,1):
            box((.055,d+.025,h+.025),(x+sx*w*.34,y,z),material=iron,bevel=0)


for name, build in dict(car=car, ambulance=ambulance, dumpster=dumpster, fence=fence,
                        sign=sign, lamp=lamp, barrier=barrier, container=container, crates=crates).items():
    build()
    export(name, join(name), OUT)
