import { z } from 'zod';

export const DEFAULT_BRANCH_TEMPLATE = '{type}/{id}-{slug}';

const listOrString = z.union([
  z.string().transform((s) => [s]),
  z.array(z.string()),
]);

/** The shape of `.shellie.yml`; shared so the renderer can validate an edited proposal. */
export const ShellieYmlSchema = z.strictObject({
  base: z.string().default('main'),
  branch: z.string().default(DEFAULT_BRANCH_TEMPLATE),
  copy: listOrString.default([]),
  setup: listOrString.optional(),
  run: z.record(z.string(), z.string()).default({}),
  apm: z.union([z.literal(false), listOrString]).optional(),
  review: z.strictObject({ collapse: listOrString.default([]) }).optional(),
});
