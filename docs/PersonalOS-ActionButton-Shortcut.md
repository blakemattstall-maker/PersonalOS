# Almanac iPhone Shortcuts

Both Shortcuts may send copied text or a copied URL. Almanac ignores it unless your request says something such as “this link,” “this page,” “what I copied,” or “the clipboard.” Photos and files are deliberately left on the phone.

Use this endpoint in both Shortcuts:

`POST https://www.getalmanac.xyz/api/capture`

The old `personal-os-…vercel.app` address still works as a compatibility
forwarder, but this is the direct, stable Almanac address.

Add these headers in **Get Contents of URL**:

- `x-pos-key`: the API secret already used by your current capture Shortcut
- `Content-Type`: `application/json`

## Shared clipboard block

Put these actions at the very beginning of both Shortcuts:

1. Add **Get Clipboard**.
2. Add **Get Type** and give it the output of Get Clipboard.
3. Add **If**. Set the condition to: Type **is** Text.
4. Inside that If, add **Get Text from Input** and give it Clipboard. Add **Set Variable**, name it `ClipboardText`, and give it the text output.
5. Add **Otherwise**. Inside it, add a **Text** action and leave the text empty. Add **Set Variable**, name it `ClipboardText`, and give it that empty Text action.
6. End the If.

If iOS reports a copied URL as **URL** rather than **Text**, add a second condition to the If with **Any** selected: Type is Text **or** Type is URL. “Get Text from Input” converts either one safely.

This block prevents copied photos, files, and other clipboard objects from being uploaded.

## Text Capture Shortcut

Open the existing text capture Shortcut, add the shared clipboard block above, then keep or add these actions below it:

1. Add **Ask for Input**. Set the prompt to `What should Almanac do?` and Input Type to **Text**. Rename its output variable `CaptureText`.
   - If the existing Shortcut already gets text another way, keep that action and use its output as `CaptureText`.
2. Add **Get Contents of URL** with the endpoint above.
3. Expand **Get Contents of URL** and set Method to **POST**.
4. Add the two headers listed above.
5. Set Request Body to **JSON**.
6. Add a Text field named `text`; set its value to the `CaptureText` magic variable.
7. Add a Text field named `clipboard_text`; set its value to the `ClipboardText` magic variable.
8. To see the immediate answer, add **Get Dictionary Value**, key `result`, from Contents of URL. Then add another **Get Dictionary Value**, key `message`, from that result. Add **Show Result** using the final value.

For a silent capture that relies on Almanac’s normal notification, omit step 8.

## Audio Capture / Action Button Shortcut

Open the existing audio capture Shortcut, add the shared clipboard block above, then use these actions below it:

1. Add **Record Audio**. Set Finish Recording to **On Tap** for a second Action Button press to stop, or **After Pause** for hands-free use.
2. Add **Base64 Encode** and give it the recorded audio. Turn **Line Breaks** off. Rename the output `Audio64`.
3. Add **Get Contents of URL** with the endpoint above.
4. Expand it and set Method to **POST**.
5. Add the two headers listed above.
6. Set Request Body to **JSON**.
7. Add a Text field named `audio_base64`; set its value to `Audio64`.
8. Add a Text field named `mime_type`; type `audio/m4a` exactly.
9. Add a Text field named `clipboard_text`; set its value to `ClipboardText`.
10. Add **Get Dictionary Value**, key `result`, from Contents of URL.
11. Add another **Get Dictionary Value**, key `message`, from the result of step 10. Rename it `Reply`.
12. Add **Speak Text** and give it `Reply`. You can also add **Show Result** with `Reply` for quiet places.

Bind it at **Settings → Action Button → Shortcut → your audio Almanac Shortcut**.

## Test both Shortcuts

1. Copy a web URL.
2. Run each Shortcut and ask: `Research this link and tell me whether its claims are credible.`
3. Leave the same URL copied and ask: `What is on my schedule today?`

The first request should use the URL. The second should ignore it. The server response includes `clipboard_used: true` only when it used the copied material.

If a Shortcut fails, check the `x-pos-key` header first. For audio, also confirm `mime_type` is `audio/m4a` and Base64 line breaks are off.
