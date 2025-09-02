import { describe, it, expect } from "vitest";
import { NLParser } from "./parser";
/**
 * NLParser unit tests
 * Note: Test runner detected dynamically (Vitest/Jest-compatible syntax).
 */

describe("NLParser.parseToIntent – core behavior", () => {
  it("produces default meta.defaults when no options provided", () => {
    const parser = new NLParser();
    const nl = "Generate a summary of the text.";
    const intent = parser.parseToIntent(nl);

    expect(intent.meta.defaults.aiProvider).toBeDefined();
    expect(intent.meta.defaults.model).toBeDefined();
    expect(intent.meta.defaults.temperature).toBeDefined();
    expect(typeof intent.meta.defaults.enableVision).toBe("boolean");
    expect(typeof intent.meta.defaults.wrapInCannoliGroup).toBe("boolean");
  });

  it("honors provided GenerationOptions in meta.defaults", () => {
    const parser = new NLParser({
      aiProvider: "anthropic",
      model: "claude-3-5",
      temperature: 0.2,
      enableVision: false,
      wrapInCannoliGroup: false,
    });
    const intent = parser.parseToIntent("Generate a poem.");

    expect(intent.meta.defaults.aiProvider).toBe("anthropic");
    expect(intent.meta.defaults.model).toBe("claude-3-5");
    expect(intent.meta.defaults.temperature).toBe(0.2);
    expect(intent.meta.defaults.enableVision).toBe(false);
    expect(intent.meta.defaults.wrapInCannoliGroup).toBe(false);
  });

  it("sets meta.title to include the first 50 chars of input followed by ellipsis", () => {
    const longText =
      "Create a detailed tutorial about functional programming in TypeScript, including practical examples and exercises.";
    const intent = new NLParser().parseToIntent(longText);
    expect(intent.meta.title.startsWith("Generated from: ")).toBe(true);
    expect(intent.meta.title.endsWith("...")).toBe(true);
    const body = intent.meta.title.replace(/^Generated from: /, "").replace(/\.\.\.$/, "");
    expect(body.length).toBeLessThanOrEqual(50);
  });
});

describe("NLParser – step extraction via public API", () => {
  it("detects a system prompt followed by an AI step and content output", () => {
    const nl = "System: 'Be concise' then ask the AI to summarize the article and output the result.";
    const intent = new NLParser().parseToIntent(nl);

    // Expect at least 3 nodes: system content, ai, content
    const kinds = intent.nodes.map(n => n.kind);
    expect(kinds.filter(k => k === "content").length).toBeGreaterThan(0);
    expect(kinds.includes("ai")).toBe(true);

    // Ensure there is an edge from system node to AI node
    const systemNode = intent.nodes.find(n => n.kind === "content" && n.attrs?.role === "system");
    const aiNode = intent.nodes.find(n => n.kind === "ai");
    expect(systemNode).toBeTruthy();
    expect(aiNode).toBeTruthy();
    const hasEdge = intent.edges.some(e => e.from === systemNode?.id && e.to === aiNode?.id);
    expect(hasEdge).toBe(true);
  });

  it("when only AI step is present, it auto-appends a content output step", () => {
    const nl = "Ask the AI to translate the given text to French.";
    const intent = new NLParser().parseToIntent(nl);
    const aiNodes = intent.nodes.filter(n => n.kind === "ai");
    const contentNodes = intent.nodes.filter(n => n.kind === "content");

    expect(aiNodes.length).toBeGreaterThan(0);
    // At least one content node (the auto-appended output)
    expect(contentNodes.length).toBeGreaterThan(0);
  });

  it("defaults to AI + content when no explicit step keywords are found", () => {
    const nl = "Make something cool.";
    const intent = new NLParser().parseToIntent(nl);
    expect(intent.nodes.some(n => n.kind === "ai")).toBe(true);
    expect(intent.nodes.some(n => n.kind === "content")).toBe(true);
  });

  it("detects action/http steps based on keywords and methods", () => {
    const nl = "Call the API with a GET request and save the response.";
    const intent = new NLParser().parseToIntent(nl);
    expect(intent.nodes.some(n => n.kind === "action" && n.action === "http")).toBe(true);
  });

  it("detects modal/form action step based on keywords", () => {
    const nl = "Open a modal form to collect input, then ask AI to validate.";
    const intent = new NLParser().parseToIntent(nl);
    expect(intent.nodes.some(n => n.kind === "action")).toBe(true);
  });
});

