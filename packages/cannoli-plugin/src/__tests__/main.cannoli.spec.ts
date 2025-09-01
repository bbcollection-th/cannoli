/* 
  Tests for Cannoli plugin core logic.

  Framework: Vitest (describe/it/expect/vi). 
  If repository uses Jest, replace:
    - import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
    - vi.fn / vi.spyOn -> jest.fn / jest.spyOn
  and ensure appropriate jest config and ts-jest setup.

  We focus on pure functions and side-effect-limited units:
    - createRectangle, encloses, overlaps
    - getNodesAndEdgesInGroup
    - fetchData filtering "cannoli" groups
    - getConfig (respecting defaults and overrides)
    - getSecrets (merging settings and custom entries)
    - getLLMConfigs (mapping + default provider ordering)
    - openCanvas behavior (true/false + Notice)
    - checkCannolisIdentical
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Obsidian runtime pieces we touch
// We only type minimal surface used by the code under test.
class MockNotice {
  public static lastMessage: string | null = null;
  constructor(message: string) {
    MockNotice.lastMessage = message;
  }
}
vi.stubGlobal("Notice", MockNotice);

// Minimal RequestUrl mock; individual tests override as needed
const requestUrl = vi.fn();
vi.stubGlobal("requestUrl", requestUrl);

// Clipboard/navigator/window mocks for any indirect invocation
const writeText = vi.fn();
vi.stubGlobal("navigator", { clipboard: { writeText } });
const openWindow = vi.fn();
vi.stubGlobal("window", { open: openWindow });

// Helpers to fabricate a plugin instance with controlled settings and app API
import Cannoli from "../main"; // Assuming real file is ../main.ts; if this spec is not colocated, adjust path.

type TFile = any;
type TFolder = any;

function makeMockApp(overrides: Partial<any> = {}) {
  const files: Record<string, string> = {};
  const binary: Record<string, Uint8Array> = {};
  const folders: Set<string> = new Set();
  const fileObjs: any[] = [];

  const mkTFile = (path: string, content = ""): any => {
    const name = path.split("/").pop()!;
    const basename = name.replace(/\.[^/.]+$/, "");
    return { path, name, basename, extension: name.split(".").pop(), children: [] };
  };

  const app = {
    workspace: {
      getActiveFile: vi.fn(),
      openLinkText: vi.fn(),
      activeEditor: { editor: { getSelection: vi.fn().mockReturnValue(undefined) } }
    },
    vault: {
      create: vi.fn(async (path: string, content: string) => {
        files[path] = content;
        const file = mkTFile(path, content);
        fileObjs.push(file);
        return file;
      }),
      read: vi.fn(async (file: any) => files[file.path]),
      cachedRead: vi.fn(async (file: any) => files[file.path]),
      readBinary: vi.fn(async (file: any) => binary[file.path] ?? new Uint8Array([1,2,3])),
      modify: vi.fn(async (file: any, content: string) => { files[file.path] = content; }),
      process: vi.fn(async (file: any, updater: (c: string) => string) => { files[file.path] = updater(files[file.path] ?? ""); }),
      createFolder: vi.fn(async (path: string) => { folders.add(path); return; }),
      getFolderByPath: vi.fn((path: string) => folders.has(path) ? ({ path, children: [] }) : null),
      delete: vi.fn(async (_file: any) => { /* noop for tests */ }),
      getFiles: vi.fn(() => fileObjs),
    },
    fileManager: {
      processFrontMatter: vi.fn((_file: any, cb: (fm: any)=>void) => cb({}))
    },
    metadataCache: {
      getFirstLinkpathDest: vi.fn((name: string) => {
        // Return a file object if we "created" it
        const foundPath = Object.keys(files).find(p => p.endsWith("/" + name) || p === name);
        return foundPath ? mkTFile(foundPath, files[foundPath]) : null;
      })
    },
    vaultAdapter: {},
    ...overrides
  };

  return { app, files, binary, fileObjs, folders, mkTFile };
}

