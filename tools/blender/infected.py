"""Generate the infected with a grounded asymmetric gait and lunging attack.

blender --background --factory-startup --python tools/blender/infected.py -- <out_dir>
"""
import os
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(__file__))
from characters import generate

generate(True, sys.argv[sys.argv.index("--")+1] if "--" in sys.argv else "apps/web/public/art/infected")
