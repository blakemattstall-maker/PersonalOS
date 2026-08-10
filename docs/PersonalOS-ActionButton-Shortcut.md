# The "Ask PersonalOS" Action Button Shortcut

**What it is:** a single iOS Shortcut, bound to the iPhone Action Button, that records a spoken question, sends it to `/api/capture`, and speaks the answer back. It makes the assistant present in a way the dashboard never can — press, ask, hear the answer, without unlocking or opening anything.

**Why this and not the existing capture Shortcut:** the capture Shortcut is silent (the app pushes the reply). This one is the *conversational* front door — it waits for the answer and reads it aloud. Same endpoint, different ending. `/api/capture` already accepts audio and already returns a spoken `message`, so this is purely a phone-side build. **~30 minutes, no code changes.**

This is hand-built on the phone and is **not in version control** — like the existing capture Shortcut. Record it here so it can be rebuilt.

---

## The endpoint contract (already live)

`POST https://web-liart-two-12.vercel.app/api/capture`

- Header `x-pos-key: <API_SECRET>` — the same secret the capture Shortcut already carries. **Do not** put it anywhere the repo can see it.
- Body, either:
  - `{ "audio_base64": "<base64 of the recording>", "mime_type": "audio/m4a" }`, or
  - `{ "text": "<typed question>" }`
- Response: `{ "success": bool, "result": { "message": "<the spoken answer>" }, "heard": "<what it transcribed>", ... }`

The `mime_type` matters: iOS's Record Audio action reports `audio/m4a`, and the server's `extensionFor()` maps it correctly. Do not hand it `.webm`.

---

## The Shortcut, action by action

1. **Record Audio** — "Ask PersonalOS". Set *Finish Recording* to **On Tap** (so a second press of the Action Button ends it) or *After Pause* if you prefer hands-free. Quality: default.
2. **Base64 Encode** the recording → variable `Audio64`.
3. **Text** action holding the JSON body:
   `{"audio_base64":"[Audio64]","mime_type":"audio/m4a"}`
   (insert the `Audio64` variable inside the quotes).
4. **Get Contents of URL**
   - URL: `https://web-liart-two-12.vercel.app/api/capture`
   - Method: `POST`
   - Headers: `x-pos-key` = your API secret; `Content-Type` = `application/json`
   - Request Body: **File** → the Text from step 3 (or use *JSON* body mode and map the two keys).
5. **Get Dictionary Value** `result.message` from the response → variable `Reply`.
6. **Speak Text** `Reply`. (Optionally, **Show Result** as well, so it's on screen if you're somewhere you can't listen.)
7. *(Optional)* an **If** on `success`: when false, Speak "That didn't work" so a failure is never silent.

---

## Bind it to the Action Button

Settings → Action Button → **Shortcut** → choose "Ask PersonalOS". (On models without an Action Button: add it to the Lock Screen or a Home Screen as a widget, or trigger by Back Tap.)

---

## Verifying it

Say something with an unambiguous answer that exercises a real tool, e.g. *"what have I got going on with Costco"* (routes to `query_connections`) or *"what's on my schedule today"*. You should hear the spoken answer within a couple of seconds. If it's silent, check in order: the `x-pos-key` header (a 401 comes back with no `message`), the `mime_type` (`audio/m4a`, not webm), and that step 5 reads `result.message` and not `message`.

---

## Note for whoever maintains this

The response also carries `heard` — what the server transcribed. If a spoken question does the wrong thing, that field is the only way to tell *misheard* from *misrouted*, so it's worth surfacing (Speak or Show) while tuning, then hiding once it's reliable.
