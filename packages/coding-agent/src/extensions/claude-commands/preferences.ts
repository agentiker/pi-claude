/**
 * /theme and /keybindings: change the look and the key bindings without opening the settings menu.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../config.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";

/** Registers /theme and /keybindings. */
export function registerPreferences(pi: ExtensionAPI): void {
	pi.registerCommand("theme", {
		description: "Change the color theme: /theme [name]",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/theme needs interactive mode", "error");
				return;
			}
			const names = ctx.ui.getAllThemes().map((theme) => theme.name);
			const name = args.trim() || (await ctx.ui.select("Theme", names));
			if (!name) return;
			const result = ctx.ui.setTheme(name);
			ctx.ui.notify(
				result.success ? `Theme: ${name}` : `Theme not changed: ${result.error}`,
				result.success ? "info" : "error",
			);
		},
	});

	pi.registerCommand("keybindings", {
		description: "Edit keybindings.json, then reload it",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/keybindings needs interactive mode", "error");
				return;
			}
			const path = join(getAgentDir(), "keybindings.json");
			const edited = await ctx.ui.editor(`Edit ${path}`, existsSync(path) ? readFileSync(path, "utf-8") : "{\n}\n");
			if (edited === undefined) return;
			try {
				JSON.parse(edited);
			} catch (error) {
				ctx.ui.notify(
					`Not saved, invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			mkdirSync(getAgentDir(), { recursive: true });
			writeFileSync(path, edited.endsWith("\n") ? edited : `${edited}\n`);
			ctx.ui.notify(`Saved ${path}. Reloading.`, "info");
			await ctx.waitForIdle();
			// Reload replaces this extension's runtime; nothing may run after it in this handler.
			await ctx.reload();
		},
	});
}
