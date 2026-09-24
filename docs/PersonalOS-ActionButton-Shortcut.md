# The "Ask PersonalOS" Action Button Shortcut

**What it is:** a single iOS Shortcut, bound to the iPhone Action Button, that records a spoken question, sends it and any text currently on the clipboard to `/api/capture`, and speaks the answer back. Clipboard text is used only when the spoken request refers to it — for example, "research this link" or "summarize what I copied."

**Why this and not the existing capture Shortcut:** the capture Shortcut is silent (the app pushes the reply). This one is the *conversational* front door — it waits for the answer and reads it aloud. The same `/api/capture` endpoint accepts the recording, optional clipboard text, and returns a spoken `message`.

This is hand-built on the phone and is **not in version control** — like the existing capture Shortcut. Record it here so it can be rebuilt.

---

## The endpoint contract (already live)

`POST https://web-liart-two-12.vercel.app/api/capture`

- Header `x-pos-key: <API_SECRET>` — the same secret the capture Shortcut already carries. **Do not** put it anywhere the repo can see it.
- Body, either:
  - `{ "audio_base64": "<base64 of the recording>", "mime_type": "audio/m4a" }`, or
  - `{ "text": "<typed question>" }`
- Either body may also include `"clipboard_text": "<optional copied URL or text>"`.
- Response: `{ "success": bool, "result": { "message": "<the spoken answer>" }, "heard": "<what it transcribed>", "clipboard_used": true, ... }`. `clipboard_used` is present only when the spoken request referred to usable clipboard text.

The `mime_type` matters: iOS's Record Audio action reports `audio/m4a`, and the server's `extensionFor()` maps it correctly. Do not hand it `.webm`.

---

## The Shortcut, action by action

1. **Get Clipboard** → variable `Clipboard`.
2. **Get Type** of `Clipboard`.
3. **If** the type is Text, URL, or Rich Text, use **Get Text from Input** and save it as `ClipboardText`. Otherwise set `ClipboardText` to an empty Text value. This keeps copied photos and files out of the request.
4. **Record Audio** — "Ask PersonalOS". Set *Finish Recording* to **On Tap** (so a second press of the Action Button ends it) or *After Pause* if you prefer hands-free. Quality: default.
5. **Base64 Encode** the recording → variable `Audio64`.
6. **Get Contents of URL**
   - URL: `https://web-liart-two-12.vercel.app/api/capture`
   - Method: `POST`
   - Headers: `x-pos-key` = your API secret; `Content-Type` = `application/json`
   - Request Body: **JSON** with `audio_base64` = `Audio64`, `mime_type` = `audio/m4a`, and `clipboard_text` = `ClipboardText`. Use JSON mode rather than constructing JSON in a Text action; copied text can contain quotes and line breaks that need escaping.
7. **Get Dictionary Value** `result.message` from the response → variable `Reply`.
8. **Speak Text** `Reply`. (Optionally, **Show Result** as well, so it's on screen if you're somewhere you can't listen.)
9. *(Optional)* an **If** on `success`: when false, Speak "That didn't work" so a failure is never silent.

---

## Bind it to the Action Button

Settings → Action Button → **Shortcut** → choose "Ask PersonalOS". (On models without an Action Button: add it to the Lock Screen or a Home Screen as a widget, or trigger by Back Tap.)

---

## Verifying it

First copy a URL, then say *"research this link and tell me whether its claims are credible."* The response should include `clipboard_used: true`. Then leave the same URL copied and ask *"what's on my schedule today?"* That response should omit `clipboard_used`, proving the clipboard was discarded before routing. If the Shortcut is silent, check in order: the `x-pos-key` header (a 401 comes back with no `message`), the `mime_type` (`audio/m4a`, not webm), and that step 7 reads `result.message` and not `message`.

---

## Note for whoever maintains this

The response also carries `heard` — what the server transcribed. If a spoken question does the wrong thing, that field is the only way to tell *misheard* from *misrouted*, so it's worth surfacing (Speak or Show) while tuning, then hiding once it's reliable.
