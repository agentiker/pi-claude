/**
 * Subagents, like Claude Code's Task tool: the `agent` tool hands a self-contained task to a fresh pi process with
 * its own context window and returns only the final answer, so exploration does not fill the main context.
 * /agents lists, creates and edits agent definitions.
 *
 * An agent definition is a Markdown file in `<agentDir>/agents/` or the project's `.pi/agents/` (trusted projects
 * only), in the same format as Claude Code agents: frontmatter `name`, `description`, optional `tools` (list or comma
 * separated) and `model`; the body is appended to the subagent's system prompt. `general-purpose` is built in.
 *
 * A subagent runs with the parent's model and thinking level unless its definition names a model, cannot start
 * subagents of its own, and loads the same settings, hooks and permission rules. It has no user to ask, so
 * permission rules that ask block the call instead.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Message, Usage } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import { isUnknownModel } from "../../core/auth-guidance.ts";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { getPiInvocation } from "./pi-process.ts";
import { showReport } from "./report.ts";

export const AGENT_TOOL_NAME = "agent";

export interface AgentDefinition {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	prompt: string;
	/** "built-in" or the definition file. */
	source: string;
}

interface AgentDetails {
	agent: string;
	description: string;
	toolCalls: number;
	lastTool?: string;
	model?: string;
	usage?: Pick<Usage, "input" | "output"> & { cost: number };
	status: "running" | "done" | "failed";
}

const AgentParams = Type.Object({
	description: Type.String({ description: "A short (3 to 5 word) summary of the task" }),
	prompt: Type.String({
		description:
			"The complete task. The subagent sees nothing of this conversation, so include every detail it needs and say what to report back.",
	}),
	subagent_type: Type.Optional(Type.String({ description: "Agent to use; defaults to general-purpose" })),
});

const GENERAL_PURPOSE: AgentDefinition = {
	name: "general-purpose",
	description:
		"General agent for researching questions, searching code and running multi-step tasks. Has the default tools.",
	prompt: "",
	source: "built-in",
};

// Set in subagent processes so they do not register the agent tool and cannot nest subagents.
const SUBAGENT_ENV = "PI_SUBAGENT";
const SECTION_NAME = "available_agents";

