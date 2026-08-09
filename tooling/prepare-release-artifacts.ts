import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { selectedReleasePackages } from "./release-packages";

const root = resolve(import.meta.dir, "..");
const outputDirectory = resolve(root, "release-artifacts");
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function command(args: string[], cwd: string) {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, NPM_CONFIG_CACHE: "/tmp/ntauth-npm-cache" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${args.join(" ")} failed\n${stdout}\n${stderr}`);
  return stdout;
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

async function preparePackage(relativeDirectory: string) {
  const directory = resolve(root, relativeDirectory);
  const manifest = await Bun.file(resolve(directory, "package.json")).json();
  const dependencyVersions = Object.values({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  }) as string[];
  if (
    !exactVersionPattern.test(manifest.version) ||
    dependencyVersions.some((version) =>
      version.startsWith("workspace:") ? false : !exactVersionPattern.test(version),
    )
  ) {
    throw new Error(`${manifest.name} contains a non-exact external version`);
  }
  await command(["bun", "run", "build"], directory);
  const output = await command(
    ["bun", "pm", "pack", "--destination", outputDirectory, "--ignore-scripts", "--quiet"],
    directory,
  );
  const filename = basename(output.trim().split("\n").at(-1) ?? "");
  if (!filename) throw new Error(`${manifest.name} did not produce a tarball`);
  const archivePath = resolve(outputDirectory, filename);
  const packedManifest = JSON.parse(
    await command(["tar", "-xOf", archivePath, "package/package.json"], root),
  );
  const packedDependencyVersions = Object.values({
    ...packedManifest.dependencies,
    ...packedManifest.peerDependencies,
  }) as string[];
  if (
    packedManifest.name !== manifest.name ||
    packedManifest.version !== manifest.version ||
    packedDependencyVersions.some((version) => !exactVersionPattern.test(version))
  ) {
    throw new Error(`${manifest.name} produced invalid registry metadata`);
  }
  const file = Bun.file(archivePath);
  const sha256 = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex");
  return {
    filename,
    name: manifest.name as string,
    sha256,
    size: file.size,
    version: manifest.version as string,
  };
}

const artifacts = await selectedReleasePackages().reduce<
  Promise<Array<Awaited<ReturnType<typeof preparePackage>>>>
>(async (pending, { directory }) => {
  const prepared = await pending;
  prepared.push(await preparePackage(directory));
  return prepared;
}, Promise.resolve([]));

artifacts.sort((left, right) => left.name.localeCompare(right.name));
await writeFile(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify({ artifacts }, null, 2)}\n`,
  "utf8",
);
console.log(`Prepared ${artifacts.length} byte-identical registry artifacts`);
