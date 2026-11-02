/**
 * Hooks: shell commands that run on agent events, configured in `hooks.json` in the user's agent dir and in the
 * project's `.pi` dir. The format is the `hooks` object of Claude Code settings, so existing hook setups carry over:
 *
 * `{ "hooks": { "PostToolUse": [{ "matcher": "edit|write", "hooks": [{ "type": "command", "command": "npm run lint" }] }] } }`
 *
 * Events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, SessionEnd, PreCompact. The matcher is a
 * case-insensitive regular expression over the tool name (pi's names: bash, read, edit, write, ...); empty or "*"
 * matches everything. Each command gets the event as JSON on stdin and runs in the session's cwd.
 *
 * Exit code 0 succeeds; stdout may be JSON with `decision: "block"` and `reason`. Exit code 2 blocks with stderr as
 * the reason: PreToolUse blocks the call, PostToolUse and Stop send the reason back to the model, UserPromptSubmit
 * drops the prompt. Other exit codes are reported as warnings. Plain stdout of UserPromptSubmit and SessionStart is
 * added to the context.
 */

import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { type ConfigSource, getConfigPath, readConfigSources, readJsonFile, writeJsonFile } from "./config-files.ts";
import { showReport } from "./report.ts";
import { runShellCommand } from "./shell.ts";

