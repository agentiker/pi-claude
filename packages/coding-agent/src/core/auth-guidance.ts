import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getDocsPath } from "../config.ts";

const UNKNOWN_PROVIDER = "unknown";

/** Whether `model` is the agent's placeholder, which stands in until the user selects a real model. */
export function isUnknownModel(model: Pick<Model<Api>, "provider" | "id" | "api"> | undefined): boolean {
	return !!model && model.provider === UNKNOWN_PROVIDER && model.id === "unknown" && model.api === "unknown";
}

export function getProviderLoginHelp(): string {
	return [
		"Use /login to log into a provider via OAuth or API key. See:",
		`  ${join(getDocsPath(), "providers.md")}`,
		`  ${join(getDocsPath(), "models.md")}`,
	].join("\n");
}

export function formatNoModelsAvailableMessage(): string {
	return `No models available. ${getProviderLoginHelp()}`;
}

export function formatNoModelSelectedMessage(): string {
	return `No model selected.\n\n${getProviderLoginHelp()}\n\nThen use /model to select a model.`;
}

export function formatNoApiKeyFoundMessage(provider: string): string {
	const providerDisplay = provider === UNKNOWN_PROVIDER ? "the selected model" : provider;
	return `No API key found for ${providerDisplay}.\n\n${getProviderLoginHelp()}`;
}
