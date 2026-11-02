/**
 * /help and /skills: list what the user can invoke in this session.
 */

import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import type { Skill } from "../../core/skills.ts";
import { BUILTIN_SLASH_COMMANDS, type SlashCommandInfo } from "../../core/slash-commands.ts";

/** Markdown listing built-in commands with their aliases, then extension commands, prompt templates and skills. */
export function buildHelpMarkdown(commands: readonly SlashCommandInfo[]): string {
	const sections = [
		formatSection(
			"Built-in",
			BUILTIN_SLASH_COMMANDS.map((command) => {
				const aliases = command.aliases?.length
					? ` (alias: ${command.aliases.map((a) => `/${a}`).join(", ")})`
					: "";
				return `\`/${command.name}\`${aliases} - ${command.description}`;
			}),
		),
		formatSection("Extension commands", listBySource(commands, "extension")),
		formatSection("Prompt templates", listBySource(commands, "prompt")),
		formatSection("Skills", listBySource(commands, "skill")),
	];
	return `${sections.filter((section) => section !== undefined).join("\n\n")}\n\nType \`!command\` to run a shell command, \`!!command\` to run it without adding the output to the context.`;
}

/** Markdown listing the skills loaded into the system prompt. */
export function buildSkillsMarkdown(skills: readonly Skill[]): string {
	if (skills.length === 0) {
		return `No skills loaded. Add skills under \`${join(getAgentDir(), "skills")}\` or \`${join(CONFIG_DIR_NAME, "skills")}\` in the project, then run \`/reload\`.`;
	}
	const lines = skills.map((skill) => {
		const invocation = skill.disableModelInvocation ? " (user-invocable only)" : "";
		return `- \`/skill:${skill.name}\`${invocation} - ${skill.description}\n  ${skill.filePath}`;
	});
	return `${skills.length} skill${skills.length === 1 ? "" : "s"} loaded:\n\n${lines.join("\n")}`;
}

function listBySource(commands: readonly SlashCommandInfo[], source: SlashCommandInfo["source"]): string[] {
	return commands
		.filter((command) => command.source === source)
		.map((command) => `\`/${command.name}\`${command.description ? ` - ${command.description}` : ""}`);
}

function formatSection(title: string, lines: string[]): string | undefined {
	if (lines.length === 0) return undefined;
	return `**${title}**\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
}