export const HOOK_EVENTS = [
	"PreToolUse",
	"PostToolUse",
	"UserPromptSubmit",
	"Stop",
	"SessionStart",
	"SessionEnd",
	"PreCompact",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

interface HookCommand {
	type: "command";
	command: string;
	/** Seconds; default 60. */
	timeout?: number;
}

interface HookMatcher {
	matcher?: string;
	hooks: HookCommand[];
}

export interface HooksFile {
	hooks?: Partial<Record<HookEvent, HookMatcher[]>>;
}

/** What a hook asked for: nothing, block with a reason, or extra context for the model. */
export type HookOutcome = { type: "ok"; context?: string } | { type: "block"; reason: string };

const FILE_NAME = "hooks.json";
const HOOK_MESSAGE_TYPE = "claude-commands:hook";
// A Stop hook that always blocks would keep the agent running forever.
const MAX_STOP_CONTINUATIONS = 5;

/** Registers /hooks and runs configured hooks on the matching agent events. */
export function registerHooks(pi: ExtensionAPI): void {
	let sources: ConfigSource<HooksFile>[] = [];
	let stopContinuations = 0;

	const run = (event: HookEvent, ctx: ExtensionContext, payload: Record<string, unknown>, matchValue = "") =>
		runHooks(
			sources,
			event,
			matchValue,
			{
				...payload,
				hook_event_name: event,
				session_id: ctx.sessionManager.getSessionId(),
				transcript_path: ctx.sessionManager.getSessionFile(),
				cwd: ctx.cwd,
			},
			ctx,
		);

	pi.on("session_start", async (event, ctx) => {
		sources = readConfigSources<HooksFile>(FILE_NAME, ctx);
		const outcome = await run("SessionStart", ctx, { source: event.reason });
		if (outcome.type === "ok" && outcome.context) {
			pi.sendMessage(
				{ customType: HOOK_MESSAGE_TYPE, content: outcome.context, display: false },
				{ deliverAs: "nextTurn" },
			);
		}
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		await run("SessionEnd", ctx, {});
	});
	pi.on("session_before_compact", async (event, ctx) => {
		await run("PreCompact", ctx, { trigger: event.reason }, event.reason);
	});

	pi.on("tool_call", async (event, ctx) => {
		const outcome = await run(
			"PreToolUse",
			ctx,
			{ tool_name: event.toolName, tool_input: event.input },
			event.toolName,
		);
		return outcome.type === "block"
			? { block: true, reason: `Blocked by PreToolUse hook: ${outcome.reason}` }
			: undefined;
	});
	pi.on("tool_result", async (event, ctx) => {
		const text = event.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
		const outcome = await run(
			"PostToolUse",
			ctx,
			{
				tool_name: event.toolName,
				tool_input: event.input,
				tool_response: { content: text, is_error: event.isError },
			},
			event.toolName,
		);
		if (outcome.type !== "block") return undefined;
		return {
			content: [...event.content, { type: "text" as const, text: `PostToolUse hook feedback: ${outcome.reason}` }],
		};
	});

	pi.on("input", async (event, ctx) => {
		// Prompts the extension sends itself (loops, commands) were already submitted by the user once.
		if (event.source === "extension") return { action: "continue" as const };
		const outcome = await run("UserPromptSubmit", ctx, { prompt: event.text });
		if (outcome.type === "block") {
			ctx.ui.notify(`Prompt blocked by UserPromptSubmit hook: ${outcome.reason}`, "warning");
			return { action: "handled" as const };
		}
		return outcome.context
			? { action: "transform" as const, text: `${event.text}\n\n${outcome.context}` }
			: { action: "continue" as const };
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		const outcome = await run("Stop", ctx, { stop_hook_active: stopContinuations > 0 });
		if (outcome.type !== "block" || stopContinuations >= MAX_STOP_CONTINUATIONS) return undefined;
		stopContinuations++;
		return {
			entries: [
				...event.entries,
				{
					type: "custom_message" as const,
					customType: HOOK_MESSAGE_TYPE,
					content: `Stop hook: ${outcome.reason}`,
					display: true,
				},
			],
			continue: true,
		};
	});
	pi.on("agent_settled", async () => {
		stopContinuations = 0;
	});

	pi.registerCommand("hooks", {
		description: "Show configured hooks; edit them with /hooks edit [user|project]",
		handler: async (args, ctx) => {
			const [action, scopeArg] = args.trim().split(/\s+/);
			if (action !== "edit") {
				showReport(pi, ctx, { title: "Hooks", markdown: formatHooks(sources, ctx) });
				return;
			}
			const scope = scopeArg === "user" ? "user" : "project";
			if (scope === "project" && !ctx.isProjectTrusted()) {
				ctx.ui.notify(
					"Project hooks run only in trusted projects. Run /trust first, or use /hooks edit user.",
					"error",
				);
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("/hooks edit needs interactive mode", "error");
				return;
			}
			const path = getConfigPath(scope, FILE_NAME, ctx);
			const current = readJsonFile<HooksFile>(path) ?? { hooks: {} };
			const edited = await ctx.ui.editor(`Edit ${path}`, `${JSON.stringify(current, null, "\t")}\n`);
			if (edited === undefined) return;
			let parsed: HooksFile;
			try {
				parsed = JSON.parse(edited) as HooksFile;
			} catch (error) {
				ctx.ui.notify(
					`Not saved, invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			const unknown = Object.keys(parsed.hooks ?? {}).filter(
				(name) => !(HOOK_EVENTS as readonly string[]).includes(name),
			);
			if (unknown.length > 0) ctx.ui.notify(`Unknown hook events, ignored: ${unknown.join(", ")}`, "warning");
			writeJsonFile(path, parsed);
			sources = readConfigSources<HooksFile>(FILE_NAME, ctx);
			ctx.ui.notify(`Saved ${path}`, "info");
		},
	});
}

/** Runs every hook of `event` whose matcher accepts `matchValue`; the first block wins, contexts are joined. */
export async function runHooks(
	sources: readonly ConfigSource<HooksFile>[],
	event: HookEvent,
	matchValue: string,
	payload: Record<string, unknown>,
	ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">,
): Promise<HookOutcome> {
	const commands = sources.flatMap((source) =>
		(source.data.hooks?.[event] ?? [])
			.filter((entry) => matcherAccepts(entry.matcher, matchValue))
			.flatMap((entry) => entry.hooks),
	);
	const contexts: string[] = [];
	for (const hook of commands) {
		if (hook.type !== "command" || !hook.command) continue;
		const result = await runShellCommand(hook.command, JSON.stringify(payload), ctx.cwd, (hook.timeout ?? 60) * 1000);
		if (result.code === 2) return { type: "block", reason: result.stderr.trim() || "no reason given" };
		if (result.code !== 0) {
			if (ctx.hasUI)
				ctx.ui.notify(
					`${event} hook failed (${hook.command}): ${result.stderr.trim() || `exit ${result.code}`}`,
					"warning",
				);
			continue;
		}
		const output = parseHookOutput(result.stdout);
		if (output.type === "block") return output;
		if (output.context) contexts.push(output.context);
	}
	return { type: "ok", context: contexts.length > 0 ? contexts.join("\n\n") : undefined };
}

function matcherAccepts(matcher: string | undefined, value: string): boolean {
	if (!matcher || matcher === "*") return true;
	try {
		return new RegExp(`^(?:${matcher})$`, "i").test(value);
	} catch {
		// An invalid regular expression falls back to a plain name comparison.
		return matcher.toLowerCase() === value.toLowerCase();
	}
}

/** Reads a successful hook's stdout: JSON asking to block, JSON with additionalContext, or plain text context. */
function parseHookOutput(stdout: string): HookOutcome {
	const text = stdout.trim();
	if (!text) return { type: "ok" };
	if (!text.startsWith("{")) return { type: "ok", context: text };
	try {
		const json = JSON.parse(text) as {
			decision?: string;
			reason?: string;
			continue?: boolean;
			stopReason?: string;
			hookSpecificOutput?: {
				permissionDecision?: string;
				permissionDecisionReason?: string;
				additionalContext?: string;
			};
		};
		if (json.decision === "block") return { type: "block", reason: json.reason ?? "blocked by hook" };
		if (json.continue === false) return { type: "block", reason: json.stopReason ?? "stopped by hook" };
		const specific = json.hookSpecificOutput;
		if (specific?.permissionDecision === "deny") {
			return { type: "block", reason: specific.permissionDecisionReason ?? "denied by hook" };
		}
		return { type: "ok", context: specific?.additionalContext };
	} catch {
		return { type: "ok", context: text };
	}
}

function formatHooks(
	sources: readonly ConfigSource<HooksFile>[],
	ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): string {
	const lines: string[] = [];
	for (const source of sources) {
		for (const event of HOOK_EVENTS) {
			for (const entry of source.data.hooks?.[event] ?? []) {
				for (const hook of entry.hooks) {
					lines.push(
						`- **${event}**${entry.matcher ? ` \`${entry.matcher}\`` : ""}: \`${hook.command}\` (${source.scope})`,
					);
				}
			}
		}
	}
	const files = [getConfigPath("user", FILE_NAME, ctx), getConfigPath("project", FILE_NAME, ctx)];
	const trustNote = ctx.isProjectTrusted() ? "" : " Project hooks are skipped until you /trust this project.";
	return `${lines.length > 0 ? lines.join("\n") : "No hooks configured."}\n\nFiles: ${files.join(", ")}.${trustNote}\nEdit with \`/hooks edit [user|project]\`. Events: ${HOOK_EVENTS.join(", ")}.`;
}
