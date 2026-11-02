/**
 * /terminal-setup: check that the terminal can send the modified keys pi uses (Shift+Enter for a new line,
 * Alt+Enter for a follow-up) and fix what can be fixed from here. Inside tmux it can enable extended keys,
 * live and in ~/.tmux.conf; for other terminals it points to the matching section of the terminal setup guide.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDocsPath } from "../../config.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { showReport } from "./report.ts";

interface Terminal {
	name: string;
	/** Heading anchor in docs/terminal-setup.md. */
	anchor: string;
}

/** Registers /terminal-setup. */
export function registerTerminalSetup(pi: ExtensionAPI): void {
	pi.registerCommand("terminal-setup", {
		description: "Check the terminal's support for Shift+Enter and other modified keys, and fix tmux",
		handler: async (_args, ctx) => {
			const guide = join(getDocsPath(), "terminal-setup.md");
			const terminal = detectTerminal(process.env);
			const lines = [
				`Terminal: **${terminal?.name ?? "unknown"}**`,
				terminal ? `Setup notes: ${guide}#${terminal.anchor}` : `Setup notes per terminal: ${guide}`,
			];
			if (process.env.TMUX) lines.push("", ...(await checkTmux(pi, ctx)));
			lines.push(
				"",
				"Check: Shift+Enter should insert a new line and Enter should submit. `/hotkeys` lists all shortcuts.",
			);
			showReport(pi, ctx, { title: "Terminal setup", markdown: lines.join("\n") });
		},
	});
}

/** Identifies the terminal from the environment variables terminals set. */
export function detectTerminal(env: NodeJS.ProcessEnv): Terminal | undefined {
	const program = env.TERM_PROGRAM ?? "";
	if (env.KITTY_WINDOW_ID) return { name: "Kitty", anchor: "kitty" };
	if (program === "iTerm.app") return { name: "iTerm2", anchor: "iterm2" };
	if (program === "Apple_Terminal") return { name: "Apple Terminal", anchor: "apple-terminal" };
	if (program === "ghostty" || env.GHOSTTY_RESOURCES_DIR) return { name: "Ghostty", anchor: "ghostty" };
	if (program === "WezTerm" || env.WEZTERM_EXECUTABLE) return { name: "WezTerm", anchor: "wezterm" };
	if (env.ALACRITTY_SOCKET || env.ALACRITTY_LOG) return { name: "Alacritty", anchor: "alacritty" };
	if (program === "vscode") return { name: "VS Code integrated terminal", anchor: "vs-code-integrated-terminal" };
	if (program === "zed") return { name: "Zed integrated terminal", anchor: "zed-integrated-terminal" };
	if (env.WT_SESSION) return { name: "Windows Terminal", anchor: "windows-terminal" };
	if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") {
		return { name: "IntelliJ IDEA integrated terminal", anchor: "intellij-idea-integrated-terminal" };
	}
	return undefined;
}

/** Reports tmux's extended-keys settings and offers to enable them. */
async function checkTmux(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string[]> {
	const version = (await pi.exec("tmux", ["-V"], { timeout: 5000 })).stdout.trim();
	const match = /(\d+)\.(\d+)/.exec(version);
	const [major, minor] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
	const supportsCsiU = major > 3 || (major === 3 && minor >= 5);
	if (major < 3 || (major === 3 && minor < 2)) {
		return [
			`tmux: ${version || "unknown version"}. Extended keys need tmux 3.2 or newer; upgrade tmux to use Shift+Enter.`,
		];
	}
	const show = async (option: string) =>
		(await pi.exec("tmux", ["show", "-gv", option], { timeout: 5000 })).stdout.trim();
	const enabled = (await show("extended-keys")) !== "off";
	const formatOk = !supportsCsiU || (await show("extended-keys-format")) === "csi-u";
	if (enabled && formatOk) return [`tmux: ${version}, extended keys are enabled.`];

	const settings = supportsCsiU
		? ["set -g extended-keys on", "set -g extended-keys-format csi-u"]
		: ["set -g extended-keys on"];
	const status = `tmux: ${version}, extended keys are not fully enabled, so Shift+Enter arrives as Enter.`;
	if (
		!ctx.hasUI ||
		!(await ctx.ui.confirm(
			"Enable tmux extended keys?",
			`Apply now and add to ~/.tmux.conf:\n${settings.join("\n")}`,
		))
	) {
		return [status, `Add to ~/.tmux.conf:\n\n\`\`\`\n${settings.join("\n")}\n\`\`\``];
	}
	for (const line of settings) await pi.exec("tmux", line.split(" "), { timeout: 5000 });
	const confPath = join(homedir(), ".tmux.conf");
	const current = existsSync(confPath) ? readFileSync(confPath, "utf-8") : "";
	const missing = settings.filter((line) => !current.includes(line));
	if (missing.length > 0) {
		appendFileSync(confPath, `${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
	}
	return [
		status,
		`Enabled for the running tmux server and saved to ${confPath}. Panes started before this change may need a new tmux session.`,
	];
}
