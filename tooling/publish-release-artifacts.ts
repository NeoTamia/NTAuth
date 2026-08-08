import { resolve } from "node:path";

type Artifact = { filename: string; name: string; sha256: string; size: number; version: string };

const root = resolve(import.meta.dir, "..");
const artifactDirectory = resolve(root, "release-artifacts");
const dryRun = process.argv.includes("--dry-run");
const registries = {
  github: "https://npm.pkg.github.com",
  npm: "https://registry.npmjs.org",
} as const;

async function command(args: string[], options: { allowNotFound?: boolean; token?: string } = {}) {
  const child = Bun.spawn(args, {
    cwd: root,
    env: {
      ...process.env,
      ...(options.token ? { NODE_AUTH_TOKEN: options.token } : {}),
      NPM_CONFIG_CACHE: "/tmp/ntauth-npm-cache",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    if (options.allowNotFound && /E404|404 Not Found|is not in this registry/i.test(stderr)) return;
    throw new Error(`${args.join(" ")} failed\n${stdout}\n${stderr}`);
  }
  return stdout.trim();
}

async function published(artifact: Artifact, registry: string, token: string) {
  const output = await command(
    [
      "npm",
      "view",
      `${artifact.name}@${artifact.version}`,
      "version",
      "--json",
      "--registry",
      registry,
    ],
    { allowNotFound: true, token },
  );
  return output !== undefined && output.replaceAll('"', "") === artifact.version;
}

async function verifyArtifact(artifact: Artifact) {
  const file = Bun.file(resolve(artifactDirectory, artifact.filename));
  if (!(await file.exists()) || file.size !== artifact.size)
    throw new Error(`${artifact.name} artifact is missing`);
  const sha256 = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex");
  if (sha256 !== artifact.sha256) throw new Error(`${artifact.name} artifact checksum changed`);
}

const releaseManifest = (await Bun.file(resolve(artifactDirectory, "manifest.json")).json()) as {
  artifacts: Artifact[];
};
await Promise.all(releaseManifest.artifacts.map(verifyArtifact));

if (dryRun) {
  console.log(
    `Verified ${releaseManifest.artifacts.length} shared npm/GitHub tarballs without publishing`,
  );
} else {
  const npmToken = process.env.NPM_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  if (!npmToken || !githubToken) throw new Error("Both registry tokens are required");

  await Promise.all(
    releaseManifest.artifacts.map(async (artifact) => {
      let npmPublished = await published(artifact, registries.npm, npmToken);
      let githubPublished = await published(artifact, registries.github, githubToken);
      console.log(
        `${artifact.name}@${artifact.version} state: npm=${npmPublished}, github=${githubPublished}`,
      );
      try {
        if (!npmPublished) {
          await command(
            [
              "npm",
              "publish",
              resolve(artifactDirectory, artifact.filename),
              "--access",
              "public",
              "--provenance",
              "--registry",
              registries.npm,
            ],
            { token: npmToken },
          );
        }
        if (!githubPublished) {
          await command(
            [
              "npm",
              "publish",
              resolve(artifactDirectory, artifact.filename),
              "--access",
              "public",
              "--registry",
              registries.github,
            ],
            { token: githubToken },
          );
        }
      } catch (error) {
        npmPublished = await published(artifact, registries.npm, npmToken);
        githubPublished = await published(artifact, registries.github, githubToken);
        throw new Error(
          `Partial publication detected for ${artifact.name}@${artifact.version}: npm=${npmPublished}, github=${githubPublished}`,
          { cause: error },
        );
      }
    }),
  );
}
