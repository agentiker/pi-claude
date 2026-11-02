/**
 * /add-dir: add a working directory beyond the session's cwd. The model is told about each added directory, and the
 * directory's context file (AGENTS.md or CLAUDE.md) is loaded like the ones above the cwd.
 *
 * Directories are stored as session entries, so they survive a resume and follow the session tree.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expandTildePath } from "../../config.ts";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { loadContextFileFromDir } from "../../core/resource-loader.ts";
import type { SessionEntry } from "../../core/session-manager.ts";
import { showReport } from "./report.ts";

export const ADD_DIR_ENTRY_TYPE = "claude-commands:add-dir";

interface AddDirData {
	path: string;
	removed?: boolean;
}

const SECTION_NAME = "additional_directories";

/** Registers /add-dir and the prompt section that describes the added directories. */
export function registerAddDir(pi: ExtensionAPI): void {
	let dirs: string[] = [];
	const restore = (ctx: ExtensionContext): void => {
		dirs = findAddedDirs(ctx.sessionManager.getBranch());
	};
	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", async (event) => {
		const sections = event.systemPromptOptions.sections;
		if (dirs.length === 0) {
			delete sections[SECTION_NAME];
			return;
		}
		sections[SECTION_NAME] = buildSection(dirs);
	});

	pi.registerCommand("add-dir", {
		description: "Add a working directory: /add-dir <path>; list with /add-dir, remove with /add-dir --remove <path>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				const markdown =
					dirs.length > 0
						? dirs.map((dir) => `- ${dir}`).join("\n")
						: "No directories added. Use `/add-dir <path>`.";
				showReport(pi, ctx, { title: "Additional directories", markdown });
				return;
			}
			const remove = trimmed.startsWith("--remove ");
			const path = resolve(ctx.cwd, expandTildePath(remove ? trimmed.slice("--remove ".length).trim() : trimmed));
			if (remove) {
				if (!dirs.includes(path)) {
					ctx.ui.notify(`${path} was not added`, "error");
					return;
				}
				pi.appendEntry<AddDirData>(ADD_DIR_ENTRY_TYPE, { path, removed: true });
				dirs = dirs.filter((dir) => dir !== path);
				ctx.ui.notify(`Removed ${path}`, "info");
				return;
			}
			if (!existsSync(path) || !statSync(path).isDirectory()) {
				ctx.ui.notify(`Not a directory: ${path}`, "error");
				return;
			}
			if (path === resolve(ctx.cwd) || dirs.includes(path)) {
				ctx.ui.notify(`${path} is already a working directory`, "info");
				return;
			}
			pi.appendEntry<AddDirData>(ADD_DIR_ENTRY_TYPE, { path });
			dirs = [...dirs, path];
			ctx.ui.notify(`Added ${path}. It applies from the next prompt.`, "info");
		},
	});
}

/** The directories added and not removed on this branch, in the order they were added. */
export function findAddedDirs(branch: readonly SessionEntry[]): string[] {
	const dirs: string[] = [];
	for (const entry of branch) {
		if (entry.type !== "custom" || entry.customType !== ADD_DIR_ENTRY_TYPE || !entry.data) continue;
		const data = entry.data as AddDirData;
		const index = dirs.indexOf(data.path);
		if (data.removed && index !== -1) dirs.splice(index, 1);
		if (!data.removed && index === -1) dirs.push(data.path);
	}
	return dirs;
}

function buildSection(dirs: readonly string[]): string {
	const parts = [
		"The user added these directories to the workspace, in addition to the current working directory. Read and edit files in them as part of the task when relevant; use absolute paths.",
		dirs.map((dir) => `- ${dir}`).join("\n"),
	];
	for (const dir of dirs) {
		// Read on every run so edits to the file apply without /reload, like the cwd's context files after /reload.
		const contextFile = loadContextFileFromDir(dir);
		if (contextFile) parts.push(`Instructions from ${contextFile.path}:\n\n${contextFile.content}`);
	}
	return parts.join("\n\n");
}
