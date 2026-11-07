"""Build only the two native libraries; no precompiled binaries are distributed.

The default compiler is Zig's bundled clang (`python -m ziglang c++`, from
build-requirements.txt), which needs no system compiler, SDK or zlib on any
platform. zlib is compiled in from the vendored sources in wordpred/native/zlib.
Set CXX (and CC for the zlib C files) to use another compiler instead.
"""
import importlib.util
import os
import shlex
import subprocess
import sys
from pathlib import Path

# Kept dependency-free; must match LIBRARY_SUFFIX in wordpred/paths.py.
SUFFIX = {"darwin": ".dylib", "win32": ".dll"}.get(sys.platform, ".so")
ZLIB_SOURCES = ["adler32", "compress", "crc32", "deflate", "gzclose", "gzlib", "gzread", "gzwrite",
                "infback", "inffast", "inflate", "inftrees", "trees", "uncompr", "zutil"]


def compilers():
    """(C++ compiler, C compiler, shared-library flags) for this platform."""
    zig = importlib.util.find_spec("ziglang") is not None
    if "CXX" in os.environ or not zig:
        cxx = shlex.split(os.environ.get("CXX", "g++" if sys.platform == "win32" else "c++"))
        cc = shlex.split(os.environ.get("CC", "gcc" if sys.platform == "win32" else "cc"))
        if sys.platform == "darwin":
            flags = ["-dynamiclib"]
        elif sys.platform == "win32":
            # MinGW-w64 g++. Link its C++ runtime statically so the DLLs load without MinGW on PATH.
            flags = ["-shared", "-static"]
        else:
            flags = ["-shared", "-fPIC"]
        return cxx, cc, flags
    # Zig links its own libc++ statically everywhere, so the libraries have no runtime dependency.
    return [sys.executable, "-m", "ziglang", "c++"], [sys.executable, "-m", "ziglang", "cc"], ["-shared", "-fPIC"]


def run(command):
    print(shlex.join(command), flush=True)
    subprocess.run(command, check=True)


def main():
    root = Path(__file__).resolve().parent
    out = root / "build"
    out.mkdir(exist_ok=True)
    cxx, cc, flags = compilers()
    native = root / "wordpred/native"
    zlib = native / "zlib"
    (out / "zlib").mkdir(exist_ok=True)
    objects = []
    for name in ZLIB_SOURCES:
        obj = out / "zlib" / (name + ".o")
        defines = [] if sys.platform == "win32" else ["-DHAVE_UNISTD_H", "-DHAVE_STDARG_H"]
        run(cc + ["-O3", "-fPIC", "-c", "-I", str(zlib)] + defines + [str(zlib / (name + ".c")), "-o", str(obj)])
        objects.append(str(obj))
    for name, extra in (("arpa_native", ["-I", str(zlib)] + objects), ("assignment", [])):
        run(cxx + ["-std=c++17", "-O3"] + flags + [str(native / (name + ".cpp"))] + extra + ["-o", str(out / (name + SUFFIX))])


if __name__ == "__main__":
    main()
