import { generateCanvasFromNL } from "./index";

/**
 * Example workflows to demonstrate the NL to Cannoli generator
 */
export const exampleWorkflows = [
	{
		name: "Simple Hello World",
		description: "Basic AI interaction with content output",
		input: "Send 'Hello world!' to the AI and write the response in a content node",
		expectedFeatures: ["AI node", "Content node", "Basic edge"],
	},
	{
		name: "Variable Substitution",
		description: "AI workflow with variable input",
		input: "Ask the AI to translate {{text}} to French and save the result",
		expectedFeatures: ["Variable edge", "AI node", "Content node"],
	},
	{
		name: "System Prompt + Variable",
		description: "System prompt with user variable",
		input: "System: You are a helpful translator. User: Translate {{phrase}} to Spanish. Save the translation.",
		expectedFeatures: ["System message", "Variable", "AI node", "Content node"],
	},
	{
		name: "Configuration",
		description: "AI with temperature configuration",
		input: "Ask the AI 'Write a creative story' with temperature 1.0 and save the response",
		expectedFeatures: ["Config edge", "AI node", "Content node"],
	},
	{
		name: "Choice Workflow", 
		description: "Branching logic with choices",
		input: "Ask the AI 'Do you want coffee or tea?' with choices coffee/tea, then respond accordingly",
		expectedFeatures: ["AI node", "Choice edges", "Multiple paths"],
	},
	{
		name: "HTTP Action",
		description: "HTTP request action",
		input: "Make an HTTP GET request to {{url}} and show the result",
		expectedFeatures: ["HTTP action node", "Variable", "Content output"],
	},
	{
		name: "Modal Form",
		description: "User input via modal",
		input: "Show a modal form asking for name and email, then greet the user with AI",
		expectedFeatures: ["Modal action", "Field edges", "AI node"],
	},
];

/**
 * Run example workflows and log results
 */
export async function runExamples(): Promise<void> {
	console.log("🧪 Running Example Workflows\n");
	
	for (const example of exampleWorkflows) {
		console.log(`\n=== ${example.name} ===`);
		console.log(`📝 ${example.description}`);
		console.log(`💬 Input: "${example.input}"`);
		console.log(`🎯 Expected: ${example.expectedFeatures.join(", ")}`);
		
		try {
			const result = await generateCanvasFromNL(example.input, {
				wrapInCannoliGroup: true,
			});
			
			if (result.report.questions.length > 0) {
				console.log(`❌ Failed: ${result.report.questions.join(", ")}`);
				continue;
			}
			
			const canvas = result.canvas as any;
			console.log(`✅ Generated: ${canvas.nodes?.length || 0} nodes, ${canvas.edges?.length || 0} edges`);
			
			// Analyze generated features
			const features = analyzeCanvasFeatures(canvas);
			console.log(`🔍 Features: ${features.join(", ")}`);
			
			if (result.report.assumptions.length > 0) {
				console.log(`🤔 Assumptions: ${result.report.assumptions.join(", ")}`);
			}
			
			if (result.report.warnings.length > 0) {
				console.log(`⚠️ Warnings: ${result.report.warnings.join(", ")}`);
			}
			
		} catch (error) {
			console.log(`❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	}
}

/**
 * Produce human-readable feature descriptors from a canvas object.
 *
 * Given a canvas-like object with `nodes` and `edges` arrays, inspects node and edge
 * properties to summarize detected elements (e.g., AI/content/action nodes, group
 * named "cannoli", basic/variable/config/choice/field edges).
 *
 * If `canvas.nodes` or `canvas.edges` is missing, returns `["Invalid canvas"]`.
 * If no specific features are found, returns `["Basic structure"]`.
 *
 * @param canvas - Canvas-shaped object expected to contain `nodes: any[]` and `edges: any[]`.
 *                 Nodes are inspected for `type`, `color`, and `label` (label checked
 *                 case-insensitively where relevant). Edges are inspected for `color`
 *                 and `label`.
 * @returns An array of short, human-readable feature descriptors.
 */
function analyzeCanvasFeatures(canvas: any): string[] {
	const features: string[] = [];
	
	if (!canvas.nodes || !canvas.edges) {
		return ["Invalid canvas"];
	}
	
	// Analyze nodes
	const nodeTypes = {
		ai: canvas.nodes.filter((n: any) => n.type === "text" && (!n.color || n.color === "0")).length,
		content: canvas.nodes.filter((n: any) => n.type === "text" && n.color === "6").length,
		action: canvas.nodes.filter((n: any) => n.type === "text" && n.color === "2").length,
		group: canvas.nodes.filter((n: any) => n.type === "group").length,
		cannoliGroup: canvas.nodes.filter(
			(n: any) => n.type === "group" && typeof n.label === "string" && n.label.toLowerCase() === "cannoli"
		).length,
	};
	
	if (nodeTypes.ai > 0) features.push(`${nodeTypes.ai} AI node${nodeTypes.ai > 1 ? "s" : ""}`);
	if (nodeTypes.content > 0) features.push(`${nodeTypes.content} Content node${nodeTypes.content > 1 ? "s" : ""}`);
	if (nodeTypes.action > 0) features.push(`${nodeTypes.action} Action node${nodeTypes.action > 1 ? "s" : ""}`);
	if (nodeTypes.cannoliGroup > 0) features.push("Cannoli group");
	
	// Analyze edges
	const edgeTypes = {
		basic: canvas.edges.filter((e: any) => !e.color && !e.label).length,
		variable: canvas.edges.filter((e: any) => !e.color && e.label).length,
		config: canvas.edges.filter((e: any) => e.color === "2" && e.label).length,
		logging: canvas.edges.filter((e: any) => e.color === "2" && !e.label).length,
		choice: canvas.edges.filter((e: any) => e.color === "3").length,
		chat: canvas.edges.filter((e: any) => e.color === "4").length,
		list: canvas.edges.filter((e: any) => e.color === "5").length,
		field: canvas.edges.filter((e: any) => e.color === "6").length,
	};
	
	if (edgeTypes.basic > 0) features.push(`${edgeTypes.basic} Basic edge${edgeTypes.basic > 1 ? "s" : ""}`);
	if (edgeTypes.variable > 0) features.push(`${edgeTypes.variable} Variable edge${edgeTypes.variable > 1 ? "s" : ""}`);
	if (edgeTypes.config > 0) features.push(`${edgeTypes.config} Config edge${edgeTypes.config > 1 ? "s" : ""}`);
	if (edgeTypes.choice > 0) features.push(`${edgeTypes.choice} Choice edge${edgeTypes.choice > 1 ? "s" : ""}`);
	if (edgeTypes.field > 0) features.push(`${edgeTypes.field} Field edge${edgeTypes.field > 1 ? "s" : ""}`);
	
	return features.length > 0 ? features : ["Basic structure"];
}