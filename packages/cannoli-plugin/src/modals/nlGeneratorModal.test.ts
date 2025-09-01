/**
 * Test framework: prefers existing project setup. This suite uses Vitest-style APIs (compatible with Jest in most cases).
 * If the project uses Vitest, run with: vitest
 * If Jest is used, the syntax remains largely compatible; adjust imports/globals as needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// SUT
import { NLGeneratorModal } from "./nlGeneratorModal";

// Mock obsidian minimal surface needed by NLGeneratorModal
vi.mock("obsidian", () => {
  class FakeModal {
    app: any;
    modalEl: HTMLDivElement;
    contentEl: HTMLDivElement;
    constructor(app: any) {
      this.app = app;
      this.modalEl = document.createElement("div");
      this.modalEl.className = "modal";
      this.contentEl = document.createElement("div");
      this.modalEl.appendChild(this.contentEl);
    }
    open() {
      // In Obsidian, open() triggers onOpen; call it manually in tests when needed
      (this as any).onOpen?.();
    }
    close() {
      (this as any).onClose?.();
      this.modalEl.remove();
    }
  }

  class FakeNotice {
    static lastMessages: string[] = [];
    constructor(message: string) {
      FakeNotice.lastMessages.push(message);
    }
    static clear() {
      FakeNotice.lastMessages = [];
    }
  }

  class FakeSetting {
    nameEl = document.createElement("div");
    descEl = document.createElement("div");
    settingEl = document.createElement("div");
    constructor(containerEl: HTMLElement) {
      containerEl.appendChild(this.settingEl);
    }
    setName(name: string) {
      this.nameEl.textContent = name;
      this.settingEl.appendChild(this.nameEl);
      return this;
    }
    setDesc(desc: string) {
      this.descEl.textContent = typeof desc === "string" ? desc : "";
      this.settingEl.appendChild(this.descEl);
      return this;
    }
    addTextArea(cb: (comp: any) => void) {
      const ta = new FakeTextAreaComponent();
      cb(ta);
      this.settingEl.appendChild(ta.inputEl);
      return this;
    }
  }

  class FakeTextAreaComponent {
    inputEl: HTMLTextAreaElement;
    constructor() {
      this.inputEl = document.createElement("textarea");
      (this.inputEl as any).value = "";
    }
    setPlaceholder(v: string) {
      this.inputEl.placeholder = v;
      return this;
    }
    setValue(v: string) {
      this.inputEl.value = v;
      return this;
    }
    getValue() {
      return this.inputEl.value;
    }
  }

  return {
    App: class {},
    Modal: FakeModal,
    Notice: FakeNotice as any,
    Setting: FakeSetting as any,
    TextAreaComponent: FakeTextAreaComponent as any,
  };
});

// Mock cannoli-core generation function
const mockGenerate = vi.fn();
vi.mock("@deablabs/cannoli-core", () => ({
  generateCanvasFromNL: (...args: any[]) => mockGenerate(...args),
}));

// Import mocks' types after vi.mock for TypeScript awareness
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Notice } = require("obsidian");

function flushTimers() {
  return new Promise<void>((res) => {
    // Allow setTimeout(…, 0) in onOpen to run
    setTimeout(() => res(), 0);
  });
}

describe("NLGeneratorModal", () => {
  let onSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clear existing DOM elements safely without using innerHTML to avoid XSS concerns
    document.body.replaceChildren();
    onSubmit = vi.fn();
    mockGenerate.mockReset();
    Notice.clear?.();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as any).mockRestore?.();
  });

  it("renders headings, description, examples and controls on open", async () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    // Simulate open lifecycle
    (modal as any).onOpen();
    await flushTimers();

    const { contentEl } = modal as any;

    // Headings and description
    const h2 = contentEl.querySelector("h2");
    expect(h2?.textContent).toContain("Generate Cannoli from Natural Language");

    const p = contentEl.querySelector("p");
    expect(p?.textContent).toMatch(/Describe your workflow in natural language/);

    // Examples list with 4 code items
    const examples = contentEl.querySelectorAll(".nl-generator-examples ul li code");
    expect(examples.length).toBe(4);

    // Textarea presence and attributes
    const textarea = contentEl.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea!.placeholder).toMatch(/summarize/);

    // Buttons and styling on modal element
    const buttonsContainer = contentEl.querySelector(".nl-generator-buttons");
    expect(buttonsContainer).not.toBeNull();
    const btns = buttonsContainer!.querySelectorAll("button");
    expect(Array.from(btns).map(b => b.textContent)).toEqual(["Cancel", "Generate Canvas"]);

    expect((modal as any).modalEl.style.width).toBe("600px");
    expect((modal as any).modalEl.style.maxWidth).toBe("90vw");
  });

  it("shows notice and does not call generate when textarea is empty", async () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    (modal as any).onOpen();
    await flushTimers();

    // Ensure textarea is empty
    const ta = (modal as any).textArea;
    ta.setValue("");

    await (modal as any).handleGenerate();

    expect(Notice.lastMessages.at(-1)).toMatch(/Please enter a description/);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("passes input and options to generateCanvasFromNL and submits on success without warnings/questions", async () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    (modal as any).onOpen();
    await flushTimers();

    const input = "Ask the AI to say hello";
    (modal as any).textArea.setValue(input);

    const fakeResult = {
      canvas: { nodes: [], edges: [] },
      report: { questions: [], warnings: [] },
    };
    mockGenerate.mockResolvedValueOnce(fakeResult);

    await (modal as any).handleGenerate();

    expect(mockGenerate).toHaveBeenCalledWith(input, {
      wrapInCannoliGroup: true,
      includeIR: false,
    });
    expect(onSubmit).toHaveBeenCalledWith(fakeResult.canvas, fakeResult.report);
  });

  it("shows warnings notice but still calls onSubmit when warnings are present", async () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    (modal as any).onOpen();
    await flushTimers();

    (modal as any).textArea.setValue("Workflow with warning");
    const fakeResult = {
      canvas: { nodes: [{ id: "1" }], edges: [] },
      report: { questions: [], warnings: ["Minor issue A", "Minor issue B"] },
    };
    mockGenerate.mockResolvedValueOnce(fakeResult);

    await (modal as any).handleGenerate();

    // The most recent notice should be the warnings one, but "Generating canvas..." is also shown
    expect(Notice.lastMessages.some((m: string) => /Generated with warnings: Minor issue A, Minor issue B/.test(m))).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith(fakeResult.canvas, fakeResult.report);
  });

  it("shows failure notice and does not submit when questions are present", async () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    (modal as any).onOpen();
    await flushTimers();

    (modal as any).textArea.setValue("Ambiguous workflow");
    const fakeResult = {
      canvas: { nodes: [], edges: [] },
      report: { questions: ["Missing input {{text}}"], warnings: [] },
    };
    mockGenerate.mockResolvedValueOnce(fakeResult);

    await (modal as any).handleGenerate();

    expect(Notice.lastMessages.some((m: string) => /Generation failed: Missing input/.test(m))).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("handles thrown error: logs and shows failure notice", async () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    (modal as any).onOpen();
    await flushTimers();

    (modal as any).textArea.setValue("Cause exception");
    const err = new Error("Boom");
    mockGenerate.mockRejectedValueOnce(err);

    await (modal as any).handleGenerate();

    expect(console.error).toHaveBeenCalledWith("NL Generation error:", err);
    expect(Notice.lastMessages.at(-1)).toMatch(/Failed to generate canvas: Boom/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("onClose empties contentEl", () => {
    const modal = new NLGeneratorModal({} as any, onSubmit);
    (modal as any).onOpen();
    const { contentEl } = modal as any;
    expect(contentEl.childElementCount).toBeGreaterThan(0);

    (modal as any).onClose();

    expect(contentEl.childElementCount).toBe(0);
  });
});