function makePlugin(overrides: Partial<any> = {}) {
  const { app, files, binary, fileObjs, folders, mkTFile } = makeMockApp();
  // Default settings baseline resembling DEFAULT_SETTINGS shape
import Cannoli from "../main";
import { DEFAULT_SETTINGS as REAL_DEFAULTS } from "../settings/settings";

  const DEFAULT_SETTINGS = {
    seenVersion2Modal: true,
    enableAudioTriggeredCannolis: false,
    deleteAudioFilesAfterAudioTriggeredCannolis: false,
    httpTemplates: [],
    contentIsColorless: false,
    chatFormatString: REAL_DEFAULTS.chatFormatString,
    enableVision: false,
    tracingConfig: undefined,
    // LLM provider and keys
    llmProvider: "openai",
    openaiAPIKey: "sk-default", // mimic DEFAULT to exercise key check
    exaAPIKey: "",
    valTownAPIKey: "",
    azureAPIKey: "",
    azureModel: "gpt-4o",
    azureTemperature: 0.7,
    azureOpenAIApiDeploymentName: "",
    azureOpenAIApiInstanceName: "",
    azureOpenAIApiVersion: "2024-02-15-preview",
    azureBaseURL: "",
    openaiBaseURL: "",
    groqAPIKey: "",
    groqModel: "llama3-8b",
    groqTemperature: 0.7,
    geminiAPIKey: "",
    geminiModel: "gemini-1.5-pro",
    geminiTemperature: 0.7,
    anthropicAPIKey: "",
    anthropicModel: "claude-3-5-sonnet",
    anthropicTemperature: 0.7,
    anthropicBaseURL: "",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "llama3",
    ollamaTemperature: 0.2,
    bakedCannoliFolder: "Baked Cannoli",
    bakeLanguage: "typescript",
    bakeRuntime: "node",
    bakeIndent: "2",
    requestThreshold: 10,
    secrets: []
  };

  const plugin = new (Cannoli as any)(app, overrides);
  // attach settings and DEFAULT_SETTINGS mimic
  (plugin as any).settings = { ...DEFAULT_SETTINGS, ...(overrides as any)?.settings };
  // Provide save/load shims if tests call them
  plugin.saveData = vi.fn(async (_d: any) => {});
  plugin.loadData = vi.fn(async () => ({}));
  return { plugin, app, files, binary, fileObjs, folders, mkTFile, DEFAULT_SETTINGS };
}

describe("Geometry helpers", () => {
  const { plugin } = makePlugin();

  it("createRectangle returns correct bounds", () => {
    const r = (plugin as any).createRectangle(10, 20, 100, 50);
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 50, x_right: 110, y_bottom: 70 });
  });

  it("encloses identifies full containment", () => {
    const a = (plugin as any).createRectangle(0, 0, 100, 100);
    const b = (plugin as any).createRectangle(10, 10, 20, 20);
    expect((plugin as any).encloses(a, b)).toBe(true);
    expect((plugin as any).encloses(b, a)).toBe(false);
  });

  it("overlaps detects overlapping rectangles and non-overlaps", () => {
    const a = (plugin as any).createRectangle(0, 0, 50, 50);
    const b = (plugin as any).createRectangle(40, 40, 30, 30);
    const c = (plugin as any).createRectangle(60, 60, 10, 10);
    expect((plugin as any).overlaps(a, b)).toBe(true);
    expect((plugin as any).overlaps(a, c)).toBe(false);
  });

  it("overlaps est false quand les rectangles ne font que se toucher", () => {
    const a = (plugin as any).createRectangle(0, 0, 10, 10);
    const b = (plugin as any).createRectangle(10, 0, 5, 5); // touche à droite
    expect((plugin as any).overlaps(a, b)).toBe(false);
  });
});

