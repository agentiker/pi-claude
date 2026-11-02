/**
 * Report cards: command output (/help, /status, /context, ...) shown in the transcript but never sent to the model.
 * Reports are stored as custom session entries so they survive a resume, like the built-in /session output.
 */

import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { getMarkdownTheme } from "../../modes/interactive/theme/theme.ts";

export const REPORT_ENTRY_TYPE = "claude-commands:report";

export interface ReportData {
	title: string;
	markdown: string;
}

/** Registers the transcript renderer for report entries. */
export function registerReportRenderer(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<ReportData>(REPORT_ENTRY_TYPE, (entry, _options, theme) => {
		if (!entry.data) return undefined;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.bold(theme.fg("accent", entry.data.title)), 0, 0));
		box.addChild(new Spacer(1));
		box.addChild(new Markdown(entry.data.markdown, 0, 0, getMarkdownTheme()));
		return box;
	});
}

/** Shows a report: a transcript card in the TUI, a plain notification in other modes. */
export function showReport(pi: ExtensionAPI, ctx: ExtensionContext, report: ReportData): void {
	pi.appendEntry<ReportData>(REPORT_ENTRY_TYPE, report);
	if (ctx.mode !== "tui") ctx.ui.notify(`${report.title}\n\n${report.markdown}`, "info");
}
