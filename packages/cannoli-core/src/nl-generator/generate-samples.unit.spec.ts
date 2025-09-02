import { join } from "path";

// We will conditionally import test APIs based on environment.
// In Vitest, vi/describe/it/expect are globals; in Jest, they are globals as well.
// Types are inferred from the environment.

const TEST_OUTPUT_DIR = "/tmp/sample-cannoli-canvases";

// Mock fs and path join to avoid real file IO
import * as fs from "fs";
import * as path from "path";

// Mock the module that provides generateCanvasFromNL
// The target file imports from "./index"
if (typeof jest !== "undefined" && typeof jest.mock === "function") {
  jest.mock("./index");
}
if (typeof vi !== "undefined" && typeof vi.mock === "function") {
  vi.mock("./index");
}

type Canvas = { nodes?: any[]; edges?: any[]; [k: string]: any };
type GenReport = { questions: string[]; assumptions: string[] };
type GenResult = { canvas: Canvas; report: GenReport };

describe("generateSampleCanvases", () => {
  let generateSampleCanvases: () => Promise<void>;
  let generateCanvasFromNL: (input: string, opts: any) => Promise<GenResult>;
  const mkdirSpy = (fs.mkdirSync as unknown as jest.SpyInstance | ReturnType<typeof vi.spyOn>) ?? undefined;
  const writeSpy = (fs.writeFileSync as unknown as jest.SpyInstance | ReturnType<typeof vi.spyOn>) ?? undefined;
  const joinSpy = (path.join as unknown as jest.SpyInstance | ReturnType<typeof vi.spyOn>) ?? undefined;

  const spy = (globalThis as any).vi ?? (globalThis as any).jest;

  beforeEach(async () => {
    // Freshly reset modules between tests to isolate console/mocks
    spy.resetModules?.();

    // Spy/mocks for fs and path
    spy.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
    spy.spyOn(fs, "writeFileSync").mockImplementation(() => undefined as any);
    spy.spyOn(path, "join").mockImplementation((...parts: any[]) => (parts as string[]).join("/"));

    // Spy console to suppress noise and assert calls
    spy.spyOn(console, "log").mockImplementation(() => {});

    // Provide a mock implementation for generateCanvasFromNL
    const mocked = { generateCanvasFromNL: spy.fn() };
    // Enregistrer le mock avant d'importer le SUT
    vi?.doMock?.("./index", () => mocked);
    jest?.doMock?.("./index", () => mocked);
    // Now import the module under test after mocks are in place
    const mod = await import("./generate-samples");
    generateSampleCanvases = mod.generateSampleCanvases;
    // Capture the mocked function reference (works for both Jest/Vitest)
    const idx = await import("./index") as any;
    generateCanvasFromNL = idx.generateCanvasFromNL as any;
  });

  afterEach(() => {
    // Restore spies
    (fs.mkdirSync as any).mockRestore?.();
    (fs.writeFileSync as any).mockRestore?.();
    (path.join as any).mockRestore?.();
    (console.log as any).mockRestore?.();
  });

  function okResult(nodes = 2, edges = 1, assumptions: string[] = []): GenResult {
    return {
      canvas: { nodes: Array(nodes).fill({}), edges: Array(edges).fill({}) },
      report: { questions: [], assumptions },
    };
  }

  function failResult(questions: string[]): GenResult {
    return {
      canvas: { nodes: [], edges: [] },
      report: { questions, assumptions: [] },
    };
  }

  it("creates the output directory once with recursive: true", async () => {
    (generateCanvasFromNL as any).mockResolvedValue(okResult());
    await generateSampleCanvases();

    expect(fs.mkdirSync).toHaveBeenCalledWith(TEST_OUTPUT_DIR, { recursive: true });
    // Ensure multiple examples do not re-create directory per write attempt (only initial call)
    // There is one mkdirSync call in implementation.
    expect((fs.mkdirSync as any).mock.calls.length).toBe(1);
  });

  it("calls generateCanvasFromNL for each example with wrapInCannoliGroup: true", async () => {
    (generateCanvasFromNL as any).mockResolvedValue(okResult());
    await generateSampleCanvases();

    // There are 5 examples in the implementation
    expect((generateCanvasFromNL as any).mock.calls.length).toBe(5);
    (generateCanvasFromNL as any).mock.calls.forEach((call: any[]) => {
      expect(call[1]).toEqual({ wrapInCannoliGroup: true });
    });
  });

  it("writes files with metadata for successful generations", async () => {
    (generateCanvasFromNL as any).mockResolvedValue(okResult(3, 2, ["used default model"]));
    await generateSampleCanvases();

    // 5 examples => 5 writes
    expect((fs.writeFileSync as any).mock.calls.length).toBe(5);

    // Validate JSON structure for first call
    const [filePath, jsonStr] = (fs.writeFileSync as any).mock.calls[0];
    expect(filePath).toContain(TEST_OUTPUT_DIR);
    expect(typeof jsonStr).toBe("string");
    const parsed = JSON.parse(jsonStr);
    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata.version).toBe("1.0-1.0");
    expect(parsed.metadata.generatedBy).toBe("Cannoli NL Generator");
    expect(typeof parsed.metadata.generatedAt).toBe("string");
    // ISO validation: Date parses successfully
    expect(new Date(parsed.metadata.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("skips writing when report has questions, logs failure", async () => {
    // Make first call fail, rest succeed
    (generateCanvasFromNL as any)
      .mockResolvedValueOnce(failResult(["Ambiguous instruction"]))
      .mockResolvedValue(okResult());

    await generateSampleCanvases();

    // One failure + 4 successes => 4 writes (skipped the failed one)
    expect((fs.writeFileSync as any).mock.calls.length).toBe(4);

    // Ensure we logged a failure message
    const failureLog = (console.log as any).mock.calls
      .map((c: any[]) => c.join(" "))
      .find((s: string) => s.includes("Failed: Ambiguous instruction"));
    expect(failureLog).toBeDefined();
  });

  it("continues after exceptions and logs error", async () => {
    (generateCanvasFromNL as any)
      .mockRejectedValueOnce(new Error("Boom"))
      .mockResolvedValue(okResult());

    await generateSampleCanvases();

    // One error (no write) + four successes (4 writes)
    expect((fs.writeFileSync as any).mock.calls.length).toBe(4);

    const errLog = (console.log as any).mock.calls
      .map((c: any[]) => c.join(" "))
      .find((s: string) => s.includes("Error: Boom"));
    expect(errLog).toBeDefined();
  });

  it("logs node and edge counts for successful generations", async () => {
    (generateCanvasFromNL as any).mockResolvedValue(okResult(7, 5));
    await generateSampleCanvases();

    // Find a log line like: "✅ Generated: 7 nodes, 5 edges"
    const genLog = (console.log as any).mock.calls
      .map((c: any[]) => c.join(" "))
      .find((s: string) => s.includes("Generated: 7 nodes, 5 edges"));
    expect(genLog).toBeDefined();
  });

  it("always logs a final summary with output directory", async () => {
    (generateCanvasFromNL as any).mockResolvedValue(okResult());
    await generateSampleCanvases();

    const summary = (console.log as any).mock.calls
      .map((c: any[]) => c.join(" "))
      .find((s: string) => s.includes(`Sample canvases generated in ${TEST_OUTPUT_DIR}`));
    expect(summary).toBeDefined();
  });
});
