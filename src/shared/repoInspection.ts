/** What Shellie finds in a folder before it is added as a repository (`repos:inspect`). */
export type RepoInspection = {
  folder: string;
  remote: {
    url: string;
    provider: 'azure-devops' | 'github' | 'other';
    connectionId: string | null;
    project: string | null;
  } | null;
  baseBranch: string;
  facts: RepoFacts;
  /** The `.shellie.yml` Shellie would write; null when the repo already has one. */
  proposal: string | null;
};

export type RepoFacts = {
  lockfile: 'npm' | 'pnpm' | 'yarn' | null;
  /** Names of `.sln` / `.csproj` files in the root. */
  dotnet: string[];
  devScript: 'dev' | 'start' | null;
  apm: boolean;
  /** Git-ignored `.env*` and `appsettings.*.local.json` files in the root. */
  envFiles: string[];
  /** The text of an existing `.shellie.yml`. */
  existing: string | null;
};
