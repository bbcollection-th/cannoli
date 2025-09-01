import { generateCanvasFromNL } from "./index";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Generate a set of example canvas JSON files from natural-language prompts and save them to disk.
 *
 * This function runs a fixed set of example prompts through the canvas generator, embeds generation
 * metadata (version, generator, original input, and timestamp) into each successful canvas, and
 * writes the resulting JSON files to /tmp/sample-cannoli-canvases. Examples that produce open
 * clarification questions are skipped. Errors during individual example processing are caught and
 * logged; the function continues processing remaining examples.
 *
 * @returns A Promise that resolves when all examples have been processed and any successful canvases
 *          have been written to disk.
 */
export async function generateSampleCanvases(): Promise<void> {
	console.log("🎨 Generating Sample Canvas Files\n");

	// Create output directory
	const { tmpdir } = require("os");
	const outputDir = join(tmpdir(), "sample-cannoli-canvases");
	try {
		mkdirSync(outputDir, { recursive: true });
	} catch (error) {
		console.log(`   ⚠️  Impossible de créer ${outputDir}: ${error instanceof Error ? error.message : String(error)}`);
	}

	const examples = [
		{
			name: "Hello World",
			filename: "01-hello-world.canvas",
			description: "Basic AI interaction",
			input: "Send 'Hello world!' to the AI and write the response in a content node",
		},
		{
			name: "Translation with Variable",
			filename: "02-translation.canvas", 
			description: "AI translation with variable input",
			input: "Ask the AI to translate {{text}} to French and save the result",
		},
		{
			name: "System Prompt Example",
			filename: "03-system-prompt.canvas",
			description: "System prompt with user input",
			input: "System: You are a helpful translator. User: Translate {{phrase}} to Spanish. Save the translation.",
		},
		{
			name: "Temperature Configuration",
			filename: "04-temperature-config.canvas",
			description: "AI with custom temperature",
			input: "Ask the AI 'Write a creative story' with temperature 1.0 and save the response",
		},
		{
			name: "HTTP Action",
			filename: "05-http-action.canvas",
			description: "HTTP request workflow",
			input: "Make an HTTP GET request to {{url}} and show the result",
		},
	];

	for (const example of examples) {
		console.log(`\n📄 Creating: ${example.name}`);
		console.log(`   Input: "${example.input}"`);
		
		try {
			const result = await generateCanvasFromNL(example.input, {
				wrapInCannoliGroup: true,
			});

			if (result.report.questions.length > 0) {
				console.log(`   ❌ Failed: ${result.report.questions.join(", ")}`);
				continue;
			}

			// Add metadata to the canvas
			const VERSION = process.env.npm_package_version ?? "0.0.0-dev";
			const GENERATOR = process.env.CANNOLI_GENERATOR_NAME ?? "Cannoli NL Generator";
			const canvasWithMetadata = {
				...result.canvas,
				metadata: {
					version: VERSION,
					generatedBy: GENERATOR,
					originalInput: example.input,
					generatedAt: new Date().toISOString(),
				},
			};

			const filePath = join(outputDir, example.filename);
			writeFileSync(filePath, JSON.stringify(canvasWithMetadata, null, 2));
			
			const canvas = result.canvas as any;
			console.log(`   ✅ Generated: ${canvas.nodes?.length || 0} nodes, ${canvas.edges?.length || 0} edges`);
			console.log(`   📁 Saved to: ${filePath}`);

			if (result.report.assumptions.length > 0) {
				console.log(`   🤔 Assumptions: ${result.report.assumptions.join(", ")}`);
			}

		} catch (error) {
			console.log(`   ❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}

	console.log(`\n🎉 Sample canvases generated in ${outputDir}`);
	console.log("You can copy these files to your Obsidian vault to test them!");
}