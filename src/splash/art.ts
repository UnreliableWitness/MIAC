const files = import.meta.glob('../../assets/art/splash-nebula.*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
export const nebulaUrl: string | null = Object.values(files)[0] ?? null;
