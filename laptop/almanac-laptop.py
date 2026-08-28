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

    # "open my headshot cutout FILE" — the words describing that it IS a
    # file are not part of its name, and requiring them yields zero matches
    # every time. Only distinctive words constrain the search.
    STOP = {"file", "files", "project", "document", "doc", "folder",
            "the", "and", "for", "named", "called", "that", "one"}

    words = [w for w in query.lower().split() if len(w) > 2 and w not in STOP][:4]
    if not words:
        return None

    # Every word must appear in the file's name (case-insensitive).
    spotlight = " && ".join(f'kMDItemFSName == "*{w}*"c' for w in words)

    hits = []
    for d in dirs:
        d = str(pathlib.Path(d).expanduser())
        try:
            r = subprocess.run(
                ["mdfind", "-onlyin", d, spotlight],
                capture_output=True, text=True, timeout=10, check=False
            )
        except Exception as error:
            log(f"mdfind blew up in {d}: {error}")
            continue
        found = [h for h in r.stdout.strip().splitlines() if h]
        log(f"mdfind {d}: rc={r.returncode} hits={len(found)} err={r.stderr.strip()[:120]!r}")
        hits += found

    if not hits:
        # Loose pass, for files with names that match nothing you'd say out
        # loud: a plain Spotlight query tokenizes across file names AND
        # content, so "trifilm logo" finds `TF_logo_v3_FINAL.aep` through
        # the words inside it. Ranked by how much of the name matches, then
        # by recency, so the strict pass's precision is preferred whenever
        # it exists.
        for d in dirs:
            d = str(pathlib.Path(d).expanduser())
            try:
                out = subprocess.run(["mdfind", "-onlyin", d, " ".join(words)],
                                     capture_output=True, text=True, timeout=10,
                                     check=False).stdout
            except Exception:
                continue
            hits += [h for h in out.splitlines() if h]
        if hits:
            log(f"loose match used for: {' '.join(words)!r}")

    if not hits:
        return None

    def name_score(p):
        name = pathlib.Path(p).name.lower()
        return sum(1 for w in words if w in name)

    def mtime(p):
        try:
            return pathlib.Path(p).stat().st_mtime
        except OSError:
            return 0

    # Most name-words matched first; newest breaks ties — "my premiere
    # project" means the recent one.
    hits.sort(key=mtime, reverse=True)
    hits.sort(key=name_score, reverse=True)
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


# The verb library: every action the laptop can PERFORM (as opposed to
# open), each one a fixed argv — the server can only ever name a key in
# this dictionary, so free text can never become execution. Additions to
# Jarvis's physical vocabulary happen here, by hand, on this machine.
VERBS = {
    "spotify_play":     ["osascript", "-e", 'tell application "Spotify" to play'],
    "spotify_pause":    ["osascript", "-e", 'tell application "Spotify" to pause'],
    "spotify_next":     ["osascript", "-e", 'tell application "Spotify" to next track'],
    "spotify_previous": ["osascript", "-e", 'tell application "Spotify" to previous track'],
    "volume_up":        ["osascript", "-e", "set volume output volume ((output volume of (get volume settings)) + 10)"],
    "volume_down":      ["osascript", "-e", "set volume output volume ((output volume of (get volume settings)) - 10)"],
    "mute":             ["osascript", "-e", "set volume with output muted"],
    "unmute":           ["osascript", "-e", "set volume without output muted"],
    "sleep_display":    ["pmset", "displaysleepnow"],
}


def report(cfg, command, ok, detail):
    """Tell the server what actually happened, so the desk's voice can say
    the truth instead of optimism. Best-effort — a failed report costs a
    vague sentence, never an action."""
    try:
        body = json.dumps({"action": "report", "id": command.get("id"),
                           "ok": ok, "detail": detail[:200]}).encode()
        request = urllib.request.Request(
            f"{cfg['base']}/api/laptop", data=body, method="POST",
            headers={"x-pos-key": cfg["key"], "content-type": "application/json"})
        urllib.request.urlopen(request, timeout=10).read()
    except Exception as error:
        log(f"report failed: {error}")


def find_contact_phone(name):
    """The Mac's own Contacts app, searched locally — names and numbers
    never leave this machine. Every spoken word must appear in the
    contact's name; first match's first phone wins."""
    words = [w for w in name.split() if w.isalpha()][:4]
    if not words:
        return None, None
    clauses = " and ".join(f'name contains "{w}"' for w in words)
    script = (f'tell application "Contacts" to if exists (person 1 whose {clauses}) then '
              f'get (name of person 1 whose {clauses}) & "|" & '
              f'(value of phone 1 of (person 1 whose {clauses}))')
    try:
        out = subprocess.run(["osascript", "-e", script], capture_output=True,
                             text=True, timeout=15, check=False).stdout.strip()
    except Exception:
        return None, None
    if "|" not in out:
        return None, None
    who, _, raw = out.partition("|")
    digits = "".join(c for c in raw if c.isdigit() or c == "+")
    return (who, digits) if len(digits) >= 7 else (None, None)


