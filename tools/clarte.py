"""Clarte launcher: provisions each prototype's toolchain into .tools/ and runs it.

Start it through ./clarte (POSIX) or clarte.cmd (Windows); both fetch a pinned uv and
run this file with Python 3.14. Standard library only. Every provisioning step is
idempotent: it writes a stamp next to its result and is skipped while the stamp
matches its inputs, so a half-finished first run is simply resumed by the next one.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".tools"
PROTOTYPES = ROOT / "prototypes"
ENGINE = PROTOTYPES / "Word Prediction" / "v0"
AUTOCOMPLETE = PROTOTYPES / "Autocomplete" / "v0"
UI = PROTOTYPES / "UI" / "v0"
VOICE = PROTOTYPES / "Voice"
EYES = PROTOTYPES / "Eye Tracking"
WINDOWS = sys.platform == "win32"

NODE_VERSION = "24.22.2"
# From https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
NODE_SHA256 = {
    "darwin-arm64": "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a",
    "darwin-x64": "d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52",
    "linux-arm64": "95c264150aceb7f3437a29fd6984924f5f8d1511ea3cbd6c508b83f6c555dae2",
    "linux-x64": "361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9",
    "win-x64": "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2",
}
DEFAULT_REPO = "simplythatguy/clarte"
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
# The README example for both prediction servers; likely[0] / word is "outside".
EXAMPLE = {"history": [["partner", "Did you sleep at all?"], ["user", "Not much. My back hurts"],
                       ["partner", "Do you want to go outside for a bit? It is sunny."]],
           "message": ["i", "would", "love", "to", "go"], "groups": "3443"}


def platform_key():
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64" if machine in {"x86_64", "amd64"} else machine
    system = {"darwin": "darwin", "win32": "win", "linux": "linux"}.get(sys.platform)
    if system is None or arch not in {"arm64", "x64"} or (system == "win" and arch != "x64"):
        sys.exit(f"clarte: unsupported platform {sys.platform} {machine}")
    return f"{system}-{arch}"


PLATFORM = platform_key()
# torch 2.9.1 ships no macOS x86_64 wheel, so Intel Macs run the Light (count model) engine.
ENGINE_MODEL = "light" if PLATFORM == "darwin-x64" else "deployable"


def log(message):
    print(f"clarte: {message}", flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(*parts):
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def stamp_matches(stamp, key):
    return stamp.is_file() and stamp.read_text().strip() == key


def write_stamp(stamp, key):
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(key + "\n")


def run(command, cwd=None, env=None):
    print("+ " + " ".join(str(c) for c in command), flush=True)
    subprocess.run([str(c) for c in command], cwd=cwd, env=env, check=True)


def curl(url, *args, headers=None, stdin=None):
    """curl ships with macOS, Windows 10+ and nearly every Linux, and trusts the OS certificate
    store, which Python's own ssl module does not always do (python.org and standalone builds)."""
    header_args = [a for k, v in (headers or {}).items() for a in ("-H", f"{k}: {v}")]
    return subprocess.run(["curl", "-fsSL", "--retry", "3", "-A", "clarte-launcher", *header_args, *args, url],
                          check=True, capture_output=True, input=stdin).stdout


def download(url, dest, sha256=None, size=None, headers=None):
    """Fetch url to dest atomically (dest.part first) and verify its SHA256 and size."""
    if dest.is_file() and (size is None or dest.stat().st_size == size) and (sha256 is None or sha256_file(dest) == sha256):
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    log(f"downloading {url.split('?')[0]}" + (f" ({size / 1e6:.0f} MB)" if size else ""))
    curl(url, "-o", str(part), headers=headers)
    if size is not None and part.stat().st_size != size:
        part.unlink()
        raise RuntimeError(f"{url}: expected {size} bytes, got a different size")
    if sha256 is not None and (got := sha256_file(part)) != sha256:
        part.unlink()
        raise RuntimeError(f"{url}: SHA256 {got} does not match the pinned {sha256}")
    part.replace(dest)


