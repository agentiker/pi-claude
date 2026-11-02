/**
 * /loop: run a prompt or command on a fixed interval while the session is open, for example
 * `/loop 5m check whether the deploy finished` or `/loop 30m /review`.
 *
 * A run that comes due while the agent is busy waits until it settles, so a loop never interrupts work and
 * never queues more than one pending run.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import { showReport } from "./report.ts";

interface Loop {
	id: number;
	intervalMs: number;
	prompt: string;
	timer: ReturnType<typeof setInterval>;
	pending: boolean;
	runs: number;
}

const DEFAULT_INTERVAL_MS = 10 * 60_000;
const MIN_INTERVAL_MS = 10_000;
const STATUS_KEY = "claude-commands:loop";

/** Registers /loop and the event handlers that run due loops and stop them with the session. */
export function registerLoop(pi: ExtensionAPI): void {
	const loops = new Map<number, Loop>();
	let nextId = 1;

	const runOrDefer = (loop: Loop, ctx: ExtensionContext): void => {
		if (!ctx.isIdle()) {
			loop.pending = true;
			return;
		}
		loop.pending = false;
		loop.runs++;
		pi.sendUserMessage(loop.prompt, { expandPromptTemplates: true });
	};

	const updateStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, loops.size > 0 ? `⟳ ${loops.size} loop${loops.size === 1 ? "" : "s"}` : undefined);
	};

	const stop = (ids: readonly number[], ctx: ExtensionContext): void => {
		for (const id of ids) {
			clearInterval(loops.get(id)?.timer);
			loops.delete(id);
		}
		updateStatus(ctx);
	};

	pi.on("agent_settled", async (_event, ctx) => {
		// One run per settle: the run itself makes the agent busy, and the next settle picks up the next pending loop.
		const due = [...loops.values()].find((loop) => loop.pending);
		if (due) runOrDefer(due, ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => stop([...loops.keys()], ctx));

	pi.registerCommand("loop", {
		description: "Run a prompt on an interval: /loop [5m] <prompt>, /loop list, /loop stop [id|all]",
		handler: async (args, ctx) => {
			const [action, target] = args.trim().split(/\s+/);
			if (!action || action === "list") {
				showReport(pi, ctx, { title: "Loops", markdown: formatLoops(loops) });
				return;
			}
			if (action === "stop") {
				const ids =
					!target || target === "all" ? [...loops.keys()] : [Number(target)].filter((id) => loops.has(id));
				if (ids.length === 0) {
					ctx.ui.notify(`No loop ${target}`, "error");
					return;
				}
				stop(ids, ctx);
				ctx.ui.notify(`Stopped ${ids.length} loop${ids.length === 1 ? "" : "s"}`, "info");
				return;
			}
			startLoop(args, ctx);
		},
	});

	function startLoop(args: string, ctx: ExtensionCommandContext): void {
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
			ctx.ui.notify("/loop needs a long-running session (interactive or RPC mode)", "error");
			return;
		}
		const parsed = parseLoopArgs(args);
		if (parsed.type === "error") {
			ctx.ui.notify(parsed.message, "error");
			return;
		}
		const id = nextId++;
		const loop: Loop = {
			id,
			intervalMs: parsed.intervalMs,
			prompt: parsed.prompt,
			// Unref: an idle loop must not keep the process alive on its own.
			timer: setInterval(() => runOrDefer(loop, ctx), parsed.intervalMs).unref(),
			pending: false,
			runs: 0,
		};
		loops.set(id, loop);
		updateStatus(ctx);
		ctx.ui.notify(`Loop ${id}: every ${formatInterval(loop.intervalMs)}. Stop with /loop stop ${id}`, "info");
		runOrDefer(loop, ctx);
	}
}

type ParsedLoopArgs = { type: "ok"; intervalMs: number; prompt: string } | { type: "error"; message: string };

/** Parses `[interval] <prompt>`; the interval is a number with s, m, h or d and defaults to 10 minutes. */
export function parseLoopArgs(args: string): ParsedLoopArgs {
	const trimmed = args.trim();
	const match = /^(\d+)([smhd])\s+([\s\S]+)$/.exec(trimmed);
	const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
	const intervalMs = match ? Number(match[1]) * units[match[2]] : DEFAULT_INTERVAL_MS;
	const prompt = match ? match[3].trim() : trimmed;
	if (!prompt)
		return { type: "error", message: "Usage: /loop [interval] <prompt>, for example /loop 5m check the build" };
	if (intervalMs < MIN_INTERVAL_MS) {
		return { type: "error", message: `The interval must be at least ${formatInterval(MIN_INTERVAL_MS)}` };
	}
	return { type: "ok", intervalMs, prompt };
}

function formatLoops(loops: ReadonlyMap<number, Loop>): string {
	if (loops.size === 0) return "No loops running. Start one with `/loop 5m <prompt>`.";
	const lines = [...loops.values()].map(
		(loop) =>
			`- **${loop.id}** every ${formatInterval(loop.intervalMs)}, ${loop.runs} run${loop.runs === 1 ? "" : "s"}${loop.pending ? ", waiting for the agent" : ""}: ${loop.prompt}`,
	);
	return `${lines.join("\n")}\n\nStop with \`/loop stop <id>\` or \`/loop stop all\`.`;
}

function formatInterval(ms: number): string {
	if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
	if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
	if (ms % 60_000 === 0) return `${ms / 60_000}m`;
	return `${Math.round(ms / 1000)}s`;
}
