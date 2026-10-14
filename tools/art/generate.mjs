#!/usr/bin/env node
// node tools/art/generate.mjs list                  print the names in prompts.md
// node tools/art/generate.mjs generate [names...]   ask Gemini for every image, or only those named, into tools/art/incoming/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aspectRatio, parsePrompts } from './prompts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

function findKey() {
  if (process.env.GEMINI_API_KEY?.trim())
    return process.env.GEMINI_API_KEY.trim();
  const file = path.join(here, 'gemini.local.key');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

async function generate(key, prompt, ratio) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: ratio },
        },
      }),
    },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 600)}`);
  const doc = JSON.parse(body);
  for (const cand of doc.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data)
        return Buffer.from(part.inlineData.data, 'base64');
    }
  }
  throw new Error(`Gemini returned no image: ${body.slice(0, 600)}`);
}

const [command = 'list', ...names] = process.argv.slice(2);
const prompts = parsePrompts(
  readFileSync(path.join(here, 'prompts.md'), 'utf8'),
);

if (command === 'list') {
  for (const name of prompts.keys()) console.log(name);
  process.exit(0);
}
if (command !== 'generate') {
  console.error(
    'Usage: node tools/art/generate.mjs <list|generate [names...]>',
  );
  process.exit(64);
}
const key = findKey();
if (!key) {
  console.error(
    'No key: set GEMINI_API_KEY or write it to tools/art/gemini.local.key (https://aistudio.google.com/apikey)',
  );
  process.exit(2);
}
const wanted = names.length > 0 ? names : [...prompts.keys()];
const unknown = wanted.filter((n) => !prompts.has(n));
if (unknown.length > 0) {
  console.error(
    `No prompt for: ${unknown.join(', ')} (known: ${[...prompts.keys()].join(', ')})`,
  );
  process.exit(64);
}
const incoming = path.join(here, 'incoming');
mkdirSync(incoming, { recursive: true });
let failed = 0;
for (const name of wanted) {
  const prompt = prompts.get(name);
  const ratio = aspectRatio(prompt);
  process.stdout.write(`${name}: asking ${model} for ${ratio}... `);
  try {
    const png = await generate(key, prompt, ratio);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = path.join(incoming, `${name}-${stamp}.png`);
    writeFileSync(file, png);
    console.log(
      `${Math.round(png.length / 1024)} KB -> tools/art/incoming/${path.basename(file)}`,
    );
  } catch (e) {
    failed++;
    console.log(`failed: ${e.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
