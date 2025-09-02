/* 
Note on test runner:
- This repository's tests use the project's established test framework (Jest or Vitest).
- The suite below is compatible with both Jest and Vitest:
  - For Jest: use jest.fn, jest.spyOn, jest.mock
  - For Vitest: globals vi.fn, vi.spyOn, vi.mock are aliased when jest is absent
*/

type AnyFn = (...args: any[]) => any;
const j = (globalThis as any).jest ?? (globalThis as any).vi;

// ← other imports & jest.mock calls
// L’import du SUT sera fait dynamiquement en amont des tests, après enregistrement des mocks.
let ExamplesModule: typeof import("./examples");

describe("runExamples", () => {
  beforeAll(async () => {
    // Charger le SUT après enregistrement des mocks pour garantir que le mock de ./index soit actif
    ExamplesModule = await import("./examples");
    // Spy on console.log once for the whole suite
    // Spy runner-agnostique + idempotent
    if (!(console as any)._spyAttached) {
      j.spyOn(console, "log").mockImplementation(() => {});
      (console as any)._spyAttached = true;
    }
  });

  // …rest of your tests, e.g.:
  it("should run examples without errors", async () => {
    await ExamplesModule.runExamples();
    // assertions…
  });
});

{
  // Enregistrer le mock dès le top-level pour éviter tout souci d’ordre de chargement.
  const g: any = globalThis as any;
  if (g?.jest?.mock) {
    g.jest.mock("./index", () => ({ generateCanvasFromNL: g.jest.fn() }));
  } else if (g?.vi?.mock) {
    g.vi.mock("./index", () => ({ generateCanvasFromNL: g.vi.fn() }));
  } else {
    throw new Error("No supported test runner globals (jest/vi) found");
  }
}