def load_dotenv(path):
    values = {}
    if not path.is_file():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip().removeprefix("export ").strip()] = value.strip().strip("'\"")
    return values


# ---------------------------------------------------------------- toolchains

def uv():
    path = os.environ.get("CLARTE_UV") or shutil.which("uv")
    if not path:
        sys.exit("clarte: uv not found; start through ./clarte or clarte.cmd")
    return path


def venv_python(venv):
    return venv / ("Scripts/python.exe" if WINDOWS else "bin/python")


def ensure_venv(venv, python_version, requirements, extra=()):
    """Create venv with uv and install the requirement files into it; keyed on their contents.
    The venv is recreated whenever the key changes, so the installed set is exactly the files'."""
    key = sha256_text(uv_version(), python_version, *[p.read_text() for p in requirements], *extra, PLATFORM)
    stamp = venv / ".clarte-stamp"
    if stamp_matches(stamp, key) and venv_python(venv).is_file():
        return
    log(f"installing Python {python_version} environment at {venv.relative_to(ROOT)}")
    run([uv(), "venv", "--clear", "--python", python_version, venv])
    run([uv(), "pip", "install", "--python", venv_python(venv), *[a for r in requirements for a in ("-r", r)], *extra])
    write_stamp(stamp, key)


_uv_version = None


def uv_version():
    global _uv_version
    if _uv_version is None:
        _uv_version = subprocess.run([uv(), "--version"], capture_output=True, text=True, check=True).stdout.strip()
    return _uv_version


def ensure_node():
    """Pinned Node from nodejs.org, verified against SHASUMS256.txt; returns its directory."""
    name = f"node-v{NODE_VERSION}-{PLATFORM}"
    home = TOOLS / "node" / name
    if (home / ".clarte-ok").is_file():
        return home
    archive = TOOLS / "node" / (name + (".zip" if WINDOWS else ".tar.gz"))
    download(f"https://nodejs.org/dist/v{NODE_VERSION}/{archive.name}", archive, NODE_SHA256[PLATFORM])
    log(f"extracting {archive.name}")
    shutil.rmtree(home, ignore_errors=True)
    if WINDOWS:
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(TOOLS / "node")
    else:
        with tarfile.open(archive) as tf:
            tf.extractall(TOOLS / "node", filter="data")
    archive.unlink()
    (home / ".clarte-ok").write_text(NODE_VERSION + "\n")
    return home


def node_bin_dir(home):
    return home if WINDOWS else home / "bin"


def node_exe(home):
    return node_bin_dir(home) / ("node.exe" if WINDOWS else "node")


def npm_cli(home):
    return home / ("node_modules" if WINDOWS else "lib/node_modules") / "npm" / "bin" / "npm-cli.js"


def ensure_npm_ci(package_dir, env):
    """npm ci when node_modules is missing or package-lock.json changed. Lifecycle scripts are
    skipped as the prototype READMEs do; the native binaries arrive as optional dependencies."""
    lock = package_dir / "package-lock.json"
    key = sha256_text(NODE_VERSION, sha256_file(lock))
    stamp = package_dir / "node_modules" / ".clarte-stamp"
    if stamp_matches(stamp, key):
        return
    home = ensure_node()
    log(f"npm ci in {package_dir.relative_to(ROOT)}")
    run([node_exe(home), npm_cli(home), "ci", "--ignore-scripts"], cwd=package_dir, env=env)
    write_stamp(stamp, key)


# ---------------------------------------------------------------- engine (Word Prediction)

def origin_repo():
    try:
        url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return DEFAULT_REPO
    tail = url.replace(":", "/").rstrip("/").removesuffix(".git").split("/")
    return "/".join(tail[-2:]) if len(tail) >= 2 and "github.com" in url else DEFAULT_REPO


def lfs_pointer(path):
    """(oid, size) when path is a Git LFS pointer file, else None."""
    if path.stat().st_size > 1024:
        return None
    data = path.read_bytes()
    if not data.startswith(LFS_POINTER_PREFIX):
        return None
    fields = dict(line.split(" ", 1) for line in data.decode().splitlines() if " " in line)
    return fields["oid"].removeprefix("sha256:"), int(fields["size"])


