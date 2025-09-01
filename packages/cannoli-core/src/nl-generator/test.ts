import { generateCanvasFromNL, validateCanvas, explainCanvas } from "./index";

/**
 * Run a quick, interactive development test of the NL-to-canvas generator and log results.
 *
 * This function constructs a sample natural-language prompt, invokes `generateCanvasFromNL`
 * with development options (wrap in a Cannoli group, exclude IR), then logs a summary of the
 * generated canvas, any assumptions/warnings/questions reported, validation results from
 * `validateCanvas`, and an explanation from `explainCanvas`. If the report contains questions,
 * the function logs them and returns early. It also inspects the generated canvas structure to
 * detect a "cannoli" group (case-insensitive) and to count AI vs. content text nodes.
 *
 * Side effects: extensive console logging. Errors are caught and their messages/stacks are logged.
 *
 * @returns A promise that resolves when the test completes.
 */
export async function testNLGenerator(): Promise<void> {
	console.log("Testing NL to Cannoli Generator...\n");
	
	const testInput = "Ask the AI 'What is the capital of France?' and write the response to a content node";
	console.log(`Input: "${testInput}"`);
	
	try {
		const result = await generateCanvasFromNL(testInput, {
			wrapInCannoliGroup: true,
			includeIR: false,
		});
		
		console.log(`✅ Generated canvas with ${result.canvas.nodes?.length || 0} nodes and ${result.canvas.edges?.length || 0} edges`);
		
		if (result.report.assumptions.length > 0) {
			console.log(`Assumptions: ${result.report.assumptions.join(", ")}`);
		}
		
		if (result.report.warnings.length > 0) {
			console.log(`Warnings: ${result.report.warnings.join(", ")}`);
		}
		
		if (result.report.questions.length > 0) {
			console.log(`❌ Questions: ${result.report.questions.join(", ")}`);
			return;
		}
		
		// Validate the canvas
		const validation = validateCanvas(result.canvas);
		if (validation.errors.length > 0) {
			console.log(`❌ Validation Errors: ${validation.errors.join(", ")}`);
		} else {
			console.log("✅ Canvas validation passed");
		}
		
		// Explain the canvas  
		const explanation = explainCanvas(result.canvas);
		console.log(`Explanation: ${explanation}`);
		
		// Verify basic structure
		const canvas = result.canvas as any;
		if (canvas.nodes && canvas.edges) {
			console.log("✅ Canvas has valid structure with nodes and edges");
			
			// Check for cannoli group
			const cannoliGroup = canvas.nodes.find((n: any) => 
				n.type === "group" && 
				typeof n.label === "string" && 
				n.label.toLowerCase() === "cannoli"
			);
			if (cannoliGroup) {
				console.log("✅ Canvas is wrapped in cannoli group");
			}
			
			// Count node types
			const aiNodes = canvas.nodes.filter((n: any) => n.type === "text" && (!n.color || n.color === "0"));
			const contentNodes = canvas.nodes.filter((n: any) => n.type === "text" && n.color === "6");
			console.log(`📊 Found ${aiNodes.length} AI nodes, ${contentNodes.length} content nodes`);
		}
		
	} catch (error) {
		console.error(`❌ Test failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		if (error instanceof Error && error.stack) {
			console.error(error.stack);
		}
	}
}