/**
 * Starting pi itself as a child process: subagents, /plugin and /upgrade all run the same pi the user is running.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** Command and leading arguments that start pi the way this process was started: runtime, its flags, script. */
export function getPiInvocation(): [string, ...string[]] {
	const script = process.argv[1];
	// Bun standalone binaries report a virtual script path; the binary itself is the CLI.
	if (script && !script.startsWith("/$bunfs/") && existsSync(script)) {
		// execArgv keeps flags such as the --import loader a source checkout runs with.
		return [process.execPath, ...process.execArgv, script];
	}
	return [process.execPath];
}

export interface PiCommandResult {
	code: number;
	output: string;
}

/** Runs `pi <args>` to completion without a terminal and returns its exit code and combined output. */
export function runPiCommand(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<PiCommandResult> {
	return new Promise((resolve) => {
		const [command, ...prefix] = getPiInvocation();
		const child = spawn(command, [...prefix, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], signal });
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on("error", (error) => resolve({ code: 1, output: `${output}${error.message}` }));
		child.on("close", (code) => resolve({ code: code ?? 1, output }));
	});
}
