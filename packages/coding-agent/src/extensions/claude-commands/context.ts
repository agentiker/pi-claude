/**
 * /context: how the model's context window is spent, split into system prompt, context files, skills,
 * tool definitions and conversation.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens } from "../../core/compaction/compaction.ts";
import type { ContextUsage } from "../../core/extensions/types.ts";
import { formatSkillsForPrompt, type Skill } from "../../core/skills.ts";
import { formatTokens } from "../../modes/interactive/components/footer.ts";

export interface ContextReportInput {
	modelLabel: string | undefined;
	usage: ContextUsage | undefined;
	systemPrompt: string;
	contextFiles: ReadonlyArray<{ path: string; content: string }>;
	skills: readonly Skill[];
	tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>;
	messages: readonly AgentMessage[];
}

/** Markdown with a usage bar and an estimated breakdown per category. */
export function buildContextMarkdown(input: ContextReportInput): string {
	const contextFileTokens = input.contextFiles.reduce((sum, file) => sum + estimateTextTokens(file.content), 0);
	const skillTokens = input.skills.length > 0 ? estimateTextTokens(formatSkillsForPrompt([...input.skills])) : 0;
	const systemTokens = Math.max(0, estimateTextTokens(input.systemPrompt) - contextFileTokens - skillTokens);
	const toolTokens = input.tools.reduce(
		(sum, tool) => sum + estimateTextTokens(tool.name + tool.description + JSON.stringify(tool.parameters)),
		0,
	);
	const messageTokens = input.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
	const estimatedTotal = systemTokens + contextFileTokens + skillTokens + toolTokens + messageTokens;

	const window = input.usage?.contextWindow ?? 0;
	// The provider-reported count is exact as of the last response; fall back to the estimate before the first one.
	const used = input.usage?.tokens ?? estimatedTotal;
	const lines: string[] = [];
	lines.push(`Model: ${input.modelLabel ?? "none"}`);
	if (window > 0) {
		lines.push(
			`\`${formatBar(used / window)}\` ${formatTokens(used)} / ${formatTokens(window)} tokens (${((used / window) * 100).toFixed(1)}%)`,
		);
	} else {
		lines.push(`${formatTokens(used)} tokens used (context window unknown)`);
	}
	lines.push("");
	lines.push("| Category | Tokens (est.) |");
	lines.push("| --- | ---: |");
	lines.push(`| System prompt | ${formatTokens(systemTokens)} |`);
	lines.push(`| Context files (${input.contextFiles.length}) | ${formatTokens(contextFileTokens)} |`);
	lines.push(`| Skills (${input.skills.length}) | ${formatTokens(skillTokens)} |`);
	lines.push(`| Tool definitions (${input.tools.length}) | ${formatTokens(toolTokens)} |`);
	lines.push(`| Messages (${input.messages.length}) | ${formatTokens(messageTokens)} |`);
	if (window > 0) lines.push(`| Free | ${formatTokens(Math.max(0, window - used))} |`);

	if (input.contextFiles.length > 0) {
		lines.push("");
		lines.push("Context files:");
		for (const file of input.contextFiles) {
			lines.push(`- ${file.path} (${formatTokens(estimateTextTokens(file.content))})`);
		}
	}
	lines.push("");
	lines.push("Category sizes are estimates (about 4 characters per token). Run `/compact` to free space.");
	return lines.join("\n");
}

const BAR_WIDTH = 30;

function formatBar(fraction: number): string {
	const filled = Math.min(BAR_WIDTH, Math.round(fraction * BAR_WIDTH));
	return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
