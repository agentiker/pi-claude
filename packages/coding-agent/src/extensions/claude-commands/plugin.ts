/**
 * /plugin and /upgrade: manage pi packages (extensions, skills, prompts and themes shipped as npm or git packages)
 * and update pi itself, by running pi's own `install`, `remove`, `update` and `list` commands.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { runPiCommand } from "./pi-process.ts";
import { showReport } from "./report.ts";

const USAGE =
	"Usage: /plugin [list], /plugin install <source> [-l], /plugin remove <source> [-l], /plugin update [source]";

/** Registers /plugin and /upgrade. */
export function registerPlugin(pi: ExtensionAPI): void {
	pi.registerCommand("plugin", {
		description: "Manage pi packages: /plugin [list|install|remove|update] [source] [-l for this project only]",
		getArgumentCompletions: (prefix) => {
			const actions = ["list", "install", "remove", "update"].filter((action) => action.startsWith(prefix.trim()));
			return actions.length > 0 ? actions.map((action) => ({ value: action, label: action })) : null;
		},
		handler: async (args, ctx) => {
			const [action = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const command = action === "uninstall" ? "remove" : action;
			if (command === "list") {
				await runAndReport(pi, ctx, "Packages", ["list"]);
				return;
			}
			if ((command === "install" || command === "remove") && rest.some((word) => !word.startsWith("-"))) {
				const ok = await runAndReport(pi, ctx, `${command} ${rest.join(" ")}`, [command, ...rest]);
				if (ok) await reloadResources(ctx);
				return;
			}
			if (command === "update") {
				const ok = await runAndReport(pi, ctx, "Update packages", [
					"update",
					...(rest.length > 0 ? rest : ["--extensions"]),
				]);
				if (ok) await reloadResources(ctx);
				return;
			}
			ctx.ui.notify(USAGE, "error");
		},
	});

	pi.registerCommand("upgrade", {
		description: "Update pi to the latest version",
		handler: async (_args, ctx) => {
			const ok = await runAndReport(pi, ctx, "Upgrade pi", ["update", "--self"]);
			if (ok) ctx.ui.notify("Restart pi to run the new version.", "info");
		},
	});
}

/** Runs `pi <args>` with the session's project trust, shows its output as a report, and returns whether it succeeded. */
async function runAndReport(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	title: string,
	args: string[],
): Promise<boolean> {
	ctx.ui.notify(`Running pi ${args.join(" ")}...`, "info");
	const trust = ctx.isProjectTrusted() ? "--approve" : "--no-approve";
	const result = await runPiCommand([...args, trust], ctx.cwd, ctx.signal);
	const output = result.output.trim() || "(no output)";
	const status = result.code === 0 ? "" : `\n\nFailed with exit code ${result.code}.`;
	showReport(pi, ctx, { title, markdown: `\`\`\`\n${output}\n\`\`\`${status}` });
	return result.code === 0;
}

async function reloadResources(ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	// Reload replaces this extension's runtime; nothing may run after it in this handler.
	await ctx.reload();
}
