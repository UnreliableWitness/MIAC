#!/usr/bin/env node
// node tools/ado/seed-test-items.mjs <organizationUrl> <project> <keychain-service>
// Creates three Issues and one Task in the project's current sprint. Idempotent: skips titles that already exist.
import { execFileSync } from 'node:child_process';

const [orgUrl, project, service] = process.argv.slice(2);
if (!orgUrl || !project || !service) {
  console.error(
    'Usage: node tools/ado/seed-test-items.mjs <organizationUrl> <project> <keychain-service>',
  );
  process.exit(64);
}
const pat = execFileSync(
  'security',
  ['find-generic-password', '-a', 'miac', '-s', service, '-w'],
  { encoding: 'utf8' },
).trim();
const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
const api = async (path, init = {}) => {
  const res = await fetch(`${orgUrl}${path}`, {
    ...init,
    headers: {
      authorization: auth,
      accept: 'application/json',
      ...init.headers,
    },
  });
  let text = await res.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!res.ok)
    throw new Error(
      `${res.status} ${path.split('?')[0]}: ${text.slice(0, 200)}`,
    );
  return JSON.parse(text);
};
const p = encodeURIComponent(project);
const iterations = await api(
  `/${p}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`,
);
const sprint = iterations.value?.[0]?.path ?? null;
const wanted = [
  ['Issue', 'Checkout: allow saving a delivery address'],
  ['Issue', 'Show estimated delivery date on product page'],
  ['Issue', "Coupon field ignores O'Brien style names"],
  ['Task', 'Upgrade payment SDK to v5'],
];
const existing = await api(`/${p}/_apis/wit/wiql?api-version=7.1`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    query:
      'SELECT [System.Title] FROM WorkItems WHERE [System.TeamProject] = @project',
  }),
});
const ids = (existing.workItems ?? []).map((w) => w.id);
const titles = new Set();
if (ids.length) {
  const got = await api(
    `/_apis/wit/workitems?ids=${ids.slice(0, 200).join(',')}&fields=System.Title&api-version=7.1`,
  );
  for (const w of got.value ?? []) titles.add(w.fields['System.Title']);
}
for (const [type, title] of wanted) {
  if (titles.has(title)) {
    console.log(`skip  ${type}: ${title}`);
    continue;
  }
  const ops = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (sprint)
    ops.push({
      op: 'add',
      path: '/fields/System.IterationPath',
      value: sprint,
    });
  const created = await api(
    `/${p}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json-patch+json' },
      body: JSON.stringify(ops),
    },
  );
  console.log(`made  ${type} ${created.id}: ${title}`);
}
