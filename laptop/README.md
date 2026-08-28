# The laptop helper

Lets the desk device open things on this machine by voice: "Jarvis, google
espresso machines on my laptop", "draft an email to Sarah and open it on my
laptop". The helper polls Almanac every 2 seconds and opens queued URLs in
the default browser. It can do nothing else — no keystrokes, no apps, no
reading anything.

## Install (once)

1. Create the config (the key is `API_SECRET` from Vercel — never commit it):

       echo '{"base": "https://www.getalmanac.xyz", "key": "PASTE-KEY-HERE"}' > ~/.almanac-laptop.json

2. Load it as a background service:

       cp laptop/com.almanac.laptop.plist ~/Library/LaunchAgents/
       launchctl load ~/Library/LaunchAgents/com.almanac.laptop.plist

That's it. It survives reboots. Log: `~/.almanac-laptop.log`.

3. For FILE search ("open my resume on my laptop") macOS needs one
   permission: System Settings → Privacy & Security → Full Disk Access →
   "+" → press ⌘⇧G and paste:

       /Library/Developer/CommandLineTools/usr/bin/python3

   That exact path matters: `/usr/bin/python3` is a stub that hands off to
   this real interpreter, and macOS attributes disk permission to the real
   one. URLs and app-launching work without this step; only the local file
   search needs it.

## Pausing (exams, screen-shares, calls)

    touch ~/.almanac-laptop-pause     # nothing opens, instantly
    rm ~/.almanac-laptop-pause        # back on

Add aliases if you like:

    alias jarvis-pause='touch ~/.almanac-laptop-pause'
    alias jarvis-resume='rm -f ~/.almanac-laptop-pause'

## The safety model

- The server queues a command ONLY when the spoken sentence explicitly
  named the laptop. Jarvis never volunteers a window.
- Commands expire in 60 seconds on both ends — opening the laptop later
  never replays old instructions.
- Only http(s) URLs, opened with `open` and list-args — no shell anywhere.
- The pause file wins over everything.

## Uninstall

    launchctl unload ~/Library/LaunchAgents/com.almanac.laptop.plist
    rm ~/Library/LaunchAgents/com.almanac.laptop.plist
