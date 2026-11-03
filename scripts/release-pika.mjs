#!/usr/bin/env node
// Builds the pika release tarball: the coding-agent package rebranded as pika (command `pika`, config in ~/.pika),
// installable with `npm install -g pika-<version>.tgz`.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		version: { type: "string" },
		out: { type: "string", default: ".artifacts/pika" },
		"skip-build": { type: "boolean", default: false },
	},
});
if (!values.version) {
	console.error("Usage: node scripts/release-pika.mjs --version <x.y.z> [--out <dir>] [--skip-build]");
	process.exit(1);
}

const repoRoot = resolve(import.meta.dirname, "..");
const packageDir = join(repoRoot, "packages/coding-agent");
const outDir = resolve(repoRoot, values.out);
const workDir = mkdtempSync(join(tmpdir(), "pika-release-"));

try {
	if (!values["skip-build"]) execFileSync("npm", ["run", "build"], { cwd: packageDir, stdio: "inherit" });

	// Pack the package as published, then rewrite its manifest. The bundle (dist/bundle/cli.js) already contains the
	// workspace packages and third-party code, so the release does not depend on unpublished workspace versions.
	execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", workDir], { cwd: packageDir, stdio: "inherit" });
	const [tarball] = readdirSync(workDir);
	execFileSync("tar", ["xzf", join(workDir, tarball), "-C", workDir]);

	const manifestPath = join(workDir, "package", "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	manifest.name = "@agentiker/pika";
	manifest.version = values.version;
	manifest.description = "pika: the pi coding agent with Claude Code style slash commands";
	// name sets the command and product name pi shows; configDir keeps pika's settings and sessions apart from pi's.
	manifest.piConfig = { name: "pika", configDir: ".pika" };
	manifest.bin = { pika: manifest.bin.pi };
	manifest.repository = { type: "git", url: "git+https://github.com/agentiker/pi-claude.git" };
	delete manifest.scripts;
	delete manifest.devDependencies;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

	mkdirSync(outDir, { recursive: true });
	execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", outDir], {
		cwd: join(workDir, "package"),
		stdio: "inherit",
	});
	const output = join(outDir, `pika-${values.version}.tgz`);
	renameSync(join(outDir, `agentiker-pika-${values.version}.tgz`), output);
	console.log(`Wrote ${output}`);
} finally {
	rmSync(workDir, { recursive: true, force: true });
}
