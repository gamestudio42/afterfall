"""Renders character poses for review.

blender --background --factory-startup --python tools/blender/characters_preview.py -- <out.png> [set]

Sets: stand (default), walk, run, infected, actions.
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(__file__))
from characters import preview

args = sys.argv[sys.argv.index("--") + 1 :]
which = args[1] if len(args) > 1 else "stand"
SETS = {
    "stand": [(False, ["stand", "breath", "shift", "aim"]), (True, ["stand", "breath", "shift", "strike"])],
    "walk": [(False, [f"walk{i}" for i in range(8)])],
    "run": [(False, [f"run{i}" for i in range(0, 12, 2)])],
    "infected": [(True, [f"walk{i}" for i in range(8)]), (True, [f"run{i}" for i in range(0, 12, 2)])],
    "actions": [(False, ["windup", "strike", "aim", "hit"]), (True, ["windup", "strike", "hit", "shift"])],
}
preview(args[0], SETS[which])