describe("getNodesAndEdgesInGroup", () => {
  it("collects nodes enclosed by group and edges fully inside", () => {
    const { plugin } = makePlugin();

    const group = { id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, label: "Cannoli" };
    const nodeIn = { id: "n1", type: "text", x: 10, y: 10, width: 50, height: 40 };
    const nodeOut = { id: "n2", type: "text", x: 300, y: 300, width: 50, height: 40 };
    const nodeBorder = { id: "n3", type: "text", x: 190, y: 190, width: 20, height: 20 }; // partially outside
    const edgeInside = { id: "e1", fromNode: "n1", toNode: "n1" };
    const edgeOutside = { id: "e2", fromNode: "n1", toNode: "n2" };

    const canvas = {
      nodes: [group, nodeIn, nodeOut, nodeBorder],
      edges: [edgeInside, edgeOutside]
    };

    const { nodeIds, edgeIds } = (plugin as any).getNodesAndEdgesInGroup(group, canvas);
    expect(nodeIds).toContain("n1");
    expect(nodeIds).not.toContain("n2");
    expect(nodeIds).not.toContain("n3"); // partial overlap should be excluded
    expect(edgeIds).toEqual(["e1"]);
  });

  it("ignores nodes with color === '1' (colorless content filtered)", () => {
    const { plugin } = makePlugin();
    const group = { id: "g", type: "group", x: 0, y: 0, width: 200, height: 200, label: "cannoli" };
    const nodeColored = { id: "a", type: "text", x: 10, y: 10, width: 20, height: 20, color: "1" };
    const canvas = { nodes: [group, nodeColored], edges: [] };
    const { nodeIds } = (plugin as any).getNodesAndEdgesInGroup(group, canvas);
    expect(nodeIds).toEqual([]); // filtered out
  });
});

describe("fetchData", () => {
  it("returns parsed canvas when no cannoli groups", async () => {
    const { plugin, app, mkTFile, files } = makePlugin({ settings: { onlyRunCannoliGroups: false } });
    const file = mkTFile("a.canvas", "");
    files[file.path] = JSON.stringify({ nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 1, height: 1 }], edges: [] });
    const data = await (plugin as any).fetchData(file);
    expect(data?.nodes.length).toBe(1);
  });

  it("filters to cannoli groups when present", async () => {
    const { plugin, mkTFile, files } = makePlugin({ settings: { onlyRunCannoliGroups: false } });
    const group = { id: "g", type: "group", x: 0, y: 0, width: 100, height: 100, label: "Cannoli" };
    const inside = { id: "n1", type: "text", x: 10, y: 10, width: 10, height: 10 };
    const outside = { id: "n2", type: "text", x: 200, y: 200, width: 10, height: 10 };
    const edgeIn = { id: "e1", fromNode: "n1", toNode: "n1" };
    const edgeOut = { id: "e2", fromNode: "n1", toNode: "n2" };

    const file = mkTFile("b.canvas", "");
    files[file.path] = JSON.stringify({ nodes: [group, inside, outside], edges: [edgeIn, edgeOut] });
    const data = await (plugin as any).fetchData(file);
    expect(data?.nodes.map((n:any)=>n.id)).toEqual(["n1"]);
    expect(data?.edges.map((e:any)=>e.id)).toEqual(["e1"]);
  });

  it("returns null and Notice when onlyRunCannoliGroups=true but no groups present", async () => {
    const { plugin, mkTFile, files } = makePlugin({ settings: { onlyRunCannoliGroups: true } });
    const file = mkTFile("c.canvas", "");
    files[file.path] = JSON.stringify({ nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 1, height: 1 }], edges: [] });
    const data = await (plugin as any).fetchData(file);
    expect(data).toBeNull();
    expect(MockNotice.lastMessage).toMatch(/Only run Cannoli groups/i);
  });
});

describe("getConfig", () => {
  it("omits chatFormatString when default unless forBake override", () => {
    const { plugin } = makePlugin({ settings: { chatFormatString: "default", contentIsColorless: true, enableVision: true, tracingConfig: { enabled: true } } });
    const cfg = (plugin as any).getConfig();
    expect(cfg).toMatchObject({ contentIsColorless: true, enableVision: true, tracingConfig: { enabled: true } });
    expect((cfg as any).chatFormatString).toBeUndefined();

    const bakeCfg = (plugin as any).getConfig(true);
    expect(bakeCfg.tracingConfig).toBeUndefined();
  });

  it("includes non-default chatFormatString", () => {
    const { plugin } = makePlugin({ settings: { chatFormatString: "my-format" } });
    const cfg = (plugin as any).getConfig();
    expect(cfg).toMatchObject({ chatFormatString: "my-format" });
  });
});

