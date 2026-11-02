/**
 * Claude Code style slash commands for pi. The CLI loads this as a built-in extension.
 *
 * Commands that report on the session (/help, /status, /context, /doctor, /skills) print a card that is not sent to
 * the model. Commands that hand a task to the agent (/init, /review, ...) send a prompt as a follow-up turn. Features
 * with their own state live in their own modules (/todos, /loop, /add-dir, /output-style, /theme, /keybindings,
 * /hooks, /permissions, /agents, /plugin, /upgrade, /vim, /statusline, /terminal-setup, /usage).
 * Plain renames of built-in commands (/clear, /exit, /config, ...) are aliases in core/slash-commands.ts.
 */

import { Text } from "@earendil-works/pi-tui";
import { isUnknownModel } from "../../core/auth-guidance.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionFactory } from "../../core/extensions/types.ts";
import { registerAddDir } from "./add-dir.ts";
import { registerAgents } from "./agents.ts";
import { runBtwCommand } from "./btw.ts";
import { buildContextMarkdown } from "./context.ts";
import { buildHelpMarkdown, buildSkillsMarkdown } from "./help.ts";
import { registerHooks } from "./hooks.ts";
import { registerLoop } from "./loop.ts";
import { runMemoryCommand } from "./memory.ts";
import { registerOutputStyle } from "./output-style.ts";
import { registerPermissions } from "./permissions.ts";
import { registerPlugin } from "./plugin.ts";
import { registerPreferences } from "./preferences.ts";
import {
	buildInitPrompt,
	buildPrCommentsPrompt,
	buildReviewPrompt,
	buildSecurityReviewPrompt,
	buildSimplifyPrompt,
} from "./prompts.ts";
import { registerReportRenderer, showReport } from "./report.ts";
import { buildDoctorMarkdown, buildStatusMarkdown } from "./status.ts";
import { registerStatusLine } from "./statusline.ts";
import { registerTerminalSetup } from "./terminal-setup.ts";
import { registerTodos } from "./todos.ts";
import { registerUsage } from "./usage.ts";
import { registerVim } from "./vim.ts";

export const PROMPT_MESSAGE_TYPE = "claude-commands:prompt";

interface PromptDetails {
	invocation: string;
}

interface PromptCommand {
	name: string;
	description: string;
	build: (args: string) => string;
}

const PROMPT_COMMANDS: readonly PromptCommand[] = [
	{ name: "init", description: "Write or improve the project's AGENTS.md from the codebase", build: buildInitPrompt },
	{ name: "review", description: "Review a pull request, branch, or the local changes", build: buildReviewPrompt },
	{
		name: "security-review",
		description: "Security review of the pending changes on the current branch",
		build: buildSecurityReviewPrompt,
	},
	{ name: "simplify", description: "Clean up the changed code without changing behavior", build: buildSimplifyPrompt },
	{ name: "pr-comments", description: "Show review comments on a GitHub pull request", build: buildPrCommentsPrompt },
];

/** Creates the extension; SDK users can add it to their extension factories. */
export function createClaudeCommandsExtension(): ExtensionFactory {
	return (pi) => {
		registerReportRenderer(pi);
		registerPromptRenderer(pi);
		registerTodos(pi);
		registerLoop(pi);
		registerAddDir(pi);
		registerOutputStyle(pi);
		registerPreferences(pi);
		// Hooks before permissions: a PreToolUse hook sees and can block a call before the permission check asks.
		registerHooks(pi);
		registerPermissions(pi);
		registerAgents(pi);
		registerPlugin(pi);
		registerVim(pi);
		registerStatusLine(pi);
		registerTerminalSetup(pi);
		registerUsage(pi);

		pi.registerCommand("help", {
			description: "List available commands",
			handler: async (_args, ctx) => {
				showReport(pi, ctx, { title: "Commands", markdown: buildHelpMarkdown(pi.getCommands()) });
			},
		});
		pi.registerCommand("status", {
			description: "Show version, model, session and context status",
			handler: async (_args, ctx) => {
				showReport(pi, ctx, { title: "Status", markdown: buildStatusMarkdown(pi, ctx) });
			},
		});
		pi.registerCommand("context", {
			description: "Show how the context window is used",
			handler: async (_args, ctx) => {
				showReport(pi, ctx, { title: "Context usage", markdown: buildContextReport(pi, ctx) });
			},
		});
		pi.registerCommand("doctor", {
			description: "Check the installation and configuration",
			handler: async (_args, ctx) => {
				showReport(pi, ctx, { title: "Doctor", markdown: await buildDoctorMarkdown(pi, ctx) });
			},
		});
		pi.registerCommand("skills", {
			description: "List loaded skills",
			handler: async (_args, ctx) => {
				const skills = ctx.getSystemPromptOptions().skills ?? [];
				showReport(pi, ctx, { title: "Skills", markdown: buildSkillsMarkdown(skills) });
			},
		});
		pi.registerCommand("memory", {
			description: "Edit AGENTS.md context files, or append a note: /memory <note>",
			handler: async (args, ctx) => runMemoryCommand(args, ctx),
		});
		pi.registerCommand("btw", {
			description: "Ask a side question without adding it to the conversation",
			handler: async (args, ctx) => runBtwCommand(pi, args, ctx),
		});

		for (const command of PROMPT_COMMANDS) {
			pi.registerCommand(command.name, {
				description: command.description,
				handler: async (args, _ctx) => {
					const invocation = `/${command.name}${args.trim() ? ` ${args.trim()}` : ""}`;
					pi.sendMessage<PromptDetails>(
						{
							customType: PROMPT_MESSAGE_TYPE,
							content: command.build(args),
							display: true,
							details: { invocation },
						},
						{ triggerTurn: true, deliverAs: "followUp" },
					);
				},
			});
		}
	};
}

export default createClaudeCommandsExtension();

function buildContextReport(pi: ExtensionAPI, ctx: ExtensionCommandContext): string {
	const promptOptions = ctx.getSystemPromptOptions();
	const model = isUnknownModel(ctx.model) ? undefined : ctx.model;
	const activeTools = new Set(pi.getActiveTools());
	return buildContextMarkdown({
		modelLabel: model ? `${model.provider}/${model.id}` : undefined,
		usage: ctx.getContextUsage(),
		systemPrompt: ctx.getSystemPrompt(),
		contextFiles: promptOptions.contextFiles ?? [],
		skills: promptOptions.skills ?? [],
		tools: pi.getAllTools().filter((tool) => activeTools.has(tool.name)),
		messages: ctx.sessionManager.buildSessionProjection().messages,
	});
}

/** Shows the command the user typed; the full prompt sent to the model is visible when expanded. */
function registerPromptRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<PromptDetails>(PROMPT_MESSAGE_TYPE, (message, options, theme) => {
		const invocation = theme.fg("accent", message.details?.invocation ?? "command");
		if (!options.expanded) {
			return new Text(
				`${invocation} ${theme.fg("dim", options.keyHint("app.tools.expand", "to show prompt"))}`,
				options.outputPad,
				0,
			);
		}
		const content = typeof message.content === "string" ? message.content : "";
		return new Text(`${invocation}\n${theme.fg("dim", content)}`, options.outputPad, 0);
	});
}
