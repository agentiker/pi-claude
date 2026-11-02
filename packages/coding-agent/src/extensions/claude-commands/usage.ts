/**
 * /usage: tokens and cost across all local sessions for today, the last 7 days and all time, per model.
 *
 * Claude Code's /usage shows subscription limits; pi bills through each provider, so the useful local equivalent is
 * what the session files record. Entries copied into forks are counted once.
 */

import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { loadEntriesFromFile, type SessionEntry, SessionManager } from "../../core/session-manager.ts";
import { getUsageCostBreakdown } from "../../core/usage-totals.ts";
import { formatTokens } from "../../modes/interactive/components/footer.ts";
import { showReport } from "./report.ts";

const DAY_MS = 86_400_000;

/** Registers /usage. */
export function registerUsage(pi: ExtensionAPI): void {
	pi.registerCommand("usage", {
		description: "Show token usage and cost across all sessions: today, last 7 days, all time",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Reading sessions...", "info");
			const sessions = await SessionManager.listAll(undefined, ctx.signal);
			const entries = collectEntries(sessions.map((session) => session.path));
			showReport(pi, ctx, { title: "Usage", markdown: buildUsageMarkdown(entries, Date.now(), sessions.length) });
		},
	});
}

/** All session entries of the files, each entry id once. */
function collectEntries(paths: readonly string[]): SessionEntry[] {
	const seen = new Set<string>();
	const entries: SessionEntry[] = [];
	for (const path of paths) {
		for (const entry of loadEntriesFromFile(path)) {
			if (entry.type === "session" || seen.has(entry.id)) continue;
			seen.add(entry.id);
			entries.push(entry);
		}
	}
	return entries;
}

/** Markdown with one table per period: cost and tokens per model and in total. */
export function buildUsageMarkdown(entries: readonly SessionEntry[], now: number, sessionCount: number): string {
	const startOfToday = new Date(now).setHours(0, 0, 0, 0);
	const periods: Array<[string, number]> = [
		["Today", startOfToday],
		["Last 7 days", now - 7 * DAY_MS],
		["All time", 0],
	];
	const sections = periods.map(([title, since]) => {
		const breakdown = getUsageCostBreakdown(entries.filter((entry) => Date.parse(entry.timestamp) >= since));
		if (breakdown.length === 0) return `**${title}**: no usage`;
		const cost = breakdown.reduce((sum, row) => sum + row.cost, 0);
		const tokens = breakdown.reduce((sum, row) => sum + row.tokens, 0);
		const rows = breakdown.map((row) => `| ${row.key} | ${formatTokens(row.tokens)} | $${row.cost.toFixed(2)} |`);
		return [
			`**${title}**: ${formatTokens(tokens)} tokens, $${cost.toFixed(2)}`,
			"",
			"| Model | Tokens | Cost |",
			"| --- | ---: | ---: |",
			...rows,
		].join("\n");
	});
	return `${sections.join("\n\n")}\n\nFrom ${sessionCount} session file${sessionCount === 1 ? "" : "s"}. Costs use pi's model prices and are estimates.`;
}
