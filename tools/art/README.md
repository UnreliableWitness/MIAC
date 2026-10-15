# Art: generated with Gemini

The same loop as the Adem app's `tools/art`, in Node.

1. Get a key at https://aistudio.google.com/apikey and put it in `tools/art/gemini.local.key` (git-ignored) or in
   `GEMINI_API_KEY`. It is sent only to generativelanguage.googleapis.com, as a header, and never printed.
2. `node tools/art/generate.mjs generate` asks the image model (`gemini-2.5-flash-image`, or `GEMINI_IMAGE_MODEL`)
   for every image in `prompts.md` and saves timestamped candidates in `tools/art/incoming/` (git-ignored).
3. Not happy with one? Edit its line in `prompts.md` and re-run with only its name: `... generate appicon-tally`.
4. `... list` prints the names in the pack.

Pick one candidate per name, then post-process it into `assets/art/` (`cwebp` is not on the owner's Mac, so JPEG):

```bash
sips -Z 1600 -s format jpeg -s formatOptions 80 tools/art/incoming/<picked>.png --out assets/art/<name>.jpg
ls -l assets/art/<name>.jpg   # must be under 400 KB; if not, re-run with formatOptions 70
```

Log each pick in `assets/ART.md`: the date, model, prompt, which candidate won and why, and the post-processing.
Rejected candidates stay local.
