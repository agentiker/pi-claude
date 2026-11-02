/**
 * /permissions: allow, ask about, or deny tool calls with rules, enforced on every tool call.
 *
 * Rules are `tool` or `tool(pattern)`, for example `bash(npm test:*)`, `edit(src/**)`, `read(~/.ssh/**)`, `mcp_*`.
 * Tool names match case-insensitively, so Claude Code spellings such as `Bash(...)` work too; an `edit` rule also
 * covers `write`. Patterns:
 * - bash: the command, with `*` as wildcard and a trailing `:*` meaning "this command with any arguments".
 *   Commands chained with `&&`, `||`, `;` or `|` are checked part by part, so an allow rule for `git status`
 *   does not approve `git status && rm -rf /`.
 * - file tools (read, edit, write, grep, find, ls): a glob over the absolute path; relative patterns resolve
 *   against the cwd and `~` expands to the home directory.
 * - other tools: a wildcard over the tool's JSON arguments.
 *
 * deny beats ask beats allow. Calls no rule matches follow `defaultMode`: "allow" (pi's behavior, the default)
 * runs them; "ask" asks before any tool that can change something, so read-only tools still run without asking.
 *
 * Rules live in `permissions.json` in the user's agent dir and in the project's `.pi` dir:
 * `{ "defaultMode": "ask", "allow": ["bash(npm test:*)"], "ask": [], "deny": ["read(.env)"] }`.
 */

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { minimatch } from "minimatch";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import {
	type ConfigScope,
	type ConfigSource,
	getConfigPath,
	readConfigSources,
	readJsonFile,
	writeJsonFile,
} from "./config-files.ts";
import { showReport } from "./report.ts";

export type RuleKind = "allow" | "ask" | "deny";
type DefaultMode = "allow" | "ask";

export interface PermissionsFile {
	defaultMode?: DefaultMode;
	allow?: string[];
	ask?: string[];
	deny?: string[];
}

export interface Rule {
	kind: RuleKind;
	raw: string;
	tool: string;
	pattern?: string;
	source: string;
}

export type Decision = { kind: RuleKind; rule?: Rule };

export interface Policy {
	defaultMode: DefaultMode;
	rules: Rule[];
}

const FILE_NAME = "permissions.json";
const RULE_KINDS: readonly RuleKind[] = ["deny", "ask", "allow"];
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILE_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);

/** Registers /permissions and the tool_call check that enforces the rules. */
export function registerPermissions(pi: ExtensionAPI): void {
	let sources: ConfigSource<PermissionsFile>[] = [];
	let policy: Policy = { defaultMode: "allow", rules: [] };
	const sessionRules: Rule[] = [];
	const load = (ctx: ExtensionContext): void => {
		sources = readConfigSources<PermissionsFile>(FILE_NAME, ctx);
		policy = buildPolicy(sources);
	};
	pi.on("session_start", async (_event, ctx) => load(ctx));

	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as Record<string, unknown>;
		const decision = decide({ ...policy, rules: [...policy.rules, ...sessionRules] }, event.toolName, input, ctx.cwd);
		if (decision.kind === "allow") return undefined;
		if (decision.kind === "deny") {
			return { block: true, reason: `Blocked by permission rule deny: ${decision.rule?.raw}` };
		}
		if (!ctx.hasUI) {
			return { block: true, reason: `${event.toolName} needs approval, but no user is available to approve it` };
		}
		const summary = summarizeCall(event.toolName, input);
		const choices = ["Yes", "Yes, and don't ask again this session", "Yes, and always allow in this project", "No"];
		const choice = await ctx.ui.select(`Allow ${summary}?`, choices);
		if (choice === choices[1] || choice === choices[2]) {
			const raw = suggestRule(event.toolName, input);
			sessionRules.push({ ...parseRule(raw, "allow"), source: "session" });
			if (choice === choices[2]) {
				addRule("project", "allow", raw, ctx);
				load(ctx);
			}
		}
		if (choice === undefined || choice === choices[3]) {
			return { block: true, reason: "The user declined this tool call. Ask how to proceed instead of retrying it." };
		}
		return undefined;
	});

	pi.registerCommand("permissions", {
		description:
			"Show or change tool permission rules: /permissions [allow|ask|deny|remove <rule>] [mode allow|ask] [--user]",
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);
			const scope: ConfigScope = words.includes("--user") ? "user" : "project";
			const [action, ...rest] = words.filter((word) => word !== "--user");
			const value = rest.join(" ");
			if (!action) {
				showReport(pi, ctx, { title: "Permissions", markdown: formatPolicy(sources, policy, sessionRules) });
				return;
			}
			if (scope === "project" && !ctx.isProjectTrusted()) {
				ctx.ui.notify("Project rules apply only to trusted projects. Run /trust first, or add --user.", "error");
				return;
			}
			const path = getConfigPath(scope, FILE_NAME, ctx);
			if (action === "mode" && (value === "allow" || value === "ask")) {
				writeJsonFile(path, { ...readJsonFile<PermissionsFile>(path), defaultMode: value });
			} else if ((action === "allow" || action === "ask" || action === "deny") && value) {
				addRule(scope, action, parseRule(value, action).raw, ctx);
			} else if (action === "remove" && value) {
				if (!removeRule(path, value)) {
					ctx.ui.notify(`No rule ${value} in ${path}`, "error");
					return;
				}
			} else {
				ctx.ui.notify("Usage: /permissions [allow|ask|deny|remove <rule>] [mode allow|ask] [--user]", "error");
				return;
			}
			load(ctx);
			ctx.ui.notify(`Updated ${path}`, "info");
		},
	});
}

