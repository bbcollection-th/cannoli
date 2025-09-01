/**
 * Tests for nl-generator public API
 * Framework: Vitest (describe/it/expect, vi.mock). If project uses Jest, replace vi with jest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// SUT imports
import * as SUT from "./index";

// Mock dependencies: parser, compiler, and types schema
vi.mock("./parser", () => {
  return {
    NLParser: vi.fn().mockImplementation((_opts?: any) => ({
      parseToIntent: vi.fn(),
    })),
  };
});

vi.mock("./compiler", () => {
  return {
    CanvasCompiler: vi.fn().mockImplementation(() => ({
      validateIR: vi.fn(),
      compileToCanvas: vi.fn(),
    })),
  };
});

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error?: any };

// packages/cannoli-core/src/nl-generator/index.test.ts

const safeParseMock = vi.fn<[(unknown)], SafeParseResult<any>>();
const parseMock     = vi.fn<[(unknown)], any>();
vi.mock("./types", async () => {
  // Provide minimal runtime types used by SUT and tests
  // cannoliIntentSchema with parse and safeParse
  const cannoliIntentSchema = {
    parse: parseMock,
    safeParse: safeParseMock,
  };
  // The rest of exports don't need to be concrete for these tests
  return {
    cannoliIntentSchema,
  };
});

// Declare variables to hold your mock implementations
let NLParserMock: ReturnType<typeof vi.fn>;
let CanvasCompilerMock: ReturnType<typeof vi.fn>;

vi.mock("./parser", () => {
  // Assign into the captured variable instead of using vi.importedModules
  NLParserMock = vi.fn().mockImplementation((_opts?: any) => ({
    parseToIntent: vi.fn(),
  }));
  return { NLParser: NLParserMock };
});

vi.mock("./compiler", () => {
  // Likewise for the compiler mock
  CanvasCompilerMock = vi.fn().mockImplementation(() => ({
    validateIR: vi.fn(),
    compileToCanvas: vi.fn(),
  }));
  return { CanvasCompiler: CanvasCompilerMock };
});

function getMocks() {
  // Return the captured mock constructors directly
  return {
    NLParser: NLParserMock,
    CanvasCompiler: CanvasCompilerMock,
  };
}

describe("nl-generator index API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateCanvasFromNL", () => {
    it("returns compiled canvas and report on happy path; excludes IR by default", async () => {
      const { NLParser, CanvasCompiler } = getMocks();

      // Arrange parser IR
      const ir = { meta: { assumptions: ["assume A"] } } as any;
      (NLParser as any).mockImplementation(() => ({
        parseToIntent: vi.fn().mockReturnValue(ir),
      }));

      // Arrange compiler validation OK and compile result
      const canvas = { nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 10, height: 10 }], edges: [] };
      (CanvasCompiler as any).mockImplementation(() => ({
        validateIR: vi.fn().mockReturnValue({ errors: [], warnings: ["minor"] }),
        compileToCanvas: vi.fn().mockReturnValue(canvas),
      }));

      // Act
      const result = await SUT.generateCanvasFromNL("build a simple canvas");

      // Assert
      expect(result.canvas).toEqual(canvas);
      expect(result.report.assumptions).toEqual(["assume A"]);
      expect(result.report.warnings).toEqual(["minor"]);
      expect(result.report.questions).toEqual([]);
      expect(result.ir).toBeUndefined();
    });

    it("includes IR when options.includeIR is true", async () => {
      const { NLParser, CanvasCompiler } = getMocks();
      const ir = { meta: { assumptions: [] } } as any;
      (NLParser as any).mockImplementation(() => ({
        parseToIntent: vi.fn().mockReturnValue(ir),
      }));
      (CanvasCompiler as any).mockImplementation(() => ({
        validateIR: vi.fn().mockReturnValue({ errors: [], warnings: [] }),
        compileToCanvas: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
      }));

      const result = await SUT.generateCanvasFromNL("anything", { includeIR: true });
      expect(result.ir).toBe(ir);
    });

    it("returns empty canvas and a question when validation errors exist", async () => {
      const { NLParser, CanvasCompiler } = getMocks();
      const ir = { meta: {} } as any;
      (NLParser as any).mockImplementation(() => ({
        parseToIntent: vi.fn().mockReturnValue(ir),
      }));
      (CanvasCompiler as any).mockImplementation(() => ({
        validateIR: vi.fn().mockReturnValue({ errors: ["bad thing"], warnings: ["warn"] }),
        compileToCanvas: vi.fn().mockReturnValue({ nodes: [{ id: "x" }], edges: [] }),
      }));

      const result = await SUT.generateCanvasFromNL("spec");
      expect(result.canvas).toEqual({ nodes: [], edges: [] });
      expect(result.report.assumptions).toEqual([]);
      expect(result.report.warnings).toEqual(["warn"]);
      expect(result.report.questions).toEqual(["Generation failed with errors: bad thing"]);
      expect(result.ir).toBeUndefined();
    });

    it("returns empty canvas with failure message when an exception is thrown", async () => {
      const { NLParser } = getMocks();
      (NLParser as any).mockImplementation(() => ({
        parseToIntent: vi.fn().mockImplementation(() => {
          throw new Error("boom");
        }),
      }));

      const result = await SUT.generateCanvasFromNL("spec");
      expect(result.canvas).toEqual({ nodes: [], edges: [] });
      expect(result.report.assumptions).toEqual([]);
      expect(result.report.warnings).toEqual([]);
      expect(result.report.questions).toEqual(["Generation failed: boom"]);
    });
  });

  describe("validateCanvas", () => {
    it("errors when nodes or edges arrays are missing", () => {
      const res1 = SUT.validateCanvas({}); // no nodes/edges
      expect(res1.errors).toContain("Canvas must have a 'nodes' array");
      expect(res1.errors).toContain("Canvas must have an 'edges' array");

      const res2 = SUT.validateCanvas({ nodes: [], edges: "nope" as any });
      expect(res2.errors).toContain("Canvas must have an 'edges' array");

      const res3 = SUT.validateCanvas({ nodes: "nope" as any, edges: [] });
      expect(res3.errors).toContain("Canvas must have a 'nodes' array");
    });

    it("validates node fields and edge references", () => {
      const canvas = {
        nodes: [
          // missing id and type
          { x: 1, y: 2, width: 3, height: 4 } as any,
          // has id but missing numeric coords
          { id: "n2", type: "text", x: "a", y: 0, width: 10, height: 10 } as any,
          { id: "n3", type: "text", x: 0, y: "b", width: 10, height: 10 } as any,
          { id: "n4", type: "text", x: 0, y: 0, width: "c", height: 10 } as any,
          { id: "n5", type: "text", x: 0, y: 0, width: 10, height: "d" } as any,
        ],
        edges: [
          { fromNode: "n1", toNode: "nX" } as any, // missing id + bad refs
          { id: "e2", fromNode: "", toNode: "" } as any, // empty refs
        ],
      };

      const res = SUT.validateCanvas(canvas);
      expect(res.errors).toEqual(
        expect.arrayContaining([
          "Node at index 0 missing required 'id' field",
          "Node at index 0 missing required 'type' field",
          "Node n2 missing valid 'x' coordinate",
          "Node n3 missing valid 'y' coordinate",
          "Node n4 missing valid 'width'",
          "Node n5 missing valid 'height'",
          "Edge at index 0 missing required 'id' field",
          "Edge at index 0 references non-existent fromNode: n1",
          "Edge at index 0 references non-existent toNode: nX",
          "Edge at index 1 missing required 'fromNode' field",
          "Edge at index 1 missing required 'toNode' field",
        ])
      );
    });

    it("emits warnings when no recognizable Cannoli nodes and when missing cannoli group", () => {
      const canvas = { nodes: [], edges: [] };
      const res = SUT.validateCanvas(canvas);
      expect(res.errors).toEqual([]);
      expect(res.warnings).toEqual(
        expect.arrayContaining([
          "Canvas appears to be empty or contains no recognizable Cannoli nodes",
          "Canvas does not contain a 'cannoli' group. Consider wrapping your workflow in a cannoli group to prevent accidental execution.",
        ])
      );
    });

    it("does not warn about cannoli group when a 'cannoli' group exists", () => {
      const canvas = {
        nodes: [
          { id: "g1", type: "group", x: 0, y: 0, width: 10, height: 10, label: "Cannoli" } as any,
          { id: "t1", type: "text", x: 0, y: 0, width: 10, height: 10, color: "6" } as any, // content node
        ],
        edges: [],
      };
      const res = SUT.validateCanvas(canvas);
      expect(res.errors).toEqual([]);
      // no "missing cannoli group" warning
      expect(res.warnings.find(w => /does not contain a 'cannoli' group/i.test(w))).toBeUndefined();
    });
  });

  describe("explainCanvas", () => {
    it("summarizes node and edge counts, classifies edge types, and notes cannoli group", () => {
      const canvas = {
        nodes: [
          { id: "a1", type: "text", x: 0, y: 0, width: 1, height: 1 }, // ai (color undefined => '0')
          { id: "c1", type: "text", x: 0, y: 0, width: 1, height: 1, color: "6" }, // content
          { id: "ac1", type: "text", x: 0, y: 0, width: 1, height: 1, color: "2" }, // action
          { id: "g1", type: "group", x: 0, y: 0, width: 1, height: 1, label: "cannoli" },
          { id: "f1", type: "file", x: 0, y: 0, width: 1, height: 1 },
          { id: "l1", type: "link", x: 0, y: 0, width: 1, height: 1 },
        ],
        edges: [
          { id: "e1", fromNode: "a1", toNode: "c1", color: "2", label: "cfg" }, // config
          { id: "e2", fromNode: "a1", toNode: "c1", color: "2" }, // logging
          { id: "e3", fromNode: "a1", toNode: "c1", color: "3" }, // choice
          { id: "e4", fromNode: "a1", toNode: "c1", color: "4" }, // chat
          { id: "e5", fromNode: "a1", toNode: "c1", color: "5" }, // list
          { id: "e6", fromNode: "a1", toNode: "c1", color: "6" }, // field
          { id: "e7", fromNode: "a1", toNode: "c1", label: "{{var}}" }, // variable (no color)
          { id: "e8", fromNode: "a1", toNode: "c1" }, // basic
        ],
      };

      const summary = SUT.explainCanvas(canvas);
      expect(summary).toMatch(/This canvas contains 6 nodes and 8 edges\./);
      expect(summary).toMatch(/\b1 AI node\(s\)\b/);
      expect(summary).toMatch(/\b1 content node\(s\)\b/);
      expect(summary).toMatch(/\b1 action node\(s\)\b/);
      expect(summary).toMatch(/\b1 group\(s\)\b/);
      expect(summary).toMatch(/\b1 file node\(s\)\b/);
      expect(summary).toMatch(/\b1 link node\(s\)\b/);

      // Edge types line
      expect(summary).toMatch(/Edge types: .*1 config.*1 logging.*1 choice.*1 chat.*1 list.*1 field.*1 variable.*1 basic/);

      // Cannoli group note
      expect(summary).toMatch(/Wrapped in cannoli group for controlled execution\./);

      // Ends with a period
      expect(summary.endsWith(".")).toBe(true);
    });

    it("returns informative error string if something goes wrong", () => {
      // Force error by passing a value that will throw when accessed in forEach
      const bad: any = {
        nodes: null, // accessing forEach on null will throw
        edges: [],
      };
      const out = SUT.explainCanvas(bad);
      expect(out).toMatch(/^Could not explain canvas: /);
    });
  });

  describe("refineWithAnswers", () => {
    it("when input is valid IR (safeParse success), validates and compiles to canvas; includes warnings and IR in result", () => {
      const { CanvasCompiler } = getMocks();

      // safeParse returns success with IR
      safeParseMock.mockReturnValueOnce({ success: true, data: { foo: "bar" } });

      // validate OK, compile returns canvas
      (CanvasCompiler as any).mockImplementation(() => ({
        validateIR: vi.fn().mockReturnValue({ errors: [], warnings: ["warn"] }),
        compileToCanvas: vi.fn().mockReturnValue({ nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1 }], edges: [] }),
      }));

      const res = SUT.refineWithAnswers({ any: "thing" }, { q1: "a1" });
      expect(res.canvas.nodes.length).toBe(1);
      expect(res.report.assumptions).toEqual(["Refinement not yet implemented in basic version"]);
      expect(res.report.warnings).toEqual(["warn"]);
      expect(res.report.questions).toEqual([]);
      expect(res.ir).toEqual({ foo: "bar" });
    });

    it("when safeParse success but IR validation fails, returns empty canvas and question", () => {
      const { CanvasCompiler } = getMocks();
      safeParseMock.mockReturnValueOnce({ success: true, data: { bad: true } });

      (CanvasCompiler as any).mockImplementation(() => ({
        validateIR: vi.fn().mockReturnValue({ errors: ["oops"], warnings: ["w"] }),
        compileToCanvas: vi.fn().mockReturnValue({ nodes: [{ id: "x" }], edges: [] }),
      }));

      const res = SUT.refineWithAnswers({} as any, {});
      expect(res.canvas).toEqual({ nodes: [], edges: [] });
      expect(res.report.assumptions).toEqual([]);
      expect(res.report.warnings).toEqual(["w"]);
      expect(res.report.questions).toEqual(["Refinement received invalid IR: oops"]);
      expect(res.ir).toEqual({ bad: true });
    });

    it("when input is not IR (safeParse fail), returns input as canvas and default report", () => {
      safeParseMock.mockReturnValueOnce({ success: false });

      const canvas = { nodes: [], edges: [] };
      const res = SUT.refineWithAnswers(canvas, { k: "v" });
      expect(res.canvas).toBe(canvas);
      expect(res.report.assumptions).toEqual(["Refinement not yet implemented in basic version"]);
      expect(res.report.warnings).toEqual([]);
      expect(res.report.questions).toEqual([]);
      expect(res.ir).toBeUndefined();
    });
  });

  describe("validateIR", () => {
    it("returns empty errors when schema.parse succeeds", () => {
      parseMock.mockImplementationOnce((_ir: any) => true);
      const res = SUT.validateIR({ a: 1 });
      expect(res).toEqual({ errors: [], warnings: [] });
    });

    it("returns informative error when schema.parse throws", () => {
      parseMock.mockImplementationOnce(() => {
        throw new Error("bad IR");
      });
      const res = SUT.validateIR({ a: 1 });
      expect(res.errors[0]).toMatch(/^IR validation failed: bad IR$/);
      expect(res.warnings).toEqual([]);
    });
  });
});