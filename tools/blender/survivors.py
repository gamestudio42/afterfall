"""Generate the survivor with continuous walk, breathing, melee and aiming morphs.

blender --background --factory-startup --python tools/blender/survivors.py -- <out_dir>
"""
import os
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(__file__))
from characters import generate

generate(False, sys.argv[sys.argv.index("--")+1] if "--" in sys.argv else "apps/web/public/art/survivors")
