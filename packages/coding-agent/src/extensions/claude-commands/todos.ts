/**
 * Task list: the `todo_write` tool lets the model plan and track multi-step work, `/todos` shows the list, and a widget
 * above the editor shows it while work is open.
 *
 * The list lives in the tool results, so it follows the session tree: after /tree or /fork the list is the one
 * that was current at that point of the conversation.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import type { SessionEntry } from "../../core/session-manager.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { showReport } from "./report.ts";

export const TODO_TOOL_NAME = "todo_write";

type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
	content: string;
	status: TodoStatus;
}

interface TodoDetails {
	todos: TodoItem[];
}

const TodoParams = Type.Object({
	todos: Type.Array(
		Type.Object({
			content: Type.String({ description: "The task, phrased as an action, for example: Run the test suite" }),
			// StringEnum emits a plain string enum every provider accepts; Unsafe keeps its literal type inside Type.Object.
			status: Type.Unsafe<TodoStatus>(StringEnum(["pending", "in_progress", "completed"] as const)),
		}),
		{ description: "The complete updated list. It replaces the previous list." },
	),
});

const WIDGET_KEY = "claude-commands:todos";

/** Registers the todo_write tool, the /todos command, and the widget that mirrors the current list. */
export function registerTodos(pi: ExtensionAPI): void {
	let todos: TodoItem[] = [];
	const restore = (ctx: ExtensionContext): void => {
		todos = findLatestTodos(ctx.sessionManager.getBranch());
		showWidget(ctx, todos);
	};
	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));

	pi.registerTool({
		name: TODO_TOOL_NAME,
		label: "Todos",
		description:
			"Create and update a task list for the current work. Send the complete list every time; it replaces the previous one.",
		promptSnippet: "Plan and track multi-step work as a task list",
		promptGuidelines: [
			"Use todo_write for tasks with three or more distinct steps, or when the user gives several tasks at once. Skip it for single, trivial requests.",
			"With todo_write, keep exactly one item in_progress while working, and mark each item completed as soon as it is done, not in batches.",
		],
		parameters: TodoParams,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			todos = params.todos;
			showWidget(ctx, todos);
			return {
				content: [{ type: "text", text: `Todo list updated:\n${formatTodos(todos)}` }],
				details: { todos } satisfies TodoDetails,
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("Update todos")), 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TodoDetails | undefined;
			return new Text(details ? formatTodos(details.todos, theme) : "", 0, 0);
		},
	});

	pi.registerCommand("todos", {
		description: "Show the current task list",
		handler: async (_args, ctx) => {
			showReport(pi, ctx, { title: "Todos", markdown: todos.length > 0 ? formatTodos(todos) : "No todos." });
		},
	});
}

/** The list from the newest todo_write result on the branch, or an empty list. */
export function findLatestTodos(branch: readonly SessionEntry[]): TodoItem[] {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "toolResult" && message.toolName === TODO_TOOL_NAME && message.details) {
			// Only todo_write writes these results, always with TodoDetails.
			return (message.details as unknown as TodoDetails).todos;
		}
	}
	return [];
}

const STATUS_MARKS: Record<TodoStatus, string> = { pending: "☐", in_progress: "◐", completed: "☑" };

function formatTodos(todos: readonly TodoItem[], theme?: Theme): string {
	return todos
		.map((todo) => {
			const line = `${STATUS_MARKS[todo.status]} ${todo.content}`;
			if (!theme) return line;
			if (todo.status === "completed") return theme.fg("dim", line);
			return todo.status === "in_progress" ? theme.bold(theme.fg("accent", line)) : line;
		})
		.join("\n");
}

/** Shows the list above the editor while any item is open; hides it once everything is done. */
function showWidget(ctx: ExtensionContext, todos: readonly TodoItem[]): void {
	if (!ctx.hasUI) return;
	const open = todos.some((todo) => todo.status !== "completed");
	ctx.ui.setWidget(WIDGET_KEY, open ? formatTodos(todos, ctx.ui.theme).split("\n") : undefined);
}
