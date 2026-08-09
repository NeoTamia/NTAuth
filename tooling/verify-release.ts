import { resolve } from "node:path";

import { selectedReleasePackages } from "./release-packages";

const root = resolve(import.meta.dir, "..");
const publishReady = process.argv.includes("--publish");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const credentialPattern = /NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|BEGIN (?:RSA |EC )?PRIVATE KEY/;

async function command(args: string[], cwd: string) {
  const process = Bun.spawn(args, { cwd, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${args.join(" ")} failed\n${stdout}\n${stderr}`);
  return `${stdout}\n${stderr}`;
}

async function verifyPackage(relativeDirectory: string) {
  const directory = resolve(root, relativeDirectory);
  const manifest = await Bun.file(resolve(directory, "package.json")).json();
  if (manifest.private === true) throw new Error(`${manifest.name} is private`);
  if (!semverPattern.test(manifest.version)) throw new Error(`${manifest.name} has invalid SemVer`);
  if (manifest.publishConfig?.access !== "public" || manifest.publishConfig?.provenance !== true) {
    throw new Error(`${manifest.name} must publish publicly with provenance`);
  }
  if (publishReady && manifest.version === "0.0.0") {
    throw new Error(`${manifest.name} must be versioned before publication`);
  }
  await command(["bun", "run", "build"], directory);
  const exportContract = manifest.exports?.["."];
  const exportPaths = [exportContract?.import, exportContract?.types];
  const exportExists = await Promise.all(
    exportPaths.map((exportPath) =>
      typeof exportPath === "string"
        ? Bun.file(resolve(directory, exportPath)).exists()
        : Promise.resolve(false),
    ),
  );
  for (const exists of exportExists) {
    if (!exists) {
      throw new Error(`${manifest.name} has a missing package export`);
    }
  }
  const bundle = await Bun.file(resolve(directory, "dist/index.js")).text();
  if (credentialPattern.test(bundle))
    throw new Error(`${manifest.name} contains credential material`);

  const dryRun = await command(["bun", "pm", "pack", "--dry-run"], directory);
  for (const requiredFile of ["package.json", "README.md", "dist/index.js", "dist/index.d.ts"]) {
    if (!dryRun.includes(requiredFile)) {
      throw new Error(`${manifest.name} tarball is missing ${requiredFile}`);
    }
  }
  return `${manifest.name}@${manifest.version}`;
}

const verified = await Promise.all(
  selectedReleasePackages().map(({ directory }) => verifyPackage(directory)),
);
console.log(`Verified npm packages: ${verified.join(", ")}`);
