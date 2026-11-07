"""Build only the two native libraries; no precompiled binaries are distributed."""
import os
import shlex
import subprocess
import sys
from pathlib import Path

# Kept dependency-free; must match LIBRARY_SUFFIX in wordpred/paths.py.
SUFFIX = {"darwin": ".dylib", "win32": ".dll"}.get(sys.platform, ".so")


def main():
    root = Path(__file__).resolve().parent
    out = root / "build"
    out.mkdir(exist_ok=True)
    if sys.platform == "darwin":
        flags = ["-dynamiclib"]
    elif sys.platform == "win32":
        # MinGW-w64 g++. Link its C++ runtime and zlib statically so the DLLs load without MinGW on PATH.
        flags = ["-shared", "-static"]
    else:
        flags = ["-shared", "-fPIC"]
    compiler = shlex.split(os.environ.get("CXX", "g++" if sys.platform == "win32" else "c++"))
    for name, libs in (("arpa_native", ["-lz"]), ("assignment", [])):
        command = compiler + ["-std=c++17", "-O3"] + flags + [str(root / "wordpred/native" / (name + ".cpp"))] + libs + ["-o", str(out / (name + SUFFIX))]
        print(shlex.join(command), flush=True)
        subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
