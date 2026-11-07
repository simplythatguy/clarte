"""Build only the two native libraries; no precompiled binaries are distributed."""
import os
import shlex
import subprocess
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    out = root / "build"
    out.mkdir(exist_ok=True)
    suffix = ".dylib" if sys.platform == "darwin" else ".so"
    flags = ["-dynamiclib"] if sys.platform == "darwin" else ["-shared", "-fPIC"]
    compiler = shlex.split(os.environ.get("CXX", "c++"))
    for name, libs in (("arpa_native", ["-lz"]), ("assignment", [])):
        command = compiler + ["-std=c++17", "-O3"] + flags + [str(root / "wordpred/native" / (name + ".cpp"))] + libs + ["-o", str(out / (name + suffix))]
        print(shlex.join(command), flush=True)
        subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
