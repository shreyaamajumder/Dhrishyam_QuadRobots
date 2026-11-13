"""Versioned prompt files (TRD Section 10).

Each prompt is a file named <name>.v<number>.md. load_prompt returns the highest version,
and its label (for example "orchestrator.v1") is saved with every run as prompt_version.
To change a prompt, add a new version file rather than editing an old one, so past runs
can still be explained.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

PROMPT_DIR = Path(__file__).resolve().parent
_FILE = re.compile(r"^(?P<name>[a-z_]+)\.v(?P<version>\d+)\.md$")


class Prompt(NamedTuple):
    text: str
    version: str


@lru_cache(maxsize=None)
def load_prompt(name: str) -> Prompt:
    versions = []
    for path in PROMPT_DIR.iterdir():
        match = _FILE.match(path.name)
        if match and match.group("name") == name:
            versions.append((int(match.group("version")), path))
    if not versions:
        raise FileNotFoundError(f"No prompt file named {name}.v<number>.md in {PROMPT_DIR}")
    number, path = max(versions)
    return Prompt(text=path.read_text(encoding="utf-8").strip(), version=f"{name}.v{number}")