/** Combines the files into one policy; the project's defaultMode overrides the user's. */
export function buildPolicy(sources: readonly ConfigSource<PermissionsFile>[]): Policy {
	let defaultMode: DefaultMode = "allow";
	const rules: Rule[] = [];
	for (const source of sources) {
		if (source.data.defaultMode === "ask" || source.data.defaultMode === "allow")
			defaultMode = source.data.defaultMode;
		for (const kind of RULE_KINDS) {
			for (const raw of source.data[kind] ?? []) rules.push({ ...parseRule(raw, kind), source: source.path });
		}
	}
	return { defaultMode, rules };
}

/** Parses `tool` or `tool(pattern)`; the tool name is lower-cased. */
export function parseRule(raw: string, kind: RuleKind): Rule {
	const trimmed = raw.trim();
	const match = /^([^()\s]+)(?:\((.*)\))?$/s.exec(trimmed);
	const tool = (match?.[1] ?? trimmed).toLowerCase();
	const pattern = match?.[2]?.trim() || undefined;
	return { kind, raw: pattern ? `${tool}(${pattern})` : tool, tool, pattern, source: "" };
}

/** The decision for one tool call: the strongest matching rule, or the default mode. */
export function decide(policy: Policy, toolName: string, input: Record<string, unknown>, cwd: string): Decision {
	const matching = (kind: RuleKind) =>
		policy.rules.filter((rule) => rule.kind === kind && toolMatches(rule, toolName));
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		const segments = splitCommand(command);
		// deny and ask apply when any part of a chained command matches.
		for (const kind of ["deny", "ask"] as const) {
			const rule = matching(kind).find((candidate) =>
				segments.some((segment) => commandMatches(candidate, segment)),
			);
			if (rule) return { kind, rule };
		}
		// allow applies only when every part is allowed. Command substitution can run anything, so only a
		// pattern-less bash rule approves it.
		const allow = matching("allow");
		const allowed = /\$\(|`/.test(command)
			? allow.some((rule) => !rule.pattern)
			: segments.length > 0 && segments.every((segment) => allow.some((rule) => commandMatches(rule, segment)));
		if (allowed) return { kind: "allow" };
	} else {
		for (const kind of RULE_KINDS) {
			const rule = matching(kind).find((candidate) => argumentsMatch(candidate, toolName, input, cwd));
			if (rule) return { kind, rule };
		}
	}
	if (policy.defaultMode === "allow" || READ_ONLY_TOOLS.has(toolName)) return { kind: "allow" };
	return { kind: "ask" };
}

function toolMatches(rule: Rule, toolName: string): boolean {
	return (
		rule.tool === toolName || (rule.tool === "edit" && toolName === "write") || wildcardMatch(rule.tool, toolName)
	);
}

/** Whether a bash rule covers one part of a command; a trailing `:*` means "with any arguments". */
function commandMatches(rule: Rule, segment: string): boolean {
	if (!rule.pattern) return true;
	if (!rule.pattern.endsWith(":*")) return wildcardMatch(rule.pattern, segment);
	const prefix = rule.pattern.slice(0, -2);
	return wildcardMatch(prefix, segment) || wildcardMatch(`${prefix} *`, segment);
}

function argumentsMatch(rule: Rule, toolName: string, input: Record<string, unknown>, cwd: string): boolean {
	if (!rule.pattern) return true;
	if (FILE_TOOLS.has(toolName)) {
		const path = resolve(cwd, typeof input.path === "string" ? input.path : ".");
		return minimatch(path, resolvePattern(rule.pattern, cwd), { dot: true });
	}
	return wildcardMatch(rule.pattern, JSON.stringify(input));
}

/** Splits a shell command on `&&`, `||`, `;`, `|` and newlines; quoting is not interpreted. */
export function splitCommand(command: string): string[] {
	return command
		.split(/&&|\|\||;|\||\n/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function wildcardMatch(pattern: string, value: string): boolean {
	const regex = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${regex}$`, "s").test(value);
}

