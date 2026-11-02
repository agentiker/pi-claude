import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
	/** Alternative names, mostly Claude Code spellings such as `/clear` for `/new`. */
	aliases?: readonly string[];
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu", aliases: ["config"] },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
	{ name: "tree", description: "Navigate session tree (switch branches)", aliases: ["rewind"] },
	{ name: "thinking", description: "Set thinking level", argumentHint: "<level>", aliases: ["effort"] },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import a JSONL session, preserving its ID and working directory" },
	{ name: "share", description: "Share session via a Radius artifact or a GitHub gist" },
	{ name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name", aliases: ["rename"] },
	{ name: "session", description: "Show session info and stats", aliases: ["cost"] },
	{ name: "changelog", description: "Show changelog entries", aliases: ["release-notes"] },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "trust", description: "Save project trust decision for future sessions" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session", aliases: ["clear"] },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume another session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: `Quit ${APP_NAME}`, aliases: ["exit"] },
];

/** Every name a built-in command answers to, including aliases. */
export function getBuiltinSlashCommandNames(): Set<string> {
	return new Set(BUILTIN_SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
}

/** Rewrites a built-in alias invocation (`/clear`, `/effort high`) to its canonical command; other text is returned as is. */
export function resolveBuiltinSlashCommandAlias(text: string): string {
	const match = /^\/(\S+)(\s[\s\S]*)?$/.exec(text);
	if (!match) return text;
	const command = BUILTIN_SLASH_COMMANDS.find((candidate) => candidate.aliases?.includes(match[1]));
	return command ? `/${command.name}${match[2] ?? ""}` : text;
}
