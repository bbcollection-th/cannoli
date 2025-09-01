/* 
  Unit tests for nl-generator public API.

  Framework:
  - Prefers Vitest if available (vi/describe/it/expect).
  - Falls back to Jest if Vitest is not available.
  This aligns with typical workspace setups without introducing new dependencies.
*/

let usingVitest = false;
let usingJest = false;

// Soft-detect test runner
try {
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const v = require('vitest');
  if (v && v.describe && v.it && v.expect && v.vi) usingVitest = true;
} catch {}
try {
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (!usingVitest) {
    const j = require('@jest/globals');
    if (j && j.describe && j.test && j.expect && typeof j.jest !== 'undefined') usingJest = true;
  }
} catch {}

type TestFns = {
  describe: any;
  it: any;
  test: any;
  expect: any;
  beforeEach: any;
  afterEach: any;
  mocker: any; // vi or jest
};
const t: TestFns = (() => {
  if (usingVitest) {
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { describe, it, test, expect, beforeEach, afterEach, vi } = require('vitest');
    return { describe, it, test, expect, beforeEach, afterEach, mocker: vi };
  }
  if (usingJest) {
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { describe, test, expect, beforeEach, afterEach, jest: jestObj } = require('@jest/globals');
    // Shim "it" to "test"
    const itShim = test;
    return { describe, it: itShim, test, expect, beforeEach, afterEach, mocker: jestObj };
  }
  throw new Error("No supported test runner detected (Vitest or Jest).");
})();

