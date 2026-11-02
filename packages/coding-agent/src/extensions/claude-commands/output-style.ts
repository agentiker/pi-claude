/**
 * /output-style: change how the agent writes its answers. Built-in styles follow Claude Code (default, explanatory,
 * learning); custom styles are Markdown files in `<agentDir>/output-styles/` or `.pi/output-styles/` in the project,
 * named after the file, with an optional `description` in the frontmatter.
 *
 * The choice is saved in `<agentDir>/claude-commands.json` and applies to every session.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { readPreferences, updatePreferences } from "./config-files.ts";

export interface OutputStyle {
	name: string;
	description: string;
	prompt: string;
	source: string;
}

const BUILTIN_STYLES: readonly OutputStyle[] = [
	{ name: "default", description: "Concise answers focused on the task", prompt: "", source: "built-in" },
	{
		name: "explanatory",
		description: "Explains implementation choices and codebase patterns while working",
		source: "built-in",
		prompt: `Besides completing the task, help the user understand the codebase and your choices.
- Before and after writing code, add short "Insight" notes (two or three bullets) about the design choices, trade-offs, and codebase-specific patterns involved.
- Focus insights on this codebase and this change, not general programming knowledge.
- Keep insights in the conversation; do not write them into code or files.`,
	},
	{
		name: "learning",
		description: "Has the user write small, meaningful parts of the code to learn by doing",
		source: "built-in",
		prompt: `Work collaboratively so the user learns by doing.
- Share short "Insight" notes about design choices and codebase patterns, as in the explanatory style.
- For meaningful pieces of logic (a design decision, a non-trivial function body of 5 to 10 lines), do not write them yourself. Prepare the surrounding code, mark the spot with a TODO(human) comment, then stop and ask the user to write it, explaining what it should do and what to consider.
- Write boilerplate, wiring, and repetitive code yourself.
- After the user contributes, review it briefly and continue.`,
	},
];

const SECTION_NAME = "output_style";

/** Registers /output-style and applies the selected style to every run. */
export function registerOutputStyle(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event, ctx) => {
		const selected = readPreferences().outputStyle ?? "default";
		const style =
			selected === "default" ? undefined : listStyles(ctx).find((candidate) => candidate.name === selected);
		const sections = event.systemPromptOptions.sections;
		if (style?.prompt) {
			sections[SECTION_NAME] = `Output style "${style.name}":\n${style.prompt}`;
		} else {
			delete sections[SECTION_NAME];
		}
	});

	pi.registerCommand("output-style", {
		description: "Choose how the agent writes answers: /output-style [name]",
		getArgumentCompletions: (prefix) => {
			const items = BUILTIN_STYLES.filter((style) => style.name.startsWith(prefix.trim()));
			return items.length > 0 ? items.map((style) => ({ value: style.name, label: style.name })) : null;
		},
		handler: async (args, ctx) => {
			const styles = listStyles(ctx);
			let name = args.trim();
			if (!name) {
				const current = readPreferences().outputStyle ?? "default";
				const labels = styles.map(
					(style) =>
						`${style.name === current ? "● " : "  "}${style.name} - ${style.description} (${style.source})`,
				);
				const choice = await ctx.ui.select("Output style", labels);
				if (!choice) return;
				name = styles[labels.indexOf(choice)].name;
			}
			const style = styles.find((candidate) => candidate.name === name);
			if (!style) {
				ctx.ui.notify(
					`Unknown output style "${name}". Available: ${styles.map((s) => s.name).join(", ")}`,
					"error",
				);
				return;
			}
			updatePreferences({ outputStyle: style.name });
			ctx.ui.notify(`Output style: ${style.name}. It applies from the next prompt.`, "info");
		},
	});
}

/** Built-in styles followed by custom ones from the user and project directories; later names override earlier ones. */
export function listStyles(ctx: Pick<ExtensionContext, "cwd">): OutputStyle[] {
	const byName = new Map(BUILTIN_STYLES.map((style) => [style.name, style]));
	for (const dir of [join(getAgentDir(), "output-styles"), join(ctx.cwd, CONFIG_DIR_NAME, "output-styles")]) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
			const path = join(dir, file);
			const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf-8"));
			const name = basename(file, ".md");
			const description = typeof frontmatter.description === "string" ? frontmatter.description : "Custom style";
			byName.set(name, { name, description, prompt: body.trim(), source: path });
		}
	}
	return [...byName.values()];
}