/** Registers the agent tool and /agents, unless this process is itself a subagent. */
export function registerAgents(pi: ExtensionAPI): void {
	if (process.env[SUBAGENT_ENV]) return;

	pi.on("before_agent_start", async (event, ctx) => {
		const sections = event.systemPromptOptions.sections;
		if (!event.systemPromptOptions.selectedTools?.includes(AGENT_TOOL_NAME)) {
			delete sections[SECTION_NAME];
			return;
		}
		const agents = listAgents(ctx).map((agent) => `- ${agent.name}: ${agent.description}`);
		sections[SECTION_NAME] = `Agents available to the ${AGENT_TOOL_NAME} tool (subagent_type):\n${agents.join("\n")}`;
	});

	pi.registerTool({
		name: AGENT_TOOL_NAME,
		label: "Agent",
		description:
			"Run a subagent: a separate agent with a fresh context window that works on one self-contained task and returns its final answer. Use it for broad searches and research that would fill this context, or for independent tasks that can run in parallel (call the tool several times in one message).",
		promptSnippet: "Delegate a self-contained task to a subagent with its own context window",
		promptGuidelines: [
			"Use agent for open-ended searches across many files and for independent subtasks; for a known file or a single lookup, use the direct tools instead.",
			"The agent tool's subagent does not see this conversation: write its prompt as a complete brief and state what it should return.",
		],
		parameters: AgentParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agent = listAgents(ctx).find(
				(candidate) => candidate.name === (params.subagent_type ?? GENERAL_PURPOSE.name),
			);
			if (!agent) {
				throw new Error(
					`Unknown agent "${params.subagent_type}". Available: ${listAgents(ctx)
						.map((candidate) => candidate.name)
						.join(", ")}`,
				);
			}
			const details: AgentDetails = {
				agent: agent.name,
				description: params.description,
				toolCalls: 0,
				status: "running",
			};
			const result = await runSubagent(agent, params.prompt, ctx, signal, (progress) => {
				Object.assign(details, progress);
				onUpdate?.({ content: [{ type: "text", text: "(running)" }], details: { ...details } });
			});
			Object.assign(details, { status: result.ok ? "done" : "failed", usage: result.usage, model: result.model });
			if (!result.ok) throw new Error(`Subagent ${agent.name} failed: ${result.error}`);
			return { content: [{ type: "text", text: result.output || "(the subagent returned no text)" }], details };
		},
		renderCall(args, theme) {
			const type = args.subagent_type ?? GENERAL_PURPOSE.name;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Agent"))} ${theme.fg("accent", type)} ${theme.fg("muted", args.description ?? "")}`,
				0,
				0,
			);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as AgentDetails | undefined;
			if (!details) return new Text("", 0, 0);
			const tools = `${details.toolCalls} tool call${details.toolCalls === 1 ? "" : "s"}`;
			if (isPartial) {
				return new Text(theme.fg("dim", `${tools}${details.lastTool ? `, now: ${details.lastTool}` : ""}`), 0, 0);
			}
			const cost = details.usage ? `, $${details.usage.cost.toFixed(3)}` : "";
			const summary = theme.fg("dim", `${tools}${details.model ? `, ${details.model}` : ""}${cost}`);
			const output = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
			return new Text(expanded ? `${summary}\n${output}` : summary, 0, 0);
		},
	});

	pi.registerCommand("agents", {
		description: "List subagents; /agents create <name> [--user] or /agents edit <name> to change them",
		handler: async (args, ctx) => {
			const [action, name, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (!action) {
				showReport(pi, ctx, { title: "Agents", markdown: formatAgents(listAgents(ctx), ctx) });
				return;
			}
			if ((action !== "create" && action !== "edit") || !name) {
				ctx.ui.notify("Usage: /agents, /agents create <name> [--user], /agents edit <name>", "error");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("/agents create and edit need interactive mode", "error");
				return;
			}
			const existing = listAgents(ctx).find((agent) => agent.name === name);
			if (action === "edit" && (!existing || existing.source === "built-in")) {
				ctx.ui.notify(`No editable agent "${name}"`, "error");
				return;
			}
			const userScope = rest.includes("--user") || !ctx.isProjectTrusted();
			const path =
				action === "edit" && existing
					? existing.source
					: join(userScope ? getAgentDir() : join(ctx.cwd, CONFIG_DIR_NAME), "agents", `${name}.md`);
			const initial = existsSync(path) ? readFileSync(path, "utf-8") : agentTemplate(name);
			const edited = await ctx.ui.editor(`Edit ${path}`, initial);
			if (edited === undefined) return;
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, edited.endsWith("\n") ? edited : `${edited}\n`);
			ctx.ui.notify(`Saved ${path}`, "info");
		},
	});
}

/** The built-in agent, then user agents, then project agents (trusted projects only); later names win. */
export function listAgents(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">): AgentDefinition[] {
	const byName = new Map<string, AgentDefinition>([[GENERAL_PURPOSE.name, GENERAL_PURPOSE]]);
	const dirs = [join(getAgentDir(), "agents")];
	if (ctx.isProjectTrusted()) dirs.push(join(ctx.cwd, CONFIG_DIR_NAME, "agents"));
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".md"))) {
			const agent = parseAgentFile(join(dir, file));
			if (agent) byName.set(agent.name, agent);
		}
	}
	return [...byName.values()];
}

/** Parses one definition file; a file without a description is skipped, since the model could not choose it. */
export function parseAgentFile(path: string): AgentDefinition | undefined {
	const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf-8"));
	if (typeof frontmatter.description !== "string") return undefined;
	const name = typeof frontmatter.name === "string" ? frontmatter.name : basename(path, ".md");
	const rawTools = Array.isArray(frontmatter.tools)
		? frontmatter.tools
		: typeof frontmatter.tools === "string"
			? frontmatter.tools.split(",")
			: [];
	const tools = rawTools
		.filter((tool): tool is string => typeof tool === "string")
		.map((tool) => tool.trim().toLowerCase())
		.filter(Boolean);
	return {
		name,
		description: frontmatter.description,
		tools: tools.length > 0 ? tools : undefined,
		// Claude Code's "inherit" means the parent's model, which is what no model means here.
		model: typeof frontmatter.model === "string" && frontmatter.model !== "inherit" ? frontmatter.model : undefined,
		prompt: body.trim(),
		source: path,
	};
}

interface SubagentResult {
	ok: boolean;
	output: string;
	error?: string;
	model?: string;
	usage?: AgentDetails["usage"];
}

type Progress = Pick<AgentDetails, "toolCalls" | "lastTool">;

