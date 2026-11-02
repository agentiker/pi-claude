/**
 * /statusline: show the output of a shell command in the footer, refreshed as the session changes.
 *
 * The command gets JSON on stdin with `session_id`, `cwd`, `model` (`id`, `provider`, `display_name`), `thinking`
 * and `context` (`tokens`, `window`, `percent`), and its first output line is shown. It is saved in the extension's
 * preferences and applies to every session.
 */

import { isUnknownModel } from "../../core/auth-guidance.ts";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { readPreferences, updatePreferences } from "./config-files.ts";
import { showReport } from "./report.ts";
import { runShellCommand } from "./shell.ts";

const STATUS_KEY = "claude-commands:statusline";
const TIMEOUT_MS = 5000;

/** Registers /statusline and refreshes the status line on session, turn and model changes. */
export function registerStatusLine(pi: ExtensionAPI): void {
	let running = false;
	let dirty = false;
	// False between session_shutdown and the next session_start: a refresh still running then must not touch its
	// context, which is stale once the session is gone.
	let active = false;

	const refresh = async (ctx: ExtensionContext): Promise<void> => {
		if (!active || !ctx.hasUI) return;
		const command = readPreferences().statusLine;
		if (!command) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		// One run at a time; changes during a run trigger exactly one more run afterwards.
		if (running) {
			dirty = true;
			return;
		}
		running = true;
		try {
			const text = await renderStatusLine(command, ctx);
			if (active) ctx.ui.setStatus(STATUS_KEY, text || undefined);
		} finally {
			running = false;
		}
		if (dirty) {
			dirty = false;
			await refresh(ctx);
		}
	};

	// Not awaited, so a slow command never holds up the session or the agent loop. A failure only loses one
	// refresh and must not surface as an unhandled rejection, which would end the process.
	const schedule = (ctx: ExtensionContext): void => {
		refresh(ctx).catch(() => {});
	};
	pi.on("session_start", (_event, ctx) => {
		active = true;
		schedule(ctx);
	});
	pi.on("session_shutdown", () => {
		active = false;
	});
	pi.on("turn_end", (_event, ctx) => schedule(ctx));
	pi.on("agent_settled", (_event, ctx) => schedule(ctx));
	pi.on("model_select", (_event, ctx) => schedule(ctx));
	pi.on("thinking_level_select", (_event, ctx) => schedule(ctx));

	pi.registerCommand("statusline", {
		description: "Show a shell command's output in the footer: /statusline <command>, /statusline off",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				const command = readPreferences().statusLine;
				const markdown = command
					? `Command: \`${command}\`\n\nOutput: ${(await renderStatusLine(command, ctx)) || "(empty)"}`
					: "No status line configured. Set one with `/statusline <command>`, for example `/statusline git branch --show-current`.";
				showReport(pi, ctx, { title: "Status line", markdown });
				return;
			}
			updatePreferences({ statusLine: value === "off" ? undefined : value });
			ctx.ui.notify(value === "off" ? "Status line removed" : "Status line set", "info");
			await refresh(ctx);
		},
	});
}

/** Runs the command with the session state on stdin and returns its first output line, or the error. */
async function renderStatusLine(command: string, ctx: ExtensionContext): Promise<string> {
	const model = isUnknownModel(ctx.model) ? undefined : ctx.model;
	const usage = ctx.getContextUsage();
	const payload = {
		session_id: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		workspace: { current_dir: ctx.cwd },
		model: model ? { id: model.id, provider: model.provider, display_name: model.name } : null,
		thinking: ctx.thinkingLevel ?? "off",
		context: usage ? { tokens: usage.tokens, window: usage.contextWindow, percent: usage.percent } : null,
	};
	const result = await runShellCommand(command, JSON.stringify(payload), ctx.cwd, TIMEOUT_MS);
	if (result.code !== 0) return `statusline error: ${result.stderr.trim().split("\n")[0] || `exit ${result.code}`}`;
	return result.stdout.split("\n").find((line) => line.trim()) ?? "";
}
