/* 
  Unit tests for Zod schemas defined in ../types.test.ts

  Testing library/framework note:
  - If the repository uses Vitest, the following imports will resolve from 'vitest'.
  - If the repository uses Jest, these imports will be ignored by type checker; in runtime, globals exist.
  To support both without adding deps, we try importing from 'vitest' and fallback to globals when Jest is used.
*/
/* eslint-disable @typescript-eslint/no-explicit-any */
let testApi: any;
try {
  // Prefer vitest if present.
  // eslint-disable-next-line import/no-extraneous-dependencies
  testApi = require('vitest');
} catch {
  // Fallback to Jest globals
  testApi = {
    describe: global.describe,
    it: global.it,
    test: global.test ?? global.it,
    expect: global.expect,
  };
}
const { describe, it, test, expect } = testApi as {
  describe: typeof global.describe;
  it: typeof global.it;
  test: typeof global.it;
  expect: typeof global.expect;
};

import {
  cannoliIntentMetaSchema,
  cannoliIntentIOSchema,
  cannoliIntentNodeSchema,
  cannoliIntentEdgeSchema,
  cannoliIntentLayoutSchema,
  cannoliIntentSchema,
} from "../types.test";

describe("cannoliIntentMetaSchema", () => {
  it("parses minimal valid meta and applies defaults inside defaults object", () => {
    const parsed = cannoliIntentMetaSchema.parse({
      title: "T",
      description: "D",
    });
    expect(parsed.title).toBe("T");
    expect(parsed.description).toBe("D");
    // defaults object should exist and inner non-optional defaults applied
    expect(parsed.defaults.aiProvider).toBe("openai");
    expect(parsed.defaults.temperature).toBe(0.7);
    expect(parsed.defaults.wrapInCannoliGroup).toBe(true);
    // assumptions default to empty array
    expect(parsed.assumptions).toEqual([]);
  });

  it("rejects invalid aiProvider values", () => {
    expect(() =>
      cannoliIntentMetaSchema.parse({
        title: "T",
        description: "D",
        defaults: { aiProvider: "unknown" as any },
      })
    ).toThrow();
  });

  it("accepts optional fields when provided", () => {
    const parsed = cannoliIntentMetaSchema.parse({
      title: "Meta",
      description: "Desc",
      assumptions: ["a1", "a2"],
      defaults: { model: "gpt-4", enableVision: true },
    });
    expect(parsed.assumptions).toEqual(["a1", "a2"]);
    expect(parsed.defaults.model).toBe("gpt-4");
    expect(parsed.defaults.enableVision).toBe(true);
  });
});

describe("cannoliIntentIOSchema", () => {
  it("defaults inputs/outputs to empty arrays", () => {
    const parsed = cannoliIntentIOSchema.parse({});
    expect(parsed.inputs).toEqual([]);
    expect(parsed.outputs).toEqual([]);
  });

  it("accepts named inputs with optional initial values", () => {
    const parsed = cannoliIntentIOSchema.parse({
      inputs: [{ name: "query", initial: "hello" }, { name: "lang" }],
      outputs: [{ name: "answer" }],
    });
    expect(parsed.inputs[0]).toEqual({ name: "query", initial: "hello" });
    expect(parsed.inputs[1]).toEqual({ name: "lang" });
    expect(parsed.outputs[0]).toEqual({ name: "answer" });
  });
});

describe("cannoliIntentNodeSchema", () => {
  it("parses minimal node with required kind and defaulted attrs object", () => {
    const parsed = cannoliIntentNodeSchema.parse({
      kind: "content",
    });
    expect(parsed.kind).toBe("content");
    // attrs object itself defaults to {}, but its internal fields are optional
    expect(parsed.attrs).toEqual({});
    // config is optional; given schema chains .default({}).optional(), expect undefined unless provided
    expect(parsed.config).toBeUndefined();
  });

  it("validates id as 16 hex characters (case-insensitive)", () => {
    // valid
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "ai", id: "abcdef0123456789" })
    ).not.toThrow();
    // invalid: non-hex char 'g'
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "ai", id: "0123456789ABCDEG" as any })
    ).toThrow();
    // invalid: wrong length
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "ai", id: "abc" as any })
    ).toThrow();
  });

  it("validates enum fields and unions", () => {
    // invalid kind
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "invalid" as any })
    ).toThrow();

    // group with string label
    expect(() =>
      cannoliIntentNodeSchema.parse({
        kind: "group",
        group: { type: "basic", label: "Section A" },
      })
    ).not.toThrow();

    // group with number label
    expect(() =>
      cannoliIntentNodeSchema.parse({
        kind: "group",
        group: { type: "loop", label: 1 },
      })
    ).not.toThrow();

    // invalid group label type (boolean)
    expect(() =>
      cannoliIntentNodeSchema.parse({
        kind: "group",
        group: { type: "parallel", label: true as any },
      })
    ).toThrow();
  });

  it("validates color values correctly", () => {
    // Accept allowed literals
    for (const c of ["auto", "1", "2", "3", "4", "5", "6"]) {
      expect(() =>
        cannoliIntentNodeSchema.parse({ kind: "content", attrs: { color: c as any } })
      ).not.toThrow();
    }
    // Accept valid hex color
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "content", attrs: { color: "#A1B2C3" } })
    ).not.toThrow();

    // Reject invalid hex color
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "content", attrs: { color: "#GGHHII" as any } })
    ).toThrow();
  });

  it("accepts config with various optional settings and stop unions", () => {
    const single = cannoliIntentNodeSchema.parse({
      kind: "ai",
      config: { model: "gpt-4o", stop: "STOP" },
    });
    expect(single.config?.stop).toBe("STOP");

    const multi = cannoliIntentNodeSchema.parse({
      kind: "ai",
      config: { stop: ["END", "DONE"] },
    });
    expect(multi.config?.stop).toEqual(["END", "DONE"]);

    // invalid: stop is number
    expect(() =>
      cannoliIntentNodeSchema.parse({ kind: "ai", config: { stop: 123 as any } })
    ).toThrow();
  });
});

