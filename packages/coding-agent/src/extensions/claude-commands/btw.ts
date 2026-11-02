/**
 * /btw: ask a side question about the current conversation. The answer is shown as a report card and is never
 * added to the model's context, so the main task continues unaffected.
 */

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { isUnknownModel } from "../../core/auth-guidance.ts";
import { serializeConversation } from "../../core/compaction/utils.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { convertToLlm } from "../../core/messages.ts";
import { BorderedLoader } from "../../modes/interactive/components/bordered-loader.ts";
import { showReport } from "./report.ts";

const BTW_SYSTEM_PROMPT = `You answer a quick side question from a user who is working with a coding agent.
The conversation between the user and the agent so far is given for context.
You cannot run tools or read files: answer from the conversation and general knowledge only, and say so when that is not enough.
Answer briefly and directly.`;

/** Answers `args` against a serialized copy of the conversation without touching the session's context. */
export async function runBtwCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const question = args.trim();
	if (!question) {
		ctx.ui.notify("Usage: /btw <question>", "error");
		return;
	}
	const model = isUnknownModel(ctx.model) ? undefined : ctx.model;
	if (!model) {
		ctx.ui.notify("No model selected", "error");
		return;
	}

	const conversation = serializeConversation(convertToLlm(ctx.sessionManager.buildSessionProjection().messages));
	const userMessage: UserMessage = {
		role: "user",
		content: [
			{ type: "text", text: `<conversation>\n${conversation}\n</conversation>\n\nSide question: ${question}` },
		],
		timestamp: Date.now(),
	};
	const ask = (signal?: AbortSignal): Promise<AssistantMessage> =>
		ctx.modelRegistry.complete(model, { systemPrompt: BTW_SYSTEM_PROMPT, messages: [userMessage] }, { signal });

	const response =
		ctx.mode === "tui"
			? await ctx.ui.custom<AssistantMessage | undefined>((tui, theme, _keybindings, done) => {
					const loader = new BorderedLoader(tui, theme, `Answering with ${model.id}...`);
					loader.onAbort = () => done(undefined);
					ask(loader.signal).then(done, () => done(undefined));
					return loader;
				})
			: await ask();
	if (!response || response.stopReason === "aborted") {
		ctx.ui.notify("Cancelled", "info");
		return;
	}
	if (response.stopReason === "error") {
		ctx.ui.notify(`/btw failed: ${response.errorMessage ?? "unknown error"}`, "error");
		return;
	}
	const answer = response.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	showReport(pi, ctx, { title: `btw: ${question}`, markdown: answer || "(empty answer)" });
}