def fetch_lfs_objects(pointers):
    """Download LFS objects through GitHub's batch API (public repo, no auth) into .tools/lfs."""
    store = TOOLS / "lfs"
    missing = [(oid, size) for oid, size in pointers if not ((store / oid).is_file() and (store / oid).stat().st_size == size)]
    if not missing:
        return store
    repo = origin_repo()
    log(f"fetching {len(missing)} Git LFS object(s) from {repo} ({sum(s for _, s in missing) / 1e6:.0f} MB)")
    body = json.dumps({"operation": "download", "transfers": ["basic"],
                       "objects": [{"oid": oid, "size": size} for oid, size in missing]}).encode()
    batch = json.loads(curl(f"https://github.com/{repo}.git/info/lfs/objects/batch", "-X", "POST", "--data-binary", "@-",
                            headers={"Accept": "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json"},
                            stdin=body))
    for obj in batch["objects"]:
        if "error" in obj or "download" not in obj.get("actions", {}):
            raise RuntimeError(f"LFS object {obj['oid'][:10]} unavailable: {obj.get('error')}")
        action = obj["actions"]["download"]
        download(action["href"], store / obj["oid"], sha256=obj["oid"], size=obj["size"], headers=action.get("header"))
    return store


def link_or_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def ensure_models():
    """A complete model folder: models/ itself when its files are real, else a mirror in
    .tools/models whose LFS pointers are replaced by the fetched objects."""
    source = ENGINE / "models"
    files = sorted(p for p in source.rglob("*") if p.is_file())
    pointers = {p: lfs_pointer(p) for p in files}
    if not any(pointers.values()):
        return None
    mirror = TOOLS / "models"
    key = sha256_text(*[f"{p.relative_to(source)} {ptr[0] if ptr else p.stat().st_size}" for p, ptr in pointers.items()])
    stamp = mirror / ".clarte-stamp"
    if stamp_matches(stamp, key):
        return mirror
    store = fetch_lfs_objects([ptr for ptr in pointers.values() if ptr])
    log("assembling model folder in .tools/models")
    shutil.rmtree(mirror, ignore_errors=True)
    for path, ptr in pointers.items():
        link_or_copy(store / ptr[0] if ptr else path, mirror / path.relative_to(source))
    write_stamp(stamp, key)
    return mirror


def ensure_engine_venv():
    requirements = ENGINE / ("requirements-light.txt" if ENGINE_MODEL == "light" else "requirements.txt")
    extra = ["--torch-backend", "cpu"] if sys.platform == "linux" else []
    ensure_venv(ENGINE / ".venv", "3.14", [requirements, ENGINE / "build-requirements.txt"], extra)


def ensure_native(env):
    """build.py (Zig + vendored zlib) when the libraries are missing or their inputs changed."""
    native = ENGINE / "wordpred" / "native"
    inputs = [ENGINE / "build.py", ENGINE / "build-requirements.txt", *sorted(native.glob("*.cpp")), *sorted((native / "zlib").iterdir())]
    key = sha256_text(PLATFORM, *[sha256_file(p) for p in inputs])
    build = ENGINE / "build"
    suffix = {"darwin": ".dylib", "win32": ".dll"}.get(sys.platform, ".so")
    stamp = build / ".clarte-stamp"
    if stamp_matches(stamp, key) and all((build / (n + suffix)).is_file() for n in ("arpa_native", "assignment")):
        return
    log("building native libraries with Zig")
    run([venv_python(ENGINE / ".venv"), "build.py"], cwd=ENGINE, env=env)
    write_stamp(stamp, key)


def provision_engine(env):
    models = ensure_models()
    if models:
        env["WORDPRED_MODELS"] = str(models)
    ensure_engine_venv()
    ensure_native(env)