function resolvePattern(pattern: string, cwd: string): string {
	if (pattern === "~" || pattern.startsWith("~/")) return homedir() + pattern.slice(1);
	return isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
}

/** A rule that approves calls like this one: the exact command for bash, the file for file tools. */
function suggestRule(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash" && typeof input.command === "string") return `bash(${input.command})`;
	if (FILE_TOOLS.has(toolName) && typeof input.path === "string") return `${toolName}(${input.path})`;
	return toolName;
}

function summarizeCall(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash" && typeof input.command === "string") return `bash: ${input.command}`;
	if (typeof input.path === "string") return `${toolName}: ${input.path}`;
	return toolName;
}

function addRule(scope: ConfigScope, kind: RuleKind, raw: string, ctx: ExtensionContext): void {
	const path = getConfigPath(scope, FILE_NAME, ctx);
	const file = readJsonFile<PermissionsFile>(path) ?? {};
	const rules = file[kind] ?? [];
	if (!rules.includes(raw)) writeJsonFile(path, { ...file, [kind]: [...rules, raw] });
}

function removeRule(path: string, raw: string): boolean {
	const file = readJsonFile<PermissionsFile>(path);
	if (!file) return false;
	const normalized = parseRule(raw, "allow").raw;
	let removed = false;
	const next: PermissionsFile = { ...file };
	for (const kind of RULE_KINDS) {
		const kept = (file[kind] ?? []).filter((rule) => parseRule(rule, kind).raw !== normalized);
		if (kept.length !== (file[kind] ?? []).length) removed = true;
		if (file[kind]) next[kind] = kept;
	}
	if (removed) writeJsonFile(path, next);
	return removed;
}

function formatPolicy(
	sources: readonly ConfigSource<PermissionsFile>[],
	policy: Policy,
	sessionRules: readonly Rule[],
): string {
	const lines = [
		`Default mode: **${policy.defaultMode}** (calls no rule matches ${policy.defaultMode === "allow" ? "run without asking" : "ask first, except read-only tools"})`,
	];
	for (const kind of RULE_KINDS) {
		const rules = [...policy.rules, ...sessionRules].filter((rule) => rule.kind === kind);
		if (rules.length === 0) continue;
		lines.push("", `**${kind}**`, ...rules.map((rule) => `- \`${rule.raw}\` (${rule.source})`));
	}
	lines.push("", `Files: ${sources.length > 0 ? sources.map((source) => source.path).join(", ") : "none yet"}`);
	lines.push(
		"Change with `/permissions allow|ask|deny <rule>`, `/permissions remove <rule>`, `/permissions mode allow|ask`; add `--user` for all projects.",
	);
	return lines.join("\n");
}
