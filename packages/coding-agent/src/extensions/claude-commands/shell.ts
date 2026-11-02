/**
 * Shell commands configured by the user: hooks and the status line.
 */

import { spawn } from "node:child_process";

export interface ShellCommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs `command` through the shell in `cwd` with `stdin` as input; a timeout kills it and reports in stderr. */
export function runShellCommand(
	command: string,
	stdin: string,
	cwd: string,
	timeoutMs: number,
): Promise<ShellCommandResult> {
	return new Promise((resolve) => {
		const child = spawn(command, {
			cwd,
			shell: true,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, PI_PROJECT_DIR: cwd },
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			stderr += `\nTimed out after ${timeoutMs / 1000}s`;
			child.kill("SIGTERM");
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ code: 1, stdout, stderr: error.message });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr });
		});
		// A hook that does not read stdin closes the pipe early; that is not an error.
		child.stdin.on("error", () => {});
		child.stdin.end(stdin);
	});
}
