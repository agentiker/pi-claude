/**
 * /vim: toggle vim-style modal editing for the prompt editor. The choice is saved and applies to new sessions.
 *
 * Normal mode: h j k l, w b e, 0 ^ $, x X, dd D, cc C S, dw cw, u, p, i a I A o O; Enter submits and Escape is
 * passed on (it interrupts the agent). Insert mode is the normal editor; Escape returns to normal mode.
 *
 * Motions are performed by sending the editor the key of the matching editor action, chosen through the keybindings
 * manager, so they keep working when the user rebinds those actions.
 */

import { type EditorTheme, matchesKey, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { CustomEditor } from "../../modes/interactive/components/custom-editor.ts";
import { readPreferences, updatePreferences } from "./config-files.ts";

type EditorAction =
	| "tui.editor.cursorLeft"
	| "tui.editor.cursorRight"
	| "tui.editor.cursorUp"
	| "tui.editor.cursorDown"
	| "tui.editor.cursorWordLeft"
	| "tui.editor.cursorWordRight"
	| "tui.editor.cursorLineStart"
	| "tui.editor.cursorLineEnd"
	| "tui.editor.deleteCharForward"
	| "tui.editor.deleteCharBackward"
	| "tui.editor.deleteWordForward"
	| "tui.editor.deleteToLineEnd"
	| "tui.editor.yank"
	| "tui.editor.undo"
	| "tui.input.newLine";

// Terminal sequences that commonly trigger each action; the first one the keybindings manager maps to the action wins.
const CANDIDATE_SEQUENCES: Record<EditorAction, readonly string[]> = {
	"tui.editor.cursorLeft": ["\x1b[D", "\x02"],
	"tui.editor.cursorRight": ["\x1b[C", "\x06"],
	"tui.editor.cursorUp": ["\x1b[A", "\x10"],
	"tui.editor.cursorDown": ["\x1b[B", "\x0e"],
	"tui.editor.cursorWordLeft": ["\x1bb", "\x1b[1;3D", "\x1b[1;5D"],
	"tui.editor.cursorWordRight": ["\x1bf", "\x1b[1;3C", "\x1b[1;5C"],
	"tui.editor.cursorLineStart": ["\x01", "\x1b[H", "\x1b[1~"],
	"tui.editor.cursorLineEnd": ["\x05", "\x1b[F", "\x1b[4~"],
	"tui.editor.deleteCharForward": ["\x1b[3~", "\x04"],
	"tui.editor.deleteCharBackward": ["\x7f", "\x08"],
	"tui.editor.deleteWordForward": ["\x1bd", "\x1b[3;3~"],
	"tui.editor.deleteToLineEnd": ["\x0b"],
	"tui.editor.yank": ["\x19"],
	"tui.editor.undo": ["\x1f"],
	"tui.input.newLine": ["\n", "\x1b[13;2u"],
};

// What each normal-mode key does: editor actions to run, then whether to enter insert mode.
const NORMAL_COMMANDS: Record<string, { actions: EditorAction[]; insert?: boolean }> = {
	h: { actions: ["tui.editor.cursorLeft"] },
	j: { actions: ["tui.editor.cursorDown"] },
	k: { actions: ["tui.editor.cursorUp"] },
	l: { actions: ["tui.editor.cursorRight"] },
	b: { actions: ["tui.editor.cursorWordLeft"] },
	"0": { actions: ["tui.editor.cursorLineStart"] },
	"^": { actions: ["tui.editor.cursorLineStart"] },
	$: { actions: ["tui.editor.cursorLineEnd"] },
	x: { actions: ["tui.editor.deleteCharForward"] },
	X: { actions: ["tui.editor.deleteCharBackward"] },
	D: { actions: ["tui.editor.deleteToLineEnd"] },
	C: { actions: ["tui.editor.deleteToLineEnd"], insert: true },
	S: { actions: ["tui.editor.cursorLineStart", "tui.editor.deleteToLineEnd"], insert: true },
	u: { actions: ["tui.editor.undo"] },
	p: { actions: ["tui.editor.yank"] },
	i: { actions: [], insert: true },
	a: { actions: ["tui.editor.cursorRight"], insert: true },
	I: { actions: ["tui.editor.cursorLineStart"], insert: true },
	A: { actions: ["tui.editor.cursorLineEnd"], insert: true },
	o: { actions: ["tui.editor.cursorLineEnd", "tui.input.newLine"], insert: true },
	O: { actions: ["tui.editor.cursorLineStart", "tui.input.newLine", "tui.editor.cursorUp"], insert: true },
};

// Two-key commands: an operator followed by a motion. dw is handled with the word motions below.
const OPERATOR_COMMANDS: Record<string, { actions: EditorAction[]; insert?: boolean }> = {
	dd: { actions: ["tui.editor.cursorLineStart", "tui.editor.deleteToLineEnd", "tui.editor.deleteCharBackward"] },
	cc: { actions: ["tui.editor.cursorLineStart", "tui.editor.deleteToLineEnd"], insert: true },
	cw: { actions: ["tui.editor.deleteWordForward"], insert: true },
};

/** The prompt editor with vim normal and insert modes. */
export class VimEditor extends CustomEditor {
	private mode: "normal" | "insert" = "insert";
	private pendingOperator: string | undefined;
	private readonly sequences: Partial<Record<EditorAction, string>> = {};

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings);
		for (const [action, candidates] of Object.entries(CANDIDATE_SEQUENCES) as [EditorAction, readonly string[]][]) {
			const sequence = candidates.find((candidate) => keybindings.matches(candidate, action));
			if (sequence) this.sequences[action] = sequence;
		}
	}

	handleInput(data: string): void {
		// Escape is vim's own mode key, not an app action, so it is matched directly.
		if (matchesKey(data, "escape")) {
			this.pendingOperator = undefined;
			if (this.mode === "insert") this.mode = "normal";
			else super.handleInput(data);
			this.invalidate();
			return;
		}
		if (this.mode === "insert") {
			super.handleInput(data);
			return;
		}
		if (this.pendingOperator) {
			const operator = this.pendingOperator + data;
			this.pendingOperator = undefined;
			if (operator === "dw") this.repeat("tui.editor.deleteCharForward", this.distanceTo(nextWordStart));
			const command = OPERATOR_COMMANDS[operator];
			if (command) this.run(command);
			return;
		}
		// Emacs-style word motions stop at word ends, so vim's w and e are computed from the line instead.
		if (data === "w" || data === "e") {
			this.repeat("tui.editor.cursorRight", this.distanceTo(data === "w" ? nextWordStart : wordEnd));
			return;
		}
		if (data === "d" || data === "c") {
			this.pendingOperator = data;
			return;
		}
		const command = NORMAL_COMMANDS[data];
		if (command) {
			this.run(command);
			return;
		}
		// Other printable keys do nothing in normal mode; control keys (Enter, ctrl+c, ...) keep their app meaning.
		if (data.length === 1 && data.charCodeAt(0) >= 32) return;
		super.handleInput(data);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		const last = lines.length - 1;
		const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
		if (last >= 0 && visibleWidth(lines[last]) >= label.length) {
			lines[last] = truncateToWidth(lines[last], width - label.length, "") + label;
		}
		return lines;
	}

	/** Columns from the cursor to the position `find` picks on the cursor's line. */
	private distanceTo(find: (line: string, col: number) => number): number {
		const { line, col } = this.getCursor();
		const text = this.getLines()[line] ?? "";
		return Math.max(0, find(text, col) - col);
	}

	private repeat(action: EditorAction, times: number): void {
		const sequence = this.sequences[action];
		if (!sequence) return;
		for (let i = 0; i < times; i++) super.handleInput(sequence);
	}

	private run(command: { actions: EditorAction[]; insert?: boolean }): void {
		for (const action of command.actions) {
			const sequence = this.sequences[action];
			if (sequence) super.handleInput(sequence);
		}
		if (command.insert) this.mode = "insert";
		this.invalidate();
	}
}