describe("NLParser – inputs, outputs, and variable wiring", () => {
  it("extracts inputs from {{var}} syntax and wires to first non-system AI node", () => {
    const nl = "Ask the AI to summarize {{text}} and {{language}}.";
    const intent = new NLParser().parseToIntent(nl);

    const inputNodes = intent.nodes.filter(n => n.name && n.id.startsWith("input_"));
    const aiNode = intent.nodes.find(n => n.kind === "ai");
    expect(inputNodes.map(n => n.name)).toEqual(expect.arrayContaining(["text", "language"]));
    // There should be variable edges from each input to the AI node
    for (const input of ["text", "language"]) {
      const fromId = inputNodes.find(n => n.name === input)?.id!;
      expect(
        intent.edges.some(e => e.from === fromId && e.to === aiNode?.id && e.type === "variable" && e.label === input)
      ).toBe(true);
    }
  });

  it("extracts inputs via 'input: name' pattern and outputs via 'output: name' pattern", () => {
    const nl = "Prompt the AI. input: dataset output: report";
    const intent = new NLParser().parseToIntent(nl);

    expect(intent.io.inputs).toEqual([{ name: "dataset" }]);
    expect(intent.io.outputs).toEqual([{ name: "report" }]);

    // Output node should exist and be connected from the last step
    const outputNode = intent.nodes.find(n => n.name === "report");
    expect(outputNode).toBeTruthy();
    const lastStepId = intent.nodes.filter(n => n.id.startsWith("step_")).pop()?.id;
    expect(intent.edges.some(e => e.to === outputNode?.id && e.from === lastStepId)).toBe(true);
  });

  it("defaults an output named 'result' when write/save is mentioned without explicit output", () => {
    const nl = "Ask the AI to generate a summary and save it to disk.";
    const intent = new NLParser().parseToIntent(nl);
    expect(intent.io.outputs).toEqual([{ name: "result" }]);
  });
});

describe("NLParser – configs, conditions, loops, and parallel", () => {
  it("creates config nodes and connects them to AI nodes with proper labels", () => {
    const nl = "Ask the AI to draft an email. temperature: 0.3 model: gpt-4o provider: openai";
    const intent = new NLParser().parseToIntent(nl);

    const aiIds = intent.nodes.filter(n => n.kind === "ai").map(n => n.id);
    const configNodes = intent.nodes.filter(n => n.id.startsWith("config_"));
    expect(configNodes.length).toBeGreaterThanOrEqual(1);

    // Each config should have at least one 'config' edge to an AI node with label set
    const configEdges = intent.edges.filter(e => e.type === "config");
    expect(configEdges.length).toBeGreaterThanOrEqual(1);
    for (const e of configEdges) {
      expect(aiIds).toContain(e.to);
      expect(e.label === "temperature" || e.label === "model" || e.label === "provider").toBe(true);
    }
  });

  it("adds choice edges for yes/no choices when conditional language is present", () => {
    const nl = "Ask the AI a question and choose yes or no depending on the result if needed.";
    const intent = new NLParser().parseToIntent(nl);

    // Expect at least two choice edges with labels yes/no from the last step
    const choiceEdges = intent.edges.filter(e => e.type === "choice");
    const labels = choiceEdges.map(e => e.label);
    expect(labels).toEqual(expect.arrayContaining(["yes", "no"]));
  });

  it("parses loop counts (semantic only) without breaking IR generation", () => {
    const nl = "Repeat 3 times: ask the AI to refine the draft and output the result.";
    const intent = new NLParser().parseToIntent(nl);
    // No crash; layout strategy present; nodes/edges non-empty
    expect(intent.layout?.strategy).toBe("dag");
    expect(intent.nodes.length).toBeGreaterThan(0);
  });

  it("parses parallel cues (semantic only) and still generates a valid IR", () => {
    const nl = "Process items in parallel and then output the response.";
    const intent = new NLParser().parseToIntent(nl);
    expect(intent.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(intent.edges)).toBe(true);
  });
});

describe("NLParser – prompt extraction nuances", () => {
  it("uses quoted text as the AI prompt when present", () => {
    const nl = "Ask the AI to follow this instruction: \"Write a haiku about the ocean\" and output the result.";
    const intent = new NLParser().parseToIntent(nl);
    const aiNode = intent.nodes.find(n => n.kind === "ai");
    expect(aiNode?.text).toContain("Write a haiku about the ocean");
  });

  it("falls back to 'prompt: <text>' pattern when quotes are absent", () => {
    const nl = "Prompt: generate key bullet points from the article and save.";
    const intent = new NLParser().parseToIntent(nl);
    const aiNode = intent.nodes.find(n => n.kind === "ai");
    expect(aiNode?.text?.toLowerCase()).toContain("generate key bullet points from the article");
  });
});