/** Runs one subagent process in JSON mode and collects its final assistant text. */
function runSubagent(
	agent: AgentDefinition,
	task: string,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onProgress: (progress: Progress) => void,
): Promise<SubagentResult> {
	const args = ["--mode", "json", "-p", "--no-session", "--exclude-tools", AGENT_TOOL_NAME];
	args.push(ctx.isProjectTrusted() ? "--approve" : "--no-approve");
	const parentModel = isUnknownModel(ctx.model) ? undefined : ctx.model;
	const model = agent.model ?? (parentModel ? `${parentModel.provider}/${parentModel.id}` : undefined);
	if (model) args.push("--model", model);
	if (!agent.model && ctx.thinkingLevel) args.push("--thinking", ctx.thinkingLevel);
	if (agent.tools) args.push("--tools", agent.tools.join(","));
	const promptDir = agent.prompt ? mkdtempSync(join(tmpdir(), "pi-subagent-")) : undefined;
	if (promptDir) {
		const promptFile = join(promptDir, `${agent.name}.md`);
		writeFileSync(promptFile, agent.prompt, { mode: 0o600 });
		args.push("--append-system-prompt", promptFile);
	}
	args.push("--", task);

	return new Promise((resolve) => {
		const [command, ...prefix] = getPiInvocation();
		const child = spawn(command, [...prefix, ...args], {
			cwd: ctx.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, [SUBAGENT_ENV]: "1" },
		});
		const progress: Progress = { toolCalls: 0 };
		const usage = { input: 0, output: 0, cost: 0 };
		let lastAssistant: Extract<Message, { role: "assistant" }> | undefined;
		let buffer = "";
		let stderr = "";

		const handleLine = (line: string): void => {
			if (!line.trim()) return;
			let event: { type?: string; toolName?: string; message?: Message };
			try {
				event = JSON.parse(line) as typeof event;
			} catch {
				return;
			}
			if (event.type === "tool_execution_start" && event.toolName) {
				progress.toolCalls++;
				progress.lastTool = event.toolName;
				onProgress({ ...progress });
			}
			if (event.type === "message_end" && event.message?.role === "assistant") {
				lastAssistant = event.message;
				usage.input += event.message.usage?.input ?? 0;
				usage.output += event.message.usage?.output ?? 0;
				usage.cost += event.message.usage?.cost?.total ?? 0;
			}
		};

		child.stdout.on("data", (chunk: Buffer) => {
			const lines = (buffer + chunk.toString()).split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) handleLine(line);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const abort = (): void => {
			child.kill("SIGTERM");
		};
		signal?.addEventListener("abort", abort, { once: true });

		const finish = (code: number | null, spawnError?: Error): void => {
			signal?.removeEventListener("abort", abort);
			if (promptDir) rmSync(promptDir, { recursive: true, force: true });
			handleLine(buffer);
			const output = (lastAssistant?.content ?? [])
				.flatMap((block) => (block.type === "text" ? [block.text] : []))
				.join("\n")
				.trim();
			const failed =
				spawnError !== undefined ||
				signal?.aborted === true ||
				code !== 0 ||
				lastAssistant?.stopReason === "error" ||
				lastAssistant?.stopReason === "aborted";
			resolve({
				ok: !failed,
				output,
				error: signal?.aborted
					? "aborted"
					: (spawnError?.message ??
						lastAssistant?.errorMessage ??
						(stderr.trim().slice(-2000) || `exit code ${code}`)),
				model: lastAssistant ? `${lastAssistant.provider}/${lastAssistant.model}` : model,
				usage,
			});
		};
		child.on("error", (error) => finish(null, error));
		child.on("close", (code) => finish(code));
	});
}

function agentTemplate(name: string): string {
	return `---
name: ${name}
description: When the main agent should use this agent, in one or two sentences
# tools: read, grep, find, ls     # optional; default is the normal tool set
# model: anthropic/claude-sonnet-4-5  # optional; default is the main agent's model
---

You are a specialized agent. Describe its role, how it should work, and what it must return.
`;
}

function formatAgents(agents: readonly AgentDefinition[], ctx: Pick<ExtensionContext, "cwd">): string {
	const lines = agents.map((agent) => {
		const extras = [agent.tools ? `tools: ${agent.tools.join(", ")}` : "", agent.model ? `model: ${agent.model}` : ""]
			.filter(Boolean)
			.join("; ");
		return `- **${agent.name}**${extras ? ` (${extras})` : ""}: ${agent.description}\n  ${agent.source}`;
	});
	const dirs = `${join(getAgentDir(), "agents")} and ${join(ctx.cwd, CONFIG_DIR_NAME, "agents")}`;
	return `${lines.join("\n")}\n\nDefinitions live in ${dirs}. Create one with \`/agents create <name>\` (add \`--user\` for all projects).`;
}