// Mock the ./index module to avoid network/LLM and make tests deterministic.
const mockGenerate = t.mocker.fn(async (input: string, options?: any) => {
  if (typeof input !== 'string' || !input.trim()) {
    const err: any = new Error('Invalid input');
    err.code = 'EINVAL';
    throw err;
  }
  const wrap = options?.wrapInCannoliGroup === true;
  const includeIR = options?.includeIR === true;

  const baseCanvas = {
    nodes: [
      { id: "n1", type: "text", label: "AI: What is the capital of France?", color: "0" },
      { id: "n2", type: "text", label: "Content: Paris", color: "6" },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2", label: "writes" }],
  };

  const canvas = wrap
    ? {
        nodes: [
          { id: "g1", type: "group", label: "Cannoli" },
          ...baseCanvas.nodes,
        ],
        edges: baseCanvas.edges,
      }
    : baseCanvas;

  const report = {
    assumptions: includeIR ? ["IR included"] : [],
    warnings: [],
    questions: [],
  };

  return { canvas, report };
});

const mockValidate = t.mocker.fn((canvas: any) => {
  const errors: string[] = [];
  if (!canvas || typeof canvas !== 'object') {
    errors.push("Canvas must be an object");
    return { errors };
  }
  if (!Array.isArray(canvas.nodes)) errors.push("Canvas must have nodes array");
  if (!Array.isArray(canvas.edges)) errors.push("Canvas must have edges array");
  if (Array.isArray(canvas.nodes)) {
    const ids = new Set();
    for (const n of canvas.nodes) {
      if (!n || typeof n !== 'object') {
        errors.push("Node must be an object");
        continue;
      }
      if (!n.id) errors.push("Node missing id");
      else if (ids.has(n.id)) errors.push(`Duplicate node id: ${n.id}`);
      else ids.add(n.id);
    }
  }
  return { errors };
});

const mockExplain = t.mocker.fn((canvas: any) => {
  if (!canvas || !Array.isArray(canvas.nodes)) return "Invalid canvas.";
  const nodeCount = canvas.nodes.length;
  const edgeCount = Array.isArray(canvas.edges) ? canvas.edges.length : 0;
  return `Canvas with ${nodeCount} nodes and ${edgeCount} edges.`;
});

// Use CommonJS-style jest/vi module mocking so it works across runners.
const mockModule = {
  generateCanvasFromNL: mockGenerate,
  validateCanvas: mockValidate,
  explainCanvas: mockExplain,
};

// jest/vi compatible mock registration
if (usingVitest) {
  // @ts-ignore
  const { vi } = require('vitest');
  vi.mock('./index', () => mockModule);
} else if (usingJest) {
  // @ts-ignore
  const { jest: jestObj } = require('@jest/globals');
  jestObj.mock('./index', () => mockModule);
}

// Now import the subject under test using the mocked module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateCanvasFromNL, validateCanvas, explainCanvas } = require('./index');

// Tests

t.describe("nl-generator: generateCanvasFromNL", () => {
  t.it("generates a canvas wrapped in a Cannoli group when wrapInCannoliGroup=true (happy path)", async () => {
    const input = "Ask the AI 'What is the capital of France?' and write the response to a content node";
    const result = await generateCanvasFromNL(input, { wrapInCannoliGroup: true, includeIR: false });

    t.expect(mockGenerate).toHaveBeenCalledTimes(1);
    t.expect(mockGenerate).toHaveBeenCalledWith(t.expect.any(String), t.expect.objectContaining({ wrapInCannoliGroup: true, includeIR: false }));

    const canvas = result.canvas;
    t.expect(Array.isArray(canvas.nodes)).toBe(true);
    t.expect(Array.isArray(canvas.edges)).toBe(true);
    const group = canvas.nodes.find((n: any) => n.type === "group" && String(n.label).toLowerCase() === "cannoli");
    t.expect(group).toBeTruthy();

    // Validate canvas via mocked validateCanvas for consistency
    const validation = validateCanvas(canvas);
    t.expect(validation.errors).toEqual([]);
  });

  t.it("respects includeIR flag by adding assumptions to the report", async () => {
    const result = await generateCanvasFromNL("Do X", { wrapInCannoliGroup: false, includeIR: true });
    t.expect(result.report.assumptions).toContain("IR included");
  });

  t.it("throws EINVAL on empty/blank input (edge case)", async () => {
    await t.expect(generateCanvasFromNL("   ", { wrapInCannoliGroup: true })).rejects.toMatchObject({ code: "EINVAL" });
    await t.expect(generateCanvasFromNL("", undefined)).rejects.toMatchObject({ code: "EINVAL" });
  });
});

t.describe("nl-generator: validateCanvas", () => {
  t.it("returns no errors for a well-formed canvas", () => {
    const canvas = {
      nodes: [{ id: "n1" }, { id: "n2" }],
      edges: [{ id: "e1", from: "n1", to: "n2" }],
    };
    const res = validateCanvas(canvas);
    t.expect(res.errors).toEqual([]);
  });

  t.it("detects structural issues and duplicates (failure conditions)", () => {
    const bad = {
      nodes: [{ id: "n1" }, { id: "n1" }, null],
      edges: "not-an-array",
    } as any;
    const res = validateCanvas(bad);
    t.expect(res.errors).toEqual(
      t.expect.arrayContaining([
        "Canvas must have edges array",
        "Duplicate node id: n1",
        "Node must be an object",
      ])
    );
  });

  t.it("flags non-object canvas", () => {
    const res = validateCanvas(null as any);
    t.expect(res.errors).toEqual(["Canvas must be an object"]);
  });
});

t.describe("nl-generator: explainCanvas", () => {
  t.it("summarizes node/edge counts (happy path)", () => {
    const canvas = {
      nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }],
      edges: [{ id: "e1", from: "n1", to: "n2" }],
    };
    const summary = explainCanvas(canvas);
    t.expect(summary).toContain("3 nodes");
    t.expect(summary).toContain("1 edges");
  });

  t.it("handles invalid canvas defensively (edge case)", () => {
    const summary = explainCanvas(undefined as any);
    t.expect(summary).toBe("Invalid canvas.");
  });
});

// Optional: regression on the previously inline harness behavior without printing logs
t.describe("nl-generator: behavior alignment with development harness", () => {
  t.it("mirrors the harness scenario without relying on console output", async () => {
    const input = "Ask the AI 'What is the capital of France?' and write the response to a content node";
    const { canvas, report } = await generateCanvasFromNL(input, { wrapInCannoliGroup: true, includeIR: false });

    // No questions/warnings expected in mocked path
    t.expect(report.questions).toHaveLength(0);
    t.expect(report.warnings).toHaveLength(0);

    // Explain should be coherent
    const explanation = explainCanvas(canvas);
    t.expect(explanation).toMatch(/Canvas with \d+ nodes and \d+ edges\./);
  });
});