def provision_voice(env):
    extra = ["--overrides", str(VOICE / "server" / "overrides.txt")] + (["--torch-backend", "cpu"] if sys.platform == "linux" else [])
    ensure_venv(VOICE / "server" / ".venv", "3.11", [VOICE / "server" / "requirements.txt"], extra)
    ensure_npm_ci(VOICE, env)


def provision_ui(env):
    provision_engine(env)
    for n in range(1, 6):
        ensure_npm_ci(UI / f"s{n}", env)


def provision_eyes(env):
    ensure_npm_ci(EYES, env)


# ---------------------------------------------------------------- processes

class Proc:
    def __init__(self, name, command, cwd, env, log_dir):
        self.name = name
        self.log = None
        stdout = None
        if log_dir:
            log_dir.mkdir(parents=True, exist_ok=True)
            self.log = log_dir / f"{name}.log"
            stdout = open(self.log, "wb")
        print(f"+ [{name}] " + " ".join(str(c) for c in command), flush=True)
        kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {"start_new_session": True}
        self.out = stdout
        self.popen = subprocess.Popen([str(c) for c in command], cwd=cwd, env=env, stdout=stdout, stderr=subprocess.STDOUT if stdout else None, **kwargs)

    def alive(self):
        return self.popen.poll() is None

    def stop(self):
        if self.alive():
            if WINDOWS:
                subprocess.run(["taskkill", "/pid", str(self.popen.pid), "/t", "/f"], capture_output=True)
            else:
                try:
                    os.killpg(self.popen.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    self.popen.wait(5)
                except subprocess.TimeoutExpired:
                    os.killpg(self.popen.pid, signal.SIGKILL)
        self.popen.wait()
        if self.out:
            self.out.close()

    def tail(self, lines=40):
        if not self.log or not self.log.is_file():
            return ""
        return "\n".join(self.log.read_text(errors="replace").splitlines()[-lines:])


def port_free(port):
    """True when nothing accepts on either loopback address (Vite binds "localhost", often ::1)."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family) as s:
                s.settimeout(0.5)
                if s.connect_ex((host, port)) == 0:
                    return False
        except OSError:
            pass
    return True


def pick_port(preferred, count=1):
    """preferred (and the count-1 ports after it) when free, else the next such run of ports."""
    port = preferred
    while not all(port_free(p) for p in range(port, port + count)):
        port += count
    if port != preferred:
        log(f"port {preferred} is in use; using {port} instead")
    return port


def wait_ports(procs, ports, timeout):
    deadline = time.monotonic() + timeout
    pending = set(ports)
    while pending:
        pending = {p for p in pending if port_free(p)}
        if not pending:
            return
        dead = [p for p in procs if not p.alive()]
        if dead:
            raise RuntimeError(f"{dead[0].name} exited with status {dead[0].popen.returncode}")
        if time.monotonic() > deadline:
            raise RuntimeError(f"ports {sorted(pending)} did not open within {timeout}s")
        time.sleep(0.5)


def http(url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def expect_200(url, attempts=20):
    for attempt in range(attempts):
        try:
            status, _ = http(url)
            if status == 200:
                return
            last = f"status {status}"
        except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
            last = str(error)
        time.sleep(1)
    raise RuntimeError(f"GET {url}: {last}")


def expect_json(url, body, field, value, extract=lambda v: v):
    status, data = http(url, body)
    try:
        got = extract(json.loads(data)[field])
    except (ValueError, KeyError, IndexError, TypeError):
        raise RuntimeError(f"POST {url}: status {status}, body {data[:200]!r}") from None
    if status != 200 or got != value:
        raise RuntimeError(f"POST {url}: status {status}, {field}={got!r}, expected {value!r}")
    log(f"POST {url} -> {field} {got!r}")


def expect_model(proc, model):
    if proc.log and f"model: {model}" not in proc.log.read_text(errors="replace"):
        raise RuntimeError(f"{proc.name} did not report 'model: {model}':\n{proc.tail(10)}")


# ---------------------------------------------------------------- apps

def engine_command(env, port):
    command = [venv_python(ENGINE / ".venv"), "server.py", "--port", port]
    return command + (["--model", "light"] if ENGINE_MODEL == "light" else [])


def start_engine(env, log_dir, procs):
    port = pick_port(8765)
    procs.append(Proc("engine", engine_command(env, port), ENGINE, env, log_dir))
    return port


def start_predict(env, log_dir, procs):
    port = start_engine(env, log_dir, procs)
    return [port], [f"http://127.0.0.1:{port}/"], lambda: (expect_json(f"http://127.0.0.1:{port}/api/predict", EXAMPLE, "likely", "outside", lambda v: v[0]), expect_model(procs[0], ENGINE_MODEL))


def start_autocomplete(env, log_dir, procs):
    port = pick_port(8766)
    command = [venv_python(ENGINE / ".venv"), "server.py", "--port", port] + (["--model", "light"] if ENGINE_MODEL == "light" else [])
    procs.append(Proc("autocomplete", command, AUTOCOMPLETE, env, log_dir))
    return [port], [f"http://127.0.0.1:{port}/"], lambda: (expect_json(f"http://127.0.0.1:{port}/api/complete", EXAMPLE, "word", "outside"), expect_model(procs[0], ENGINE_MODEL))


def start_ui(env, log_dir, procs):
    base = pick_port(5100, count=6)  # switcher, then s1-s5 on the five ports after it
    ports = list(range(base, base + 6))
    engine_port = start_engine(env, log_dir, procs)
    if engine_port != 8765:
        log("S0 talks to whatever is on 8765; the engine started here is on another port")
    # serve.mjs starts its own engine on 8765 unless one is already listening, and ours takes a
    # minute or more to load, so let it bind first.
    wait_ports(procs, [engine_port], READY_TIMEOUT)
    procs.append(Proc("ui", [node_exe(ensure_node()), UI / "s_all" / "serve.mjs"], UI / "s_all", dict(env, PORT=str(base)), log_dir))

    def smoke():
        expect_200(f"http://127.0.0.1:{base}/")
        for port in ports[1:]:
            expect_200(f"http://localhost:{port}/")
        expect_json(f"http://127.0.0.1:{engine_port}/api/predict", EXAMPLE, "likely", "outside", lambda v: v[0])
    return ports + [engine_port], [f"http://localhost:{base}"], smoke


def start_voice(env, log_dir, procs):
    page, service = pick_port(4321), pick_port(4322)
    service_env = dict(env, TQDM_DISABLE="1", CLARTE_VOICE_PORT=str(service),
                       CLARTE_VOICE_ORIGINS=f"http://localhost:{page},http://127.0.0.1:{page}")
    procs.append(Proc("voice-service", [venv_python(VOICE / "server" / ".venv"), "-m", "clarte_voice"], VOICE / "server", service_env, log_dir))
    home = ensure_node()
    page_env = dict(env, VITE_CLARTE_VOICE_URL=f"http://localhost:{service}")
    procs.append(Proc("voice-page", [node_exe(home), npm_cli(home), "run", "dev", "--", "--port", page], VOICE, page_env, log_dir))

    def smoke():
        expect_200(f"http://localhost:{page}/")
        status, data = http(f"http://127.0.0.1:{service}/health")
        health = json.loads(data)
        if status != 200 or health.get("ok") is not True:
            raise RuntimeError(f"voice /health: status {status}, {health}")
        log(f"GET /health -> ok, keyConfigured={health.get('keyConfigured')}")
    return [page, service], [f"http://localhost:{page}"], smoke


def start_eyes(env, log_dir, procs):
    port = pick_port(4318)
    home = ensure_node()
    procs.append(Proc("eyes", [node_exe(home), npm_cli(home), "run", "dev", "--", "--port", port], EYES, env, log_dir))
    return [port], [f"http://localhost:{port}"], lambda: expect_200(f"http://localhost:{port}/")


# name -> (description, provision, start). start returns (ports to wait for, URLs, smoke test).
APPS = {
    "ui": ("UI v0 switcher with S0-S5 and the prediction engine", provision_ui, start_ui),
    "predict": ("Word Prediction engine and its test page", provision_engine, start_predict),
    "autocomplete": ("Autocomplete server and its test page", provision_engine, start_autocomplete),
    "voice": ("Voice cloning page and service (needs ELEVENLABS_API_KEY in .env)", provision_voice, start_voice),
    "eyes": ("Eye Tracking calibration app", provision_eyes, start_eyes),
}
READY_TIMEOUT = 600


def base_env():
    """The children's environment: .env values, the pinned Node first on PATH."""
    env = dict(os.environ)
    env.update({k: v for k, v in load_dotenv(ROOT / ".env").items() if k not in env})
    node = node_bin_dir(TOOLS / "node" / f"node-v{NODE_VERSION}-{PLATFORM}")
    env["PATH"] = str(node) + os.pathsep + env.get("PATH", "")
    env.setdefault("npm_config_cache", str(TOOLS / "npm-cache"))
    return env


def launch(name, check):
    description, provision, start = APPS[name]
    log(f"{name}: {description}")
    env = base_env()
    started = time.monotonic()
    provision(env)
    log(f"{name}: ready to start ({time.monotonic() - started:.0f}s provisioning)")
    procs = []
    try:
        ports, urls, smoke = start(env, TOOLS / "logs" if check else None, procs)
        wait_ports(procs, ports, READY_TIMEOUT)
        if check:
            smoke()
            log(f"{name}: OK in {time.monotonic() - started:.0f}s")
            return
        for url in urls:
            log(f"{name}: {url}")
        webbrowser.open(urls[0])
        log("press Ctrl+C to stop")
        while all(p.alive() for p in procs):
            time.sleep(1)
        dead = next(p for p in procs if not p.alive())
        raise RuntimeError(f"{dead.name} exited with status {dead.popen.returncode}")
    except Exception:
        for proc in procs:
            if proc.log:
                print(f"--- {proc.name} log tail ---\n{proc.tail()}", flush=True)
        raise
    finally:
        for proc in reversed(procs):
            proc.stop()


def check():
    results = {}
    started = time.monotonic()
    for name in APPS:
        try:
            launch(name, check=True)
            results[name] = "OK"
        except Exception as error:  # report every app, then fail
            results[name] = f"FAIL: {error}"
            log(f"{name}: {results[name]}")
    print(f"\nclarte check ({PLATFORM}, engine model {ENGINE_MODEL}, {time.monotonic() - started:.0f}s):")
    for name, result in results.items():
        print(f"  {name:13} {result}")
    sys.exit(0 if all(r == "OK" for r in results.values()) else 1)


def usage():
    print("usage: clarte <app> | clarte check\n\napps:")
    for name, (description, _, _) in APPS.items():
        print(f"  {name:13} {description}")
    print("\n  check         provision every app, start it, smoke-test it and stop it (no browser)")
    print("\nThe first run downloads Node, Python, the models and dependencies into .tools/ and the\n"
          "prototypes' own .venv/node_modules folders; later runs start right away.")


def main(argv):
    # Keep every cache repo-local so a clone is self-contained and CI can cache .tools as a unit.
    for key, value in (("UV_CACHE_DIR", TOOLS / "uv-cache"), ("UV_PYTHON_INSTALL_DIR", TOOLS / "python"),
                       ("ZIG_GLOBAL_CACHE_DIR", TOOLS / "zig-cache"), ("ZIG_LOCAL_CACHE_DIR", TOOLS / "zig-cache" / "local")):
        os.environ.setdefault(key, str(value))
    if not argv or argv[0] in {"-h", "--help", "help"}:
        usage()
        sys.exit(0)
    if len(argv) != 1:
        usage()
        sys.exit(2)
    if argv[0] == "check":
        check()
    elif argv[0] in APPS:
        try:
            launch(argv[0], check=False)
        except KeyboardInterrupt:
            log("stopped")
    else:
        usage()
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
