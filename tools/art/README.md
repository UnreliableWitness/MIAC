# Art: generated with Gemini

The same loop as the Adem app's `tools/art`, in Node.

1. Get a key at https://aistudio.google.com/apikey and put it in `tools/art/gemini.local.key` (git-ignored) or in
   `GEMINI_API_KEY`. It is sent only to generativelanguage.googleapis.com, as a header, and never printed.
2. `node tools/art/generate.mjs generate` asks the image model (`gemini-2.5-flash-image`, or `GEMINI_IMAGE_MODEL`)
   for every image in `prompts.md` and saves timestamped candidates in `tools/art/incoming/` (git-ignored).
3. Not happy with one? Edit its line in `prompts.md` and re-run with only its name: `... generate appicon-tally`.
4. `... list` prints the names in the pack.

A chosen image is copied by hand to `assets/` with a note in `assets/ART.md` that records the date, model, prompt,
which candidate won and why, and any post-processing. Rejected candidates stay local.