describe("runExamples integration with mocked generator", () => {
  let mockGen: AnyFn;

  const resetAll = () => {
    j.clearAllMocks?.();
    (console.log as any).mockClear?.();
  };

  beforeAll(async () => {
    // Spy on console.log once for the whole suite
    if (!(console as any)._spyAttached) {
      j.spyOn(console, "log").mockImplementation(() => {});
      (console as any)._spyAttached = true;
    }
    // Import the mocked generator module
    const module = await import("./index");
    mockGen = module.generateCanvasFromNL as unknown as AnyFn;
  });

  beforeEach(() => {
    resetAll();
  });

  afterAll(() => {
    (console.log as any).mockRestore?.();
  });

  function cannoliGroupNode() {
    return { id: "g1", type: "group", label: "Cannoli" };
  }

  // Helpers to build canvases matching analyzeCanvasFeatures logic
  const node = {
    ai: (id = "n_ai") => ({ id, type: "text", color: "0" }),
    aiNoColor: (id = "n_ai_nc") => ({ id, type: "text" }),
    content: (id = "n_content") => ({ id, type: "text", color: "6" }),
    action: (id = "n_action") => ({ id, type: "text", color: "2" }),
  };

  const edge = {
    basic: (id = "e_basic") => ({ id }),
    variable: (id = "e_var") => ({ id, label: "x" }),
    config: (id = "e_cfg") => ({ id, color: "2", label: "temp=1.0" }),
    choice: (id = "e_choice") => ({ id, color: "3" }),
    field: (id = "e_field") => ({ id, color: "6" }),
  };

  function mockResolvedSequence(...items: Array<ReturnType<typeof makeOk> | ReturnType<typeof makeFail> | ReturnType<typeof makeErr>>) {
    // Reset any prior implementations
    (mockGen as any).mockReset();
    for (const item of items) {
      if (item.kind === "ok") {
        (mockGen as any).mockResolvedValueOnce(item.value);
      } else if (item.kind === "fail") {
        (mockGen as any).mockResolvedValueOnce(item.value);
      } else if (item.kind === "err") {
        (mockGen as any).mockRejectedValueOnce(item.error);
      }
    }
  }

  function makeOk(canvas: any, opts?: { assumptions?: string[]; warnings?: string[] }) {
    return {
      kind: "ok" as const,
      value: {
        canvas,
        report: {
          questions: [],
          assumptions: opts?.assumptions ?? [],
          warnings: opts?.warnings ?? [],
        },
      },
    };
  }

  function makeFail(questions: string[]) {
    return {
      kind: "fail" as const,
      value: {
        canvas: { nodes: [], edges: [] },
        report: { questions, assumptions: [], warnings: [] },
      },
    };
  }

  function makeErr(message: string) {
    return {
      kind: "err" as const,
      error: new Error(message),
    };
  }

  it("processes all example workflows and logs derived features for happy paths", async () => {
    // Prepare 7 OK scenarios aligning with exampleWorkflows order
    mockResolvedSequence(
      // 1. Simple Hello World -> AI, Content, Basic edge (+ Cannoli group)
      makeOk({ nodes: [node.ai(), node.content(), cannoliGroupNode()], edges: [edge.basic()] }),
      // 2. Variable Substitution -> Variable edge
      makeOk({ nodes: [node.aiNoColor(), node.content(), cannoliGroupNode()], edges: [edge.variable()] }),
      // 3. System Prompt + Variable -> Variable edge (again)
      makeOk({ nodes: [node.ai(), node.content(), cannoliGroupNode()], edges: [edge.variable()] }),
      // 4. Configuration -> Config edge
      makeOk({ nodes: [node.ai(), node.content(), cannoliGroupNode()], edges: [edge.config()] }),
      // 5. Choice Workflow -> Choice edge
      makeOk({ nodes: [node.ai(), node.content(), cannoliGroupNode()], edges: [edge.choice()] }),
      // 6. HTTP Action -> Action node + Variable + Content
      makeOk({ nodes: [node.action(), node.content(), cannoliGroupNode()], edges: [edge.variable()] }),
      // 7. Modal Form -> Field edge
      makeOk({ nodes: [node.ai(), node.content(), cannoliGroupNode()], edges: [edge.field()] }),
    );

    await ExamplesModule.runExamples();

    // Ensure called once per example and wrapInCannoliGroup is true
    expect(mockGen).toHaveBeenCalledTimes(ExamplesModule.exampleWorkflows.length);
    for (const call of (mockGen as any).mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ wrapInCannoliGroup: true }));
    }

    const logs = (console.log as any).mock.calls.map((c: any[]) => c.join(" ")).join("\n");

    // Header and per-example headings
    expect(logs).toContain("🧪 Running Example Workflows");
    for (const ex of ExamplesModule.exampleWorkflows) {
      expect(logs).toContain(`=== ${ex.name} ===`);
      expect(logs).toContain(`📝 ${ex.description}`);
      expect(logs).toContain(`💬 Input: "${ex.input}"`);
      expect(logs).toContain("🎯 Expected:");
    }

    // Derived features per scenario
    expect(logs).toMatch(/🔍 Features: .*AI node/);          // AI present
    expect(logs).toMatch(/🔍 Features: .*Content node/);     // Content present
    expect(logs).toMatch(/🔍 Features: .*Basic edge/);       // From #1
    expect(logs).toMatch(/🔍 Features: .*Variable edge/);    // From #2/#3/#6
    expect(logs).toMatch(/🔍 Features: .*Config edge/);      // From #4
    expect(logs).toMatch(/🔍 Features: .*Choice edge/);      // From #5
    expect(logs).toMatch(/🔍 Features: .*Field edge/);       // From #7
    expect(logs).toMatch(/🔍 Features: .*Cannoli group/);    // Group detection
  });

  it("logs 'Invalid canvas' when nodes/edges are missing", async () => {
    mockResolvedSequence(
      makeOk({}), // invalid canvas (no nodes/edges)
      // Fill remaining calls with trivial OKs
      ...new Array(ExamplesModule.exampleWorkflows.length - 1).fill(
        makeOk({ nodes: [node.ai()], edges: [edge.basic()] })
      ),
    );

    await ExamplesModule.runExamples();

    const logs = (console.log as any).mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(logs).toMatch(/🔍 Features: Invalid canvas/);
  });

  it("logs failure when report.questions is non-empty and skips feature analysis for that example", async () => {
    mockResolvedSequence(
      makeFail(["Ambiguous instruction", "Missing variable"]),
      ...new Array(ExamplesModule.exampleWorkflows.length - 1).fill(
        makeOk({ nodes: [node.ai()], edges: [edge.basic()] })
      ),
    );

    await ExamplesModule.runExamples();

    const logs = (console.log as any).mock.calls.map((c: any[]) => c.join(" ")).join("\n");

    // Failure message for the first example
    expect(logs).toMatch(/❌ Failed: .*Ambiguous instruction.*Missing variable/);

    // Ensure features still logged for subsequent examples
    expect(logs).toMatch(/🔍 Features:/);
  });

  it("logs assumptions and warnings when provided by the generator", async () => {
    mockResolvedSequence(
      makeOk(
        { nodes: [node.ai()], edges: [edge.basic()] },
        { assumptions: ["Assumed default model gpt-4o"], warnings: ["Rate limit approaching"] }
      ),
      ...new Array(ExamplesModule.exampleWorkflows.length - 1).fill(
        makeOk({ nodes: [node.ai()], edges: [edge.basic()] })
      ),
    );

    await ExamplesModule.runExamples();

    const logs = (console.log as any).mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(logs).toContain("🤔 Assumptions: Assumed default model gpt-4o");
    expect(logs).toContain("⚠️ Warnings: Rate limit approaching");
  });

  it("continues processing and logs an error when the generator throws", async () => {
    // Make the last example throw
    const ok = makeOk({ nodes: [node.ai()], edges: [edge.basic()] });
    const seq: any[] = [];
    for (let i = 0; i < ExamplesModule.exampleWorkflows.length - 1; i++) seq.push(ok);
    seq.push(makeErr("Network error"));
    mockResolvedSequence(...seq);

    await ExamplesModule.runExamples();

    const logs = (console.log as any).mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(logs).toMatch(/❌ Error: Network error/);
  });
});