/** Vim character classes: blank, word character, other punctuation. A word is a run of one class. */
function charClass(char: string | undefined): 0 | 1 | 2 {
	if (char === undefined || /\s/.test(char)) return 0;
	return /[\p{L}\p{N}_]/u.test(char) ? 1 : 2;
}

/** Column of the next word start on the line (vim `w`), or the line end. */
export function nextWordStart(line: string, col: number): number {
	let i = col;
	const start = charClass(line[i]);
	if (start !== 0) while (i < line.length && charClass(line[i]) === start) i++;
	while (i < line.length && charClass(line[i]) === 0) i++;
	return i;
}

/** Column of the last character of the current or next word (vim `e`). */
export function wordEnd(line: string, col: number): number {
	let i = col + 1;
	while (i < line.length && charClass(line[i]) === 0) i++;
	const cls = charClass(line[i]);
	while (i + 1 < line.length && charClass(line[i + 1]) === cls) i++;
	return Math.min(i, Math.max(0, line.length - 1));
}

/** Registers /vim and restores the saved editor mode when a session starts. */
export function registerVim(pi: ExtensionAPI): void {
	const apply = (ctx: ExtensionContext, vim: boolean): void => {
		ctx.ui.setEditorComponent(vim ? (tui, theme, keybindings) => new VimEditor(tui, theme, keybindings) : undefined);
	};
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui" && readPreferences().editorMode === "vim") apply(ctx, true);
	});

	pi.registerCommand("vim", {
		description: "Toggle vim editing mode for the prompt editor",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/vim needs interactive mode", "error");
				return;
			}
			const vim = readPreferences().editorMode !== "vim";
			updatePreferences({ editorMode: vim ? "vim" : "normal" });
			apply(ctx, vim);
			ctx.ui.notify(vim ? "Vim mode on. Escape for normal mode, i to insert." : "Vim mode off.", "info");
		},
	});
}
