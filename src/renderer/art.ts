export type ArtName =
  | 'splash-nebula'
  | 'empty-no-tasks'
  | 'empty-no-selection'
  | 'empty-done'
  | 'about-registry';
const files = import.meta.glob('../../assets/art/*.{jpg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const byName = new Map(
  Object.entries(files).map(([p, url]) => [
    p
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, ''),
    url,
  ]),
);
export const artUrl = (name: ArtName): string | null =>
  byName.get(name) ?? null;
