import { App, Modal, Setting, TextAreaComponent, Notice } from "obsidian";
import { generateCanvasFromNL, CanvasData, GenerationResult, exampleWorkflows } from "@deablabs/cannoli-core";

export class NLGeneratorModal extends Modal {
  private textArea!: TextAreaComponent;
  private onSubmit: (canvas: CanvasData, report: GenerationResult["report"]) => void;

  constructor(app: App, onSubmit: (canvas: CanvasData, report: GenerationResult["report"]) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Generate Cannoli from Natural Language" });
		contentEl.createEl("p", { 
			text: "Describe your workflow in natural language and we'll generate a Cannoli canvas for you." 
		});

		// Examples section
		const examplesEl = contentEl.createDiv({ cls: "nl-generator-examples" });
		examplesEl.createEl("h3", { text: "Examples:" });
		const examplesList = examplesEl.createEl("ul");
		
		// Use examples from core package to avoid drift
		exampleWorkflows.forEach(ex => {
			const li = examplesList.createEl("li");
			li.createEl("code", { text: ex.input });
		});

		// Input area
		new Setting(contentEl)
			.setName("Describe your workflow")
			.setDesc("Enter a natural language description of the Cannoli workflow you want to create")
			.addTextArea(text => {
				this.textArea = text;
				text
					.setPlaceholder("e.g., 'Ask the AI to summarize {{article}} and write it to a note'")
					.setValue("");
				// Focus after render
				window.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.style.height = "150px";
					text.inputEl.style.width = "100%";
				}, 0);
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "nl-generator-buttons" });
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";
		buttonContainer.style.marginTop = "20px";

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", { text: "Cancel", attr: { type: "button" } });
		cancelButton.onclick = () => this.close();

		// Generate button
		const generateButton = buttonContainer.createEl("button", { 
			text: "Generate Canvas",
			cls: "mod-cta",
			attr: { type: "button" }
		});
		generateButton.onclick = async () => {
			generateButton.disabled = true;
			cancelButton.disabled = true;
			generateButton.setAttr("aria-busy", "true");
			try {
				await this.handleGenerate();
			} finally {
				generateButton.disabled = false;
				cancelButton.disabled = false;
				generateButton.removeAttribute("aria-busy");
			}
		};

		// Add some basic styling
		this.modalEl.style.width = "600px";
		this.modalEl.style.maxWidth = "90vw";
	}

	private async handleGenerate() {
		const input = this.textArea.getValue().trim();
		
		if (!input) {
			new Notice("Please enter a description of your workflow");
			return;
		}

		try {
			new Notice("Generating canvas...");
			
			const result = await generateCanvasFromNL(input, {
				wrapInCannoliGroup: true,
				includeIR: false,
			});

			if (result.report.questions.length > 0) {
				new Notice(`Generation failed: ${result.report.questions.join(", ")}`);
				return;
			}

			if (result.report.warnings.length > 0) {
				new Notice(`Generated with warnings: ${result.report.warnings.join(", ")}`);
			}

			this.onSubmit(result.canvas, result.report);
			this.close();
			
		} catch (error) {
			console.error("NL Generation error:", error);
			new Notice(`Failed to generate canvas: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}