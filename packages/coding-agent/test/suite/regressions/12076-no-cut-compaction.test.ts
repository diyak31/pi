import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

describe("issue #12076 length recovery when compaction has nothing to summarize", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	// #12076: everything since the prompt fits in keepRecentTokens (default 20000), so compaction
	// cannot free space. The run used to drop the truncated response and end on a tool result
	// without any error, which print mode reports as success with no output.
	it("keeps the truncated response when compaction cannot free space", async () => {
		const largeTool: AgentTool = {
			name: "large_result",
			label: "Large result",
			description: "Returns enough content to approach the context window",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "1\n".repeat(1500) }], details: {} }),
		};
		const harness = await createHarness({
			models: [{ id: "faux-1", contextWindow: 3000, maxTokens: 400 }],
			settings: { compaction: { enabled: true, reserveTokens: 1000 } },
			tools: [largeTool],
		});
		harnesses.push(harness);
		// The last response is cut off at max_tokens: 1, as sent when the request is clamped to the window.
		const truncated = fauxAssistantMessage("x", { stopReason: "length" });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" }),
			{ ...truncated, usage: { ...truncated.usage, input: 2900, output: 1, totalTokens: 2901 } },
		]);

		await harness.session.prompt("run the large tool twice");

		expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
		expect(harness.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "length" });
	});
});
