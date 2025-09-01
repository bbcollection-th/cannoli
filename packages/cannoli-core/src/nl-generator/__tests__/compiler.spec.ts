/* 
Test framework: 
- Uses describe/it/expect API compatible with Vitest or Jest.
- If this repo uses Vitest, add: import { describe, it, expect, vi } from "vitest";
- If Jest, globals are available; swap vi.fn with jest.fn as needed.
*/
// packages/cannoli-core/src/nl-generator/__tests__/compiler.spec.ts
import { CanvasCompiler } from "../compiler";
// If types are available, import them; otherwise define minimal shapes used in tests.
type CanvasNodeBase = { id: string; x: number; y: number; width: number; height: number; };
type CanvasTextNode = CanvasNodeBase & { type: "text"; text: string; color?: string };
type CanvasFileNode = CanvasNodeBase & { type: "file"; file: string };
type CanvasLinkNode = CanvasNodeBase & { type: "link"; url: string };
type CanvasGroupNode = CanvasNodeBase & { type: "group"; label?: string; color?: string };
type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;
type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: "right";
  toSide: "left";
  color?: string;
  label?: string;
};
type CanvasData = { nodes: CanvasNode[]; edges: CanvasEdge[] };

// Minimal IR shapes used by compiler
type CannoliIntentNode = {
  id?: string;
  kind: "ai" | "content" | "action" | "formatter" | "reference" | "floating" | "file" | "link" | "group";
  text?: string;
  name?: string;
  file?: string;
  url?: string;
  action?: string;
  group?: { type?: "parallel" | "loop"; label?: string | number };
  attrs?: { width?: number; height?: number; color?: string };
};
type CannoliIntentEdge = {
  from: string;
  to: string;
  type?: "basic" | "variable" | "logging" | "config" | "field" | "choice" | "list" | "chat";
  label?: string;
  chatHistory?: "suppress" | "force";
  limits?: { messages?: number; tokens?: number };
};
type CannoliIntent = {
  nodes: CannoliIntentNode[];
  edges: CannoliIntentEdge[];
  io: { inputs: { name: string }[]; outputs: { name: string }[] };
  layout: { strategy: "dag" | "grid" | "auto" };
  meta: { defaults: { wrapInCannoliGroup?: boolean } };
};

const makeBaseIR = (overrides: Partial<CannoliIntent> = {}): CannoliIntent => ({
  nodes: [],
  edges: [],
  io: { inputs: [], outputs: [] },
  layout: { strategy: "auto" },
  meta: { defaults: { wrapInCannoliGroup: false } },
  ...overrides,
});