describe("cannoliIntentEdgeSchema", () => {
  it("parses valid edges with required fields", () => {
    const parsed = cannoliIntentEdgeSchema.parse({
      from: "n1",
      to: "n2",
      type: "basic",
      label: "flows to",
    });
    expect(parsed.from).toBe("n1");
    expect(parsed.to).toBe("n2");
    expect(parsed.type).toBe("basic");
  });

  it("accepts chat-specific options and limits when provided", () => {
    const parsed = cannoliIntentEdgeSchema.parse({
      from: "a",
      to: "b",
      type: "chat",
      chatHistory: "force",
      limits: { messages: 50, tokens: 2000 },
    });
    expect(parsed.type).toBe("chat");
    expect(parsed.chatHistory).toBe("force");
    expect(parsed.limits).toEqual({ messages: 50, tokens: 2000 });
  });

  it("rejects invalid type and missing required fields", () => {
    expect(() =>
      cannoliIntentEdgeSchema.parse({ from: "x", to: "y", type: "weird" as any })
    ).toThrow();
    expect(() =>
      cannoliIntentEdgeSchema.parse({ to: "y", type: "basic" } as any)
    ).toThrow();
    expect(() =>
      cannoliIntentEdgeSchema.parse({ from: "x", type: "basic" } as any)
    ).toThrow();
  });
});

describe("cannoliIntentLayoutSchema", () => {
  it("defaults strategy to 'dag' when layout object is provided empty or defaulted", () => {
    const parsed = cannoliIntentLayoutSchema.parse({});
    expect(parsed.strategy).toBe("dag");
  });

  it("accepts laneHints entries with valid lanes", () => {
    const parsed = cannoliIntentLayoutSchema.parse({
      strategy: "grid",
      laneHints: [
        { id: "n1", lane: "source" },
        { id: "n2", lane: "process" },
        { id: "n3", lane: "sink" },
      ],
    });
    expect(parsed.strategy).toBe("grid");
    expect(parsed.laneHints?.length).toBe(3);
  });
});

describe("cannoliIntentSchema (end-to-end)", () => {
  it("parses a minimal but valid intent and applies key defaults", () => {
    const intent = cannoliIntentSchema.parse({
      meta: { title: "Demo", description: "Example" },
      io: {},
      nodes: [{ kind: "content", name: "Welcome", text: "Hello" }],
      edges: [{ from: "n1", to: "n2", type: "basic" }],
      // layout omitted to test default on layout object and its strategy
    });

    // io defaults applied
    expect(intent.io.inputs).toEqual([]);
    expect(intent.io.outputs).toEqual([]);

    // meta.defaults inner defaults applied
    expect(intent.meta.defaults.aiProvider).toBe("openai");
    expect(intent.meta.defaults.temperature).toBe(0.7);
    expect(intent.meta.defaults.wrapInCannoliGroup).toBe(true);

    // layout default object and strategy default
    expect(intent.layout.strategy).toBe("dag");
  });

  it("rejects when required top-level parts are invalid", () => {
    // nodes invalid: missing kind
    expect(() =>
      cannoliIntentSchema.parse({
        meta: { title: "Bad", description: "No kind in node" },
        io: {},
        nodes: [{}],
        edges: [],
      } as any)
    ).toThrow();

    // edges invalid: missing required fields
    expect(() =>
      cannoliIntentSchema.parse({
        meta: { title: "Bad", description: "Invalid edge" },
        io: {},
        nodes: [{ kind: "ai" }],
        edges: [{ from: "a", type: "basic" }] as any,
      })
    ).toThrow();
  });
});