def run_shortcut(name, cfg):
    """His own Shortcuts automations, run by name — the big unlock, because
    he authored them and that authorship is the consent. Fuzzy matched
    (every spoken word in the shortcut's name, shortest match wins) against
    what actually exists; an optional shortcuts_allowlist in the config
    narrows it further."""
    try:
        installed = subprocess.run(["shortcuts", "list"], capture_output=True,
                                   text=True, timeout=15, check=False).stdout.splitlines()
    except Exception as error:
        log(f"shortcuts list failed: {error}")
        return False, "couldn't read the shortcuts list"

    # Only shortcuts OFFERED to Jarvis are runnable: ones whose name starts
    # with "Jarvis" (naming it is the opt-in — create "Jarvis Focus" and
    # it's a voice power), plus anything explicitly allowlisted in the
    # config. The rest of the library — legacy projects, shortcuts with
    # their own automations — is invisible here, so a mishear can never
    # fire something that was not built for this.
    allow = [a.lower() for a in (cfg.get("shortcuts_allowlist") or [])]

    offered = [s for s in installed if s.strip()
               and (s.lower().startswith("jarvis") or s.lower() in allow)]

    words = [w.lower() for w in name.split() if len(w) > 1 and w.lower() != "jarvis"]
    matches = [s for s in offered if all(w in s.lower() for w in words)]

    if not matches:
        log(f"no shortcut match for: {name!r}")
        return False, f"no shortcut named anything like {name} is offered to me"

    best = min(matches, key=len)
    log(f"run shortcut: {best}")
    rc = subprocess.run(["shortcuts", "run", best], timeout=120, check=False).returncode
    if rc == 0:
        return True, f"{best} ran on your laptop"
    return False, f"{best} started but exited with an error"


# Every branch returns (ok, detail) — the sentence the desk will speak.
def execute(command, cfg):
    kind = command.get("kind", "url")
    label = command.get("label", "")

    if kind == "url":
        url = command.get("url", "")
        if not url.startswith(("http://", "https://")):
            log(f"refused non-http: {url!r}")
            return False, "that wasn't a web link I'll open"
        log(f"open url: {url}  ({label})")
        subprocess.run(["open", url], check=False)
        return True, ""

    if kind == "app":
        app = command.get("app", "")
        allow = cfg.get("apps_allowlist")  # optional; absent = any app name
        if allow and app.lower() not in [a.lower() for a in allow]:
            log(f"app not in allowlist - dropped: {app}")
            return False, f"{app} isn't on the allowed list"
        # `open -a` only launches real applications; an unknown or misheard
        # name fails harmlessly — and a REAL app under a longer formal name
        # ("Adobe After Effects 2026") gets found by Spotlight on the retry.
        rc = subprocess.run(["open", "-a", app], capture_output=True, check=False).returncode
        if rc == 0:
            log(f"open app: {app}")
            return True, f"{app} is open on your laptop"
        path = find_app(app)
        if path:
            log(f"open app: {app} -> {path}")
            subprocess.run(["open", path], check=False)
            return True, f"{pathlib.Path(path).stem} is open on your laptop"
        log(f"no app match for: {app!r}")
        return False, f"no app called {app} is installed"

    if kind == "file":
        query = command.get("query", "")
        path = find_file(query, cfg)
        if not path:
            log(f"no file match for: {query!r}")
            return False, f"no file matching {query} turned up"
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
        return True, f"{pathlib.Path(path).name} is open on your laptop"

    if kind == "shortcut":
        return run_shortcut(command.get("query", ""), cfg)

    if kind == "verb":
        verb = command.get("query", "")
        if verb == "screenshot":
            shot = pathlib.Path.home() / "Desktop" / f"jarvis-{datetime.now().strftime('%H%M%S')}.png"
            log(f"verb: screenshot -> {shot}")
            subprocess.run(["screencapture", "-x", str(shot)], check=False)
            # screencapture exits 0 even when the Screen Recording permission
            # silently blocks it — the file existing is the only truth.
            if shot.exists():
                return True, "screenshot saved to your desktop"
            return False, "the screenshot was blocked - grant Screen Recording to python3 in Privacy settings"
        argv = VERBS.get(verb)
        if not argv:
            log(f"unknown verb dropped: {verb!r}")
            return False, "that's not an action I know"
        log(f"verb: {verb}")
        rc = subprocess.run(argv, capture_output=True, timeout=15, check=False).returncode
        return (True, "") if rc == 0 else (False, f"{verb.replace('_', ' ')} failed on the laptop")

    if kind == "sms":
        # The Mac's own Contacts app resolves the name; the number never
        # leaves this machine. The sms: URL opens the thread — nothing here
        # can type or send.
        name = command.get("query", "")
        who, phone = find_contact_phone(name)
        if not phone:
            log(f"no contact match for: {name!r}")
            return False, f"no contact matching {name} in your address book"
        log(f"open messages thread: {who}")
        subprocess.run(["open", f"sms:{phone}"], check=False)
        return True, f"your conversation with {who} is open"

    log(f"unknown kind dropped: {kind}")
    return False, "unknown command"


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
                report(cfg, command, False, "the laptop helper is paused at the machine")
                continue

            if not fresh(command):
                log(f"stale - dropped: {label}")
                report(cfg, command, False, "that instruction expired before the laptop saw it")
                continue

            try:
                ok, detail = execute(command, cfg)
            except Exception as error:
                ok, detail = False, "the helper hit an error"
                log(f"execute blew up: {error}")

            report(cfg, command, ok, detail)


if __name__ == "__main__":
    main()
