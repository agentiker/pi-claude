/**
 * /memory: edit the context files pi loads into every session, or append a note to the project one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "../../config.ts";
import type { ExtensionCommandContext } from "../../core/extensions/types.ts";

/** `/memory` opens a picker and an editor; `/memory <note>` appends the note to the project context file. */
export async function runMemoryCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const projectFile = findContextFile(ctx, ctx.cwd);
	const note = args.trim();
	if (note) {
		const existing = existsSync(projectFile) ? readFileSync(projectFile, "utf-8") : "";
		const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
		writeContextFile(projectFile, `${existing}${separator}- ${note}\n`);
		await reloadContext(ctx, `Added to ${projectFile}`);
		return;
	}

	if (!ctx.hasUI) {
		ctx.ui.notify("Usage: /memory <note> (the editor needs interactive mode)", "error");
		return;
	}
	const userFile = findContextFile(ctx, getAgentDir());
	const projectChoice = `Project: ${projectFile}`;
	const choice = await ctx.ui.select("Edit which memory file?", [projectChoice, `User: ${userFile}`]);
	if (!choice) return;
	const file = choice === projectChoice ? projectFile : userFile;
	const edited = await ctx.ui.editor(`Edit ${file}`, existsSync(file) ? readFileSync(file, "utf-8") : "");
	if (edited === undefined) return;
	writeContextFile(file, edited);
	await reloadContext(ctx, `Saved ${file}`);
}

/** The context file pi already loads from `dir`, or AGENTS.md there when none exists yet. */
function findContextFile(ctx: ExtensionCommandContext, dir: string): string {
	const target = resolve(dir);
	const loaded = ctx.getSystemPromptOptions().contextFiles?.find((file) => dirname(resolve(file.path)) === target);
	return loaded?.path ?? join(target, "AGENTS.md");
}

function writeContextFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

async function reloadContext(ctx: ExtensionCommandContext, message: string): Promise<void> {
	ctx.ui.notify(`${message}. Reloading context files.`, "info");
	await ctx.waitForIdle();
	// Reload replaces this extension's runtime; nothing may run after it in this handler.
	await ctx.reload();
}
