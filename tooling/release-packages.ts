export const releasePackages = [
  { component: "permissions", directory: "packages/permissions", name: "@neotamia/permissions" },
  { component: "elysia-auth", directory: "packages/elysia-auth", name: "@neotamia/elysia-auth" },
  { component: "nuxt-auth", directory: "packages/nuxt-auth", name: "@neotamia/nuxt-auth" },
] as const;

export function selectedReleasePackages(environment: NodeJS.ProcessEnv = process.env) {
  const selection = environment.RELEASE_PACKAGE?.trim();
  if (!selection) return releasePackages;

  const selected = releasePackages.find(
    ({ component, name }) => selection === component || selection === name,
  );
  if (!selected) throw new Error(`Unknown release package: ${selection}`);
  return [selected];
}
