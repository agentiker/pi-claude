/**
 * JSON config files of this extension: one in the user's agent dir, one in the project's `.pi` dir.
 * Project files are read only for trusted projects, because they can run commands (hooks) or loosen
 * permissions, and a cloned repository must not be able to do that on its own.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.ts";
import type { ExtensionContext } from "../../core/extensions/types.ts";

export type ConfigScope = "user" | "project";

export interface ConfigSource<T> {
	scope: ConfigScope;
	path: string;
	data: T;
}

/** Path of `fileName` in the user's agent dir or the project's config dir. */
export function getConfigPath(scope: ConfigScope, fileName: string, ctx: Pick<ExtensionContext, "cwd">): string {
	return scope === "user" ? join(getAgentDir(), fileName) : join(ctx.cwd, CONFIG_DIR_NAME, fileName);
}

/** The user file, then the project file when the project is trusted; missing files are skipped. */
export function readConfigSources<T>(
	fileName: string,
	ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): ConfigSource<T>[] {
	const scopes: ConfigScope[] = ctx.isProjectTrusted() ? ["user", "project"] : ["user"];
	return scopes.flatMap((scope) => {
		const path = getConfigPath(scope, fileName, ctx);
		const data = readJsonFile<T>(path);
		return data === undefined ? [] : [{ scope, path, data }];
	});
}

/** Parsed contents of `path`, or undefined when it is missing or not valid JSON. */
export function readJsonFile<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		// A hand-edited file that does not parse is ignored instead of breaking every prompt; /doctor-style
		// reporting is left to the commands that edit these files, which validate before writing.
		return undefined;
	}
}

/** Writes `data` as tab-indented JSON, creating the directory. */
export function writeJsonFile(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
}

/** User preferences of this extension, kept in `<agentDir>/claude-commands.json`. */
export interface Preferences {
	outputStyle?: string;
	editorMode?: "vim" | "normal";
	/** Shell command whose output is shown in the footer. */
	statusLine?: string;
}

/** The saved preferences, or none. */
export function readPreferences(): Preferences {
	return readJsonFile<Preferences>(join(getAgentDir(), "claude-commands.json")) ?? {};
}

/** Saves `patch` over the current preferences. */
export function updatePreferences(patch: Preferences): void {
	writeJsonFile(join(getAgentDir(), "claude-commands.json"), { ...readPreferences(), ...patch });
}