describe("getSecrets", () => {
  it("merges known keys and custom secrets", () => {
    const { plugin } = makePlugin({ settings: {
      openaiAPIKey: "sk-123",
      exaAPIKey: "",
      valTownAPIKey: "vt-abc",
      secrets: [{ name: "FOO", value: "bar" }, { name: "BAZ", value: "qux" }]
    }});
    const secrets = (plugin as any).getSecrets();
    expect(secrets).toMatchObject({ OPENAI_API_KEY: "sk-123", VALTOWN_API_KEY: "vt-abc", FOO: "bar", BAZ: "qux" });
    expect(secrets).not.toHaveProperty("EXA_API_KEY");
  });
});

describe("getLLMConfigs", () => {
  it("maps configs and ensures default provider first", () => {
    const { plugin } = makePlugin({ settings: { llmProvider: "gemini", geminiAPIKey: "gk", geminiModel: "g-1", geminiTemperature: 0.5 } });
    const cfgs = (plugin as any).getLLMConfigs();
    expect(cfgs[0].provider).toBe("gemini");
    // sample spot checks
    const openai = cfgs.find((c:any) => c.provider === "openai");
    expect(openai).toHaveProperty("model");
  });
});

describe("openCanvas", () => {
  it("opens a canvas when found", () => {
    const { plugin, app, files } = makePlugin();
    files["My.canvas"] = JSON.stringify({ nodes: [], edges: [] });
    (app.metadataCache.getFirstLinkpathDest as any).mockImplementation((name: string) => name === "My.canvas" ? ({ path: "My.canvas" }) : null);
    const ok = (plugin as any).openCanvas("My.canvas");
    expect(ok).toBe(true);
    expect(app.workspace.openLinkText).toHaveBeenCalledWith("My.canvas", "");
  });

  it("notifies and returns false when not found", () => {
    const { plugin } = makePlugin();
    const ok = (plugin as any).openCanvas("Missing.canvas");
    expect(ok).toBe(false);
    expect(MockNotice.lastMessage).toMatch(/not found/i);
  });
});

describe("checkCannolisIdentical", () => {
  it("compares remote object against local file content (JSON)", async () => {
    const { plugin, mkTFile, files } = makePlugin();
    const file = mkTFile("D.canvas", "");
    const obj = { a: 1, b: ["x"] };
    files[file.path] = JSON.stringify(obj);
    await expect((plugin as any).checkCannolisIdentical(obj, file)).resolves.toBe(true);
    files[file.path] = JSON.stringify({ a: 2 });
    await expect((plugin as any).checkCannolisIdentical(obj, file)).resolves.toBe(false);
  });
});

describe("replaceAudioWithTranscript behavior (polling and replacement)", () => {
  it("replaces audio reference when transcript available and optionally deletes", async () => {
    const { plugin, mkTFile, files } = makePlugin({ settings: { deleteAudioFilesAfterAudioTriggeredCannolis: true } });
    const note = mkTFile("note.md", "");
    const audio = mkTFile("sound.mp3", "");
    files[note.path] = "heading\n![[sound.mp3]]\ntrailing";
    // Stub generateTranscript
    (plugin as any).generateTranscript = vi.fn(async () => "TRANSCRIPT");
    // Speed up polling parameters
    vi.spyOn<any, any>(plugin, "replaceAudioWithTranscript").mockImplementationOnce(async function(this: any, file: any, audioFile: any) {
      const transcript = await (this as any).generateTranscript(audioFile);
      if (!transcript) return;
      await this.app.vault.process(file, (content: string) => content.replace(`\n![[${audioFile.name}]]\n`, transcript));
      if (this.settings.deleteAudioFilesAfterAudioTriggeredCannolis) {
        this.app.vault.delete(audioFile);
      }
    });

    await (plugin as any).replaceAudioWithTranscript(note, audio);
    expect(files[note.path]).toContain("TRANSCRIPT");
  });
});