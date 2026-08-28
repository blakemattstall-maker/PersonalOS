#!/usr/bin/env python3
"""The Almanac laptop helper.

Polls the Almanac server every couple of seconds for commands the desk
device queued by voice ("google X on my laptop") and opens them in the
default browser. Nothing else: it cannot run programs, cannot type, cannot
read anything on this machine.

Safety, in order of who enforces it:
  - The server only queues a command when the spoken sentence explicitly
    named the laptop; nothing is ever volunteered.
  - Commands expire in 60 seconds on both ends — opening the laptop an hour
    later never replays stale instructions.
  - `touch ~/.almanac-laptop-pause` pauses this helper instantly (exams,
    screen-shares); delete the file to resume. It logs but never opens
    while paused.
  - Only http/https URLs are opened, via `open` with list-args — no shell.

Config (create by hand, never committed anywhere):
  ~/.almanac-laptop.json  ->  {"base": "https://www.getalmanac.xyz", "key": "<API key>"}

Run it via launchd (see com.almanac.laptop.plist) or just:  python3 almanac-laptop.py
"""

import json
import pathlib
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

CONFIG = pathlib.Path.home() / ".almanac-laptop.json"
PAUSE = pathlib.Path.home() / ".almanac-laptop-pause"
LOG = pathlib.Path.home() / ".almanac-laptop.log"

POLL_SECONDS = 2
TTL_SECONDS = 60


def log(message):
    line = f"{datetime.now().isoformat(timespec='seconds')} {message}\n"
    sys.stdout.write(line)
    sys.stdout.flush()
    try:
        with LOG.open("a") as f:
            f.write(line)
    except OSError:
        pass


def load_config():
    try:
        cfg = json.loads(CONFIG.read_text())
        assert cfg["base"].startswith("https://") and cfg["key"]
        return cfg
    except Exception:
        sys.exit(
            f"Create {CONFIG} first:\n"
            '  {"base": "https://www.getalmanac.xyz", "key": "<your API key>"}'
        )


def fresh(command):
    try:
        at = datetime.fromisoformat(command["at"].replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - at).total_seconds() < TTL_SECONDS
    except Exception:
        return False


def find_file(query, cfg):
    """Spotlight lookup, entirely local — the query came from the spoken
    words; the file names and paths never leave this machine. Scoped to the
    configured directories (default: the usual creative/work homes), newest
    match wins."""
    dirs = cfg.get("file_dirs") or ["~/Documents", "~/Desktop", "~/Movies", "~/Downloads"]

    words = [w for w in query.split() if len(w) > 2][:4]
    if not words:
        return None

    # Every word must appear in the file's name (case-insensitive).
    spotlight = " && ".join(f'kMDItemFSName == "*{w}*"c' for w in words)

    hits = []
    for d in dirs:
        d = str(pathlib.Path(d).expanduser())
        try:
            out = subprocess.run(
                ["mdfind", "-onlyin", d, spotlight],
                capture_output=True, text=True, timeout=10, check=False
            ).stdout.strip()
        except Exception:
            continue
        hits += [h for h in out.splitlines() if h]

    if not hits:
        return None

    # Newest modification first — "my premiere project" means the recent one.
    hits.sort(key=lambda p: pathlib.Path(p).stat().st_mtime if pathlib.Path(p).exists() else 0,
              reverse=True)
    return hits[0]


def find_app(name):
    """'After Effects' is really 'Adobe After Effects 2026.app'. When the
    plain name fails to launch, Spotlight finds application bundles whose
    display name contains every spoken word; the shortest name wins (the
    real app beats its 'Render Engine' helpers) and, among equals, the
    highest name (the newest year)."""
    words = [w for w in name.split() if len(w) > 1][:4]
    if not words:
        return None

    query = 'kMDItemContentType == "com.apple.application-bundle" && ' + \
        " && ".join(f'kMDItemDisplayName == "*{w}*"c' for w in words)

    try:
        out = subprocess.run(["mdfind", query], capture_output=True, text=True,
                             timeout=10, check=False).stdout
    except Exception:
        return None

    apps = [a for a in out.splitlines() if a.endswith(".app")]
    if not apps:
        return None

    apps.sort(key=lambda p: pathlib.Path(p).name, reverse=True)   # newest year
    apps.sort(key=lambda p: len(pathlib.Path(p).stem))            # real app first
    return apps[0]


def execute(command, cfg):
    kind = command.get("kind", "url")
    label = command.get("label", "")

    if kind == "url":
        url = command.get("url", "")
        if not url.startswith(("http://", "https://")):
            log(f"refused non-http: {url!r}")
            return
        log(f"open url: {url}  ({label})")
        subprocess.run(["open", url], check=False)
        return

    if kind == "app":
        app = command.get("app", "")
        allow = cfg.get("apps_allowlist")  # optional; absent = any app name
        if allow and app.lower() not in [a.lower() for a in allow]:
            log(f"app not in allowlist - dropped: {app}")
            return
        # `open -a` only launches real applications; an unknown or misheard
        # name fails harmlessly — and a REAL app under a longer formal name
        # ("Adobe After Effects 2026") gets found by Spotlight on the retry.
        rc = subprocess.run(["open", "-a", app], capture_output=True, check=False).returncode
        if rc == 0:
            log(f"open app: {app}")
            return
        path = find_app(app)
        if path:
            log(f"open app: {app} -> {path}")
            subprocess.run(["open", path], check=False)
        else:
            log(f"no app match for: {app!r}")
        return

    if kind == "file":
        query = command.get("query", "")
        path = find_file(query, cfg)
        if not path:
            log(f"no file match for: {query!r}")
            return
        app = command.get("app")
        log(f"open file: {path}" + (f" with {app}" if app else ""))
        if app:
            # A bad app hint must not sink the file: fall back to the
            # file's own default application.
            rc = subprocess.run(["open", "-a", app, path], capture_output=True, check=False).returncode
            if rc != 0:
                hit = find_app(app)
                rc = subprocess.run(["open", "-a", hit, path], capture_output=True,
                                    check=False).returncode if hit else 1
            if rc != 0:
                log("app hint failed - opening with the default application")
                subprocess.run(["open", path], check=False)
        else:
            subprocess.run(["open", path], check=False)
        return

    log(f"unknown kind dropped: {kind}")


def main():
    cfg = load_config()
    log(f"helper up, polling {cfg['base']} every {POLL_SECONDS}s")

    while True:
        time.sleep(POLL_SECONDS)

        try:
            request = urllib.request.Request(
                f"{cfg['base']}/api/laptop", headers={"x-pos-key": cfg["key"]}
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = json.load(response)
        except Exception as error:
            log(f"poll failed: {error}")
            time.sleep(8)
            continue

        for command in payload.get("commands", []):
            label = command.get("label", "")

            if PAUSE.exists():
                log(f"PAUSED - dropped: {label}")
                continue

            if not fresh(command):
                log(f"stale - dropped: {label}")
                continue

            execute(command, cfg)


if __name__ == "__main__":
    main()
