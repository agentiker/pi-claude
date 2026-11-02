/**
 * /status and /doctor: what this session runs with, and whether the installation can work.
 */

import { VERSION } from "../../config.ts";
import { isUnknownModel } from "../../core/auth-guidance.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { formatTokens } from "../../modes/interactive/components/footer.ts";
import { getToolPath } from "../../utils/tools-manager.ts";

/** Markdown describing version, session, model, context and loaded resources. */
export function buildStatusMarkdown(pi: ExtensionAPI, ctx: ExtensionCommandContext): string {
	const promptOptions = ctx.getSystemPromptOptions();
	const contextFiles = promptOptions.contextFiles ?? [];
	const usage = ctx.getContextUsage();
	const model = isUnknownModel(ctx.model) ? undefined : ctx.model;
	const sessionName = ctx.sessionManager.getSessionName();

	const lines = [
		`- Version: ${VERSION}`,
		`- Working directory: ${ctx.cwd}`,
		`- Session: ${sessionName ? `${sessionName} ` : ""}(${ctx.sessionManager.getSessionId()})`,
		`- Session file: ${ctx.sessionManager.getSessionFile() ?? "in memory"}`,
		model
			? `- Model: ${model.provider}/${model.id}, thinking ${ctx.thinkingLevel ?? "off"}, auth ${ctx.modelRegistry.hasConfiguredAuth(model) ? "configured" : "missing"}`
			: "- Model: none selected",
		usage?.tokens != null
			? `- Context: ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} tokens (${(usage.percent ?? 0).toFixed(1)}%)`
			: "- Context: unknown until the next response",
		`- Project trusted: ${ctx.isProjectTrusted() ? "yes" : "no"}`,
		`- Active tools: ${pi.getActiveTools().join(", ") || "none"}`,
		`- Skills: ${promptOptions.skills?.length ?? 0}`,
		`- Context files: ${contextFiles.length === 0 ? "none" : ""}`,
		...contextFiles.map((file) => `  - ${file.path}`),
	];
	return lines.join("\n");
}

type CheckStatus = "ok" | "warn" | "fail";

interface Check {
	status: CheckStatus;
	label: string;
	detail: string;
}

/** Runs installation and configuration checks and returns them as a Markdown checklist. */
export async function buildDoctorMarkdown(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const checks: Check[] = [checkNode(), ...checkModel(ctx), await checkGit(pi, ctx)];
	for (const tool of ["rg", "fd"] as const) {
		const path = getToolPath(tool);
		checks.push(
			path
				? { status: "ok", label: tool, detail: path }
				: {
						status: "warn",
						label: tool,
						detail: "not found; pi downloads it on first use, which needs network access",
					},
		);
	}
	checks.push(
		ctx.isProjectTrusted()
			? { status: "ok", label: "Project trust", detail: "trusted" }
			: {
					status: "warn",
					label: "Project trust",
					detail: "not trusted; project settings and extensions are skipped (see /trust)",
				},
	);

	const icons: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };
	const failures = checks.filter((check) => check.status === "fail").length;
	const warnings = checks.filter((check) => check.status === "warn").length;
	const summary =
		failures + warnings === 0
			? "All checks passed."
			: `${failures} failed, ${warnings} warning${warnings === 1 ? "" : "s"}.`;
	return `${checks.map((check) => `- ${icons[check.status]} **${check.label}**: ${check.detail}`).join("\n")}\n\n${summary}`;
}

const MIN_NODE_VERSION = [22, 19] as const;

function checkNode(): Check {
	const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
	const supported = major > MIN_NODE_VERSION[0] || (major === MIN_NODE_VERSION[0] && minor >= MIN_NODE_VERSION[1]);
	return {
		status: supported ? "ok" : "fail",
		label: "Node.js",
		detail: supported
			? process.versions.node
			: `${process.versions.node}; pi needs ${MIN_NODE_VERSION.join(".")} or newer`,
	};
}

function checkModel(ctx: ExtensionCommandContext): Check[] {
	const registryError = ctx.modelRegistry.getError();
	const checks: Check[] = registryError
		? [{ status: "fail", label: "Model configuration", detail: registryError }]
		: [];
	const model = isUnknownModel(ctx.model) ? undefined : ctx.model;
	if (!model) {
		checks.push({ status: "fail", label: "Model", detail: "none selected; run /login, then /model" });
	} else if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
		checks.push({
			status: "fail",
			label: "Model",
			detail: `${model.provider}/${model.id} has no credentials; run /login ${model.provider}`,
		});
	} else {
		checks.push({ status: "ok", label: "Model", detail: `${model.provider}/${model.id}` });
	}
	return checks;
}

async function checkGit(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<Check> {
	try {
		const result = await pi.exec("git", ["--version"], { timeout: 5000, cwd: ctx.cwd });
		if (result.code === 0) return { status: "ok", label: "git", detail: result.stdout.trim() };
	} catch {
		// Reported below: a missing binary rejects instead of returning a nonzero code.
	}
	return { status: "warn", label: "git", detail: "not available; git-based workflows such as /review will not work" };
}
