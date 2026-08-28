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
            url = command.get("url", "")

            if PAUSE.exists():
                log(f"PAUSED - dropped: {url}")
                continue

            if not fresh(command):
                log(f"stale - dropped: {url}")
                continue

            if not url.startswith(("http://", "https://")):
                log(f"refused non-http: {url!r}")
                continue

            log(f"open: {url}  ({command.get('label', '')})")
            subprocess.run(["open", url], check=False)


if __name__ == "__main__":
    main()