describe("CanvasCompiler.compileToCanvas", () => {
  it("generates IDs for nodes without IDs and preserves IDs for nodes with IDs", () => {
    const compiler = new CanvasCompiler();
    const ir: CannoliIntent = makeBaseIR({
      nodes: [
        { kind: "content", text: "A", attrs: { color: "auto" } },             // no id
        { id: "fixed", kind: "content", text: "B", attrs: { color: "6" } },   // fixed id
      ],
      edges: [{ from: "node_0", to: "fixed", type: "basic" }],
      layout: { strategy: "grid" },
    });

    const canvas = compiler.compileToCanvas(ir) as CanvasData;
    const ids = canvas.nodes.map(n => n.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("fixed");
    // The auto-generated id should be 16-char hex
    const genId = ids.find(id => id !== "fixed")!;
    expect(genId).toMatch(/^[0-9a-f]{16}$/);

    // Edge must map to generated IDs
    expect(canvas.edges).toHaveLength(1);
    expect(canvas.edges[0].fromNode).toBe(genId);
    expect(canvas.edges[0].toNode).toBe("fixed");
  });

  it("applies grid layout when strategy is grid or auto with cycles", () => {
    const compiler = new CanvasCompiler();
    const ir: CannoliIntent = makeBaseIR({
      nodes: [
        { id: "A", kind: "content", text: "A", attrs: { color: "auto" } },
        { id: "B", kind: "content", text: "B", attrs: { color: "auto" } },
        { id: "C", kind: "content", text: "C", attrs: { color: "auto" } },
      ],
      edges: [
        { from: "A", to: "B", type: "basic" },
        { from: "B", to: "A", type: "basic" }, // cycle
      ],
      layout: { strategy: "auto" },
    });

    const canvas = compiler.compileToCanvas(ir) as CanvasData;
    // positions should be populated
    canvas.nodes.forEach(n => {
      expect(typeof n.x).toBe("number");
      expect(typeof n.y).toBe("number");
    });
  });

  it("wraps output in a 'cannoli' group when requested", () => {
    const compiler = new CanvasCompiler();
    const ir: CannoliIntent = makeBaseIR({
      nodes: [
        { id: "n1", kind: "content", text: "X", attrs: { color: "auto" } },
        { id: "n2", kind: "content", text: "Y", attrs: { color: "auto" } },
      ],
      edges: [{ from: "n1", to: "n2", type: "basic" }],
      layout: { strategy: "dag" },
      meta: { defaults: { wrapInCannoliGroup: true } },
    });

    const canvas = compiler.compileToCanvas(ir) as CanvasData;
    // Group should be first node and type group with label "cannoli"
    expect(canvas.nodes[0]).toMatchObject({ type: "group", label: "cannoli" });
    // Bounding box should contain the other nodes
    const others = canvas.nodes.slice(1);
    others.forEach(n => {
      expect(n.x).toBeGreaterThanOrEqual((canvas.nodes[0] as any).x);
      expect(n.y).toBeGreaterThanOrEqual((canvas.nodes[0] as any).y);
    });
  });
});

describe("CanvasCompiler.compileNode", () => {
  it("creates AI/content/action/formatter/reference/floating/file/link/group nodes with correct defaults", () => {
    const compiler = new CanvasCompiler();

    // Private method; test via compileToCanvas with single node inputs to observe output shape.
    const mk = (n: CannoliIntentNode): CanvasData => compiler.compileToCanvas(makeBaseIR({ nodes: [n], edges: [], layout: { strategy: "grid" } })) as CanvasData;

    // ai
    let canvas = mk({ kind: "ai", text: "AI text" });
    expect(canvas.nodes[0]).toMatchObject({ type: "text", text: "AI text" });

    // content with auto color -> "6"
    canvas = mk({ kind: "content", text: "Content", attrs: { color: "auto" } });
    expect(canvas.nodes[0]).toMatchObject({ type: "text", text: "Content", color: "6" });

    // action default color "2" and formatted text for http action
    canvas = mk({ kind: "action", action: "http", text: "" , attrs: { color: "auto" }});
    expect(canvas.nodes[0].type).toBe("text");
    const actionText = (canvas.nodes[0] as any).text as string;
    expect(actionText).toContain('"method": "GET"');
    expect((canvas.nodes[0] as any).color).toBe("2");

    // formatter wraps in quotes and purple if auto
    canvas = mk({ kind: "formatter", text: "fmt", attrs: { color: "auto" }});
    expect(canvas.nodes[0]).toMatchObject({ type: "text", text: '"fmt"', color: "6" });

    // reference formats with {{ }}
    canvas = mk({ kind: "reference", text: "Note", attrs: { color: "auto" }});
    expect(canvas.nodes[0]).toMatchObject({ type: "text", text: "{{Note}}", color: "6" });

    // floating uses [name]\\ntext and allows any color (no forced)
    canvas = mk({ kind: "floating", name: "Var", text: "val" });
    expect(canvas.nodes[0]).toMatchObject({ type: "text" });
    expect((canvas.nodes[0] as any).text).toBe("[Var]\nval");

    // file
    canvas = mk({ kind: "file", file: "a.md" });
    expect(canvas.nodes[0]).toMatchObject({ type: "file", file: "a.md" });

    // link
    canvas = mk({ kind: "link", url: "https://x.test" });
    expect(canvas.nodes[0]).toMatchObject({ type: "link", url: "https://x.test" });

    // group with parallel color cyan "5"
    canvas = mk({ kind: "group", group: { type: "parallel", label: "P" }});
    expect(canvas.nodes[0]).toMatchObject({ type: "group", label: "P", color: "5" });
  });
});

describe("CanvasCompiler.compileEdge", () => {
  const baseNodes: CannoliIntentNode[] = [
    { id: "A", kind: "content", text: "A", attrs: { color: "auto" } },
    { id: "B", kind: "content", text: "B", attrs: { color: "auto" } },
  ];
  const mk = (edge: CannoliIntentEdge): CanvasData => {
    const compiler = new CanvasCompiler();
    return compiler.compileToCanvas(makeBaseIR({
      nodes: baseNodes,
      edges: [edge],
      layout: { strategy: "grid" },
    })) as CanvasData;
  };

  it("drops edges referencing missing nodes", () => {
    const compiler = new CanvasCompiler();
    const ir = makeBaseIR({
      nodes: baseNodes,
      edges: [{ from: "X", to: "B", type: "basic" }],
      layout: { strategy: "grid" },
    });
    // Internals return null for missing IDs; compileToCanvas should ignore them (no edges)
    const canvas = compiler.compileToCanvas(ir) as CanvasData;
    expect(canvas.edges).toHaveLength(0);
  });

  it("creates basic/variable/logging/config/field/choice/list/chat edges with styles/labels", () => {
    // basic (no color/label)
    let c = mk({ from: "A", to: "B", type: "basic" });
    expect(c.edges[0]).not.toHaveProperty("color");
    expect(c.edges[0]).not.toHaveProperty("label");

    // variable default label
    c = mk({ from: "A", to: "B", type: "variable" });
    expect(c.edges[0]).toMatchObject({ label: "variable" });

    // logging orange
    c = mk({ from: "A", to: "B", type: "logging" });
    expect(c.edges[0]).toMatchObject({ color: "2" });

    // config orange with default label
    c = mk({ from: "A", to: "B", type: "config" });
    expect(c.edges[0]).toMatchObject({ color: "2", label: "config" });

    // field purple with default label
    c = mk({ from: "A", to: "B", type: "field" });
    expect(c.edges[0]).toMatchObject({ color: "6", label: "field" });

    // choice label + history modifiers
    c = mk({ from: "A", to: "B", type: "choice", label: "opt" });
    expect(c.edges[0]).toMatchObject({ color: "3", label: "opt" });
    c = mk({ from: "A", to: "B", type: "choice", label: "opt", chatHistory: "suppress" });
    expect(c.edges[0]).toMatchObject({ label: "opt~" });
    c = mk({ from: "A", to: "B", type: "choice", label: "opt", chatHistory: "force" });
    expect(c.edges[0]).toMatchObject({ label: "opt|" });

    // list cyan with custom label
    c = mk({ from: "A", to: "B", type: "list", label: "items" });
    expect(c.edges[0]).toMatchObject({ color: "5", label: "items" });

    // chat label from limits + history modifiers
    c = mk({ from: "A", to: "B", type: "chat", limits: { messages: 5 } });
    expect(c.edges[0]).toMatchObject({ color: "4", label: "5" });
    c = mk({ from: "A", to: "B", type: "chat", limits: { tokens: 2048 } });
    expect(c.edges[0]).toMatchObject({ color: "4", label: "#2048" });
    c = mk({ from: "A", to: "B", type: "chat", limits: { messages: 3 }, chatHistory: "suppress" });
    expect(c.edges[0]).toMatchObject({ label: "3~" });
    c = mk({ from: "A", to: "B", type: "chat", limits: { tokens: 10 }, chatHistory: "force" });
    expect(c.edges[0]).toMatchObject({ label: "#10|" });
  });
});

describe("CanvasCompiler.validateIR", () => {
  it("flags duplicate node IDs and invalid edges", () => {
    const compiler = new CanvasCompiler();
    const ir: CannoliIntent = makeBaseIR({
      nodes: [{ id: "A", kind: "content", text: "" , attrs: { color: "auto" } }, { id: "A", kind: "content", text: "" , attrs: { color: "auto" } }],
      edges: [{ from: "A", to: "B" }, { from: "X", to: "A" }],
      io: { inputs: [], outputs: [] },
      layout: { strategy: "grid" },
    });
    const res = compiler.validateIR(ir);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        "Duplicate node ID: A",
        "Edge references non-existent to node: B",
        "Edge references non-existent from node: X",
      ])
    );
  });

  it("validates IO names as valid JS identifiers", () => {
    const compiler = new CanvasCompiler();
    const ir: CannoliIntent = makeBaseIR({
      nodes: [],
      edges: [],
      io: {
        inputs: [{ name: "ok" }, { name: "1bad" }, { name: "also_bad-*" }],
        outputs: [{ name: "_valid" }, { name: "$bad space" }],
      },
      layout: { strategy: "grid" },
    });
    const res = compiler.validateIR(ir);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        "Invalid Input/Output name: 1bad. Must be a valid JavaScript identifier.",
        "Invalid Input/Output name: also_bad-*. Must be a valid JavaScript identifier.",
        "Invalid Input/Output name: $bad space. Must be a valid JavaScript identifier.",
      ])
    );
    // OK names should not be flagged
    expect(res.errors).not.toEqual(expect.arrayContaining(["Invalid Input/Output name: ok. Must be a valid JavaScript identifier."]));
    expect(res.errors).not.toEqual(expect.arrayContaining(["Invalid Input/Output name: _valid. Must be a valid JavaScript identifier."]));
  });

  it("warns when cycles or parallel/loop groups are present", () => {
    const compiler = new CanvasCompiler();
    const ir: CannoliIntent = makeBaseIR({
      nodes: [
        { id: "A", kind: "content", text: "", attrs: { color: "auto" } },
        { id: "B", kind: "content", text: "", attrs: { color: "auto" } },
        { id: "G", kind: "group", group: { type: "parallel" } },
      ],
      edges: [{ from: "A", to: "B" }, { from: "B", to: "A" }],
      layout: { strategy: "grid" },
    });
    const res = compiler.validateIR(ir);
    expect(res.warnings).toEqual(
      expect.arrayContaining([
        "Potential cycles detected in workflow. This may cause infinite loops unless using Loop groups.",
        "Workflow contains parallel or loop operations which may generate multiple LLM requests and increase costs.",
      ])
    );
  });
});

describe("CanvasCompiler.generateId", () => {
  it("creates 16-char lowercase hex strings and should not collide over many generations", () => {
    const compiler = new CanvasCompiler();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = (compiler as any).generateId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });
});