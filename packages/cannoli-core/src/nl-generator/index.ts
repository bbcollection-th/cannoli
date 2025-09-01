import { CanvasData } from "../persistor";
import { NLParser } from "./parser";
import { CanvasCompiler } from "./compiler";
import { 
	GenerationResult, 
	ValidationResult, 
	GenerationOptions, 
	CannoliIntent,
	cannoliIntentSchema 
} from "./types";

/**
 * Main API for Natural Language to Cannoli generation
 */

/**
 * Generate a Cannoli canvas from a natural-language description.
 *
 * Parses the provided natural-language `spec` into a Cannoli intermediate representation (IR),
 * validates the IR, and — if valid — compiles it into a Cannoli canvas.
 *
 * On success the returned GenerationResult contains:
 * - `canvas`: the compiled canvas,
 * - `report.assumptions`: any assumptions from `ir.meta?.assumptions`,
 * - `report.warnings`: any validation warnings,
 * - `report.questions`: an empty array,
 * - `ir` (optional): included when `options.includeIR` is truthy.
 *
 * If IR validation fails the result contains an empty canvas and a `report.questions`
 * entry describing the validation errors; `ir` is included only if `options.includeIR`
 * is truthy. If an unexpected error is thrown during generation the result contains an
 * empty canvas and a `report.questions` entry with the error message.
 *
 * @param spec - Natural-language description of the desired Cannoli workflow.
 * @param options - Generation options; set `includeIR: true` to include the parsed IR in the result.
 * @returns A Promise resolving to a GenerationResult summarizing the generated canvas, report, and optional IR.
 */
export async function generateCanvasFromNL(
	spec: string, 
	options: GenerationOptions = {}
): Promise<GenerationResult> {
	const parser = new NLParser(options);
	const compiler = new CanvasCompiler();

	try {
		// Parse natural language to IR
		const ir = parser.parseToIntent(spec);
		
		// Validate IR
		const validation = compiler.validateIR(ir);
		if (validation.errors.length > 0) {
			return {
				canvas: { nodes: [], edges: [] },
				report: {
					assumptions: [],
					warnings: validation.warnings,
					questions: [`Generation failed with errors: ${validation.errors.join(", ")}`],
				},
				ir: options.includeIR ? ir : undefined,
			};
		}

		// Compile to canvas
		const canvas = compiler.compileToCanvas(ir);

		return {
			canvas,
			report: {
				assumptions: ir.meta?.assumptions ?? [],
				warnings: validation.warnings,
				questions: [],
			},
			ir: options.includeIR ? ir : undefined,
		};
	} catch (error) {
		return {
			canvas: { nodes: [], edges: [] },
			report: {
				assumptions: [],
				warnings: [],
				questions: [`Generation failed: ${error instanceof Error ? error.message : "Unknown error"}`],
			},
		};
	}
}

/**
 * Validate a Cannoli canvas's top-level shape, each node, and each edge.
 *
 * Performs defensive checks on the provided object (expected to be CanvasData)
 * and returns arrays of fatal structural errors and non-fatal warnings.
 *
 * Checks performed:
 * - Top-level presence and array-ness of `nodes` and `edges`.
 * - Per-node required fields: `id`, `type`, numeric `x`, `y`, `width`, `height`.
 * - Per-edge required fields: `id`, `fromNode`, `toNode` and that referenced node IDs exist.
 * - Cannoli-specific heuristics: presence of AI/content/action text nodes (by type/color)
 *   and a top-level group labeled `"cannoli"` (case-insensitive).
 *
 * The function never throws; on unexpected internal errors it records a validation
 * failure message into the returned `errors` array.
 *
 * @param canvas - Object to validate (should conform to CanvasData: { nodes: [], edges: [] }); validated defensively.
 * @returns An object with:
 *  - `errors`: fatal problems that make the canvas invalid (structural issues, missing required fields, invalid references).
 *  - `warnings`: non-fatal recommendations (e.g., no recognizable Cannoli nodes or missing `cannoli` group).
 */
export function validateCanvas(canvas: object): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	try {
		// Basic structure validation
		const canvasData = canvas as CanvasData;
		
		if (!canvasData.nodes || !Array.isArray(canvasData.nodes)) {
			errors.push("Canvas must have a 'nodes' array");
		}

		if (!canvasData.edges || !Array.isArray(canvasData.edges)) {
			errors.push("Canvas must have an 'edges' array");
		}

		if (errors.length > 0) {
			return { errors, warnings };
		}

		// Validate node structure
		canvasData.nodes.forEach((node, index) => {
			if (!node.id) errors.push(`Node at index ${index} missing required 'id' field`);
			if (!node.type) errors.push(`Node at index ${index} missing required 'type' field`);
			if (typeof node.x !== "number") errors.push(`Node ${node.id} missing valid 'x' coordinate`);
			if (typeof node.y !== "number") errors.push(`Node ${node.id} missing valid 'y' coordinate`);
			if (typeof node.width !== "number") errors.push(`Node ${node.id} missing valid 'width'`);
			if (typeof node.height !== "number") errors.push(`Node ${node.id} missing valid 'height'`);
		});

		// Validate edge structure
		const nodeIds = new Set(canvasData.nodes.map(n => n.id));
		canvasData.edges.forEach((edge, index) => {
			if (!edge.id) errors.push(`Edge at index ${index} missing required 'id' field`);
			if (!edge.fromNode) errors.push(`Edge at index ${index} missing required 'fromNode' field`);
			if (!edge.toNode) errors.push(`Edge at index ${index} missing required 'toNode' field`);
			
			if (!nodeIds.has(edge.fromNode)) {
				errors.push(`Edge ${edge.id} references non-existent fromNode: ${edge.fromNode}`);
			}
			if (!nodeIds.has(edge.toNode)) {
				errors.push(`Edge ${edge.id} references non-existent toNode: ${edge.toNode}`);
			}
		});

		// Check for Cannoli-specific issues
		const aiNodes = canvasData.nodes.filter(n => 
			n.type === "text" && (!n.color || n.color === "0")
		);
		const contentNodes = canvasData.nodes.filter(n => 
			n.type === "text" && n.color === "6"
		);
		const actionNodes = canvasData.nodes.filter(n => 
			n.type === "text" && n.color === "2"
		);

		if (aiNodes.length === 0 && contentNodes.length === 0 && actionNodes.length === 0) {
			warnings.push("Canvas appears to be empty or contains no recognizable Cannoli nodes");
		}

		// Check for cannoli group
		const cannoliGroups = canvasData.nodes.filter(n =>
			n.type === "group" &&
			typeof (n as any).label === "string" &&
			(n as any).label.toLowerCase() === "cannoli"
		);
		if (cannoliGroups.length === 0) {
			warnings.push("Canvas does not contain a 'cannoli' group. Consider wrapping your workflow in a cannoli group to prevent accidental execution.");
		}

	} catch (error) {
		errors.push(`Canvas validation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
	}

	return { errors, warnings };
}

/**
 * Produces a concise natural-language summary of a canvas' structure.
 *
 * Inspects nodes and edges to count and classify common Cannoli node types
 * (AI/content/action/group/file/link) and common edge types (config/logging,
 * choice, chat, list, field, variable, basic). Also detects a group labeled
 * "cannoli" (case-insensitive) and notes it as a wrapper for controlled
 * execution.
 *
 * @param canvas - The canvas object (expected to conform to CanvasData) to summarize.
 * @returns A human-readable summary string describing node/edge counts and notable features.
 *          If an error occurs while processing, returns a string beginning with
 *          "Could not explain canvas: " followed by the error message.
 */
export function explainCanvas(canvas: object): string {
	try {
		const canvasData = canvas as CanvasData;
		const parts: string[] = [];

		// Count node types
		const nodeTypes = {
			ai: 0,
			content: 0,
			action: 0,
			group: 0,
			file: 0,
			link: 0,
		};

		canvasData.nodes.forEach(node => {
			switch (node.type) {
				case "text":
					if (!node.color || node.color === "0") {
						nodeTypes.ai++;
					} else if (node.color === "6") {
						nodeTypes.content++;
					} else if (node.color === "2") {
						nodeTypes.action++;
					}
					break;
				case "group":
					nodeTypes.group++;
					break;
				case "file":
					nodeTypes.file++;
					break;
				case "link":
					nodeTypes.link++;
					break;
			}
		});

		parts.push(`This canvas contains ${canvasData.nodes.length} nodes and ${canvasData.edges.length} edges.`);

		if (nodeTypes.ai > 0) parts.push(`${nodeTypes.ai} AI node(s)`);
		if (nodeTypes.content > 0) parts.push(`${nodeTypes.content} content node(s)`);
		if (nodeTypes.action > 0) parts.push(`${nodeTypes.action} action node(s)`);
		if (nodeTypes.group > 0) parts.push(`${nodeTypes.group} group(s)`);
		if (nodeTypes.file > 0) parts.push(`${nodeTypes.file} file node(s)`);
		if (nodeTypes.link > 0) parts.push(`${nodeTypes.link} link node(s)`);

		// Analyze edge types
		const edgeTypes = new Map<string, number>();
		canvasData.edges.forEach(edge => {
			if (edge.color === "2") {
				edgeTypes.set(edge.label ? "config" : "logging", (edgeTypes.get(edge.label ? "config" : "logging") || 0) + 1);
			} else if (edge.color === "3") {
				edgeTypes.set("choice", (edgeTypes.get("choice") || 0) + 1);
			} else if (edge.color === "4") {
				edgeTypes.set("chat", (edgeTypes.get("chat") || 0) + 1);
			} else if (edge.color === "5") {
				edgeTypes.set("list", (edgeTypes.get("list") || 0) + 1);
			} else if (edge.color === "6") {
				edgeTypes.set("field", (edgeTypes.get("field") || 0) + 1);
			} else if (edge.label && /{{[^}]+}}/.test(edge.label) && !edge.color) {
				edgeTypes.set("variable", (edgeTypes.get("variable") || 0) + 1);
			} else {
				edgeTypes.set("basic", (edgeTypes.get("basic") || 0) + 1);
			}
		});

		if (edgeTypes.size > 0) {
			parts.push("Edge types: " + Array.from(edgeTypes.entries()).map(([type, count]) => `${count} ${type}`).join(", "));
		}

		// Check for special features
		const cannoliGroups = canvasData.nodes.filter(n =>
			n.type === "group" &&
			typeof (n as any).label === "string" &&
			(n as any).label.toLowerCase() === "cannoli"
		);
		if (cannoliGroups.length > 0) {
			parts.push("Wrapped in cannoli group for controlled execution.");
		}

		const out = parts.join(". ");
		return out.endsWith(".") ? out : out + ".";

	} catch (error) {
		return `Could not explain canvas: ${error instanceof Error ? error.message : "Unknown error"}`;
	}
}

/**
 * Refines a Cannoli canvas or intermediate representation (IR) using user-provided answers.
 *
 * If `canvasOrIR` is a Cannoli IR, the function validates it and, when valid, compiles it to a canvas
 * and returns a GenerationResult containing the new canvas and the IR. If the IR is invalid, it
 * returns an empty canvas and a report with validation errors. If `canvasOrIR` is not a recognized IR,
 * the function treats it as an existing canvas and returns it unchanged with a report noting that
 * refinement is not implemented in this basic version.
 *
 * @param canvasOrIR - Either a Cannoli intermediate representation (IR) object or an existing canvas object.
 * @param answers - Mapping of question identifiers to user-provided answers used to refine the IR/canvas.
 * @returns A GenerationResult containing the resulting canvas, a report (assumptions, warnings, questions),
 *          and the IR when the input was a parsable Cannoli IR.
 */
export function refineWithAnswers(
	canvasOrIR: object, 
	answers: Record<string, string>
): GenerationResult {
	// For this basic implementation, we'll return the original canvas
	// In a more advanced version, this would re-process based on answers
	const maybeIR = cannoliIntentSchema.safeParse(canvasOrIR);
	if (maybeIR.success) {
		const ir = maybeIR.data;
		const compiler = new CanvasCompiler();
		const validation = compiler.validateIR(ir);
		if (validation.errors.length > 0) {
			return {
				canvas: { nodes: [], edges: [] },
				report: {
					assumptions: [],
					warnings: validation.warnings,
					questions: [`Refinement received invalid IR: ${validation.errors.join(", ")}`],
				},
				ir,
			};
		}
		const canvas = compiler.compileToCanvas(ir);
		return {
			canvas,
			report: {
				assumptions: ["Refinement not yet implemented in basic version"],
				warnings: validation.warnings,
				questions: [],
			},
			ir,
		};
	}
	return {
		canvas: canvasOrIR as CanvasData,
		report: {
			assumptions: ["Refinement not yet implemented in basic version"],
			warnings: [],
			questions: [],
		},
	};
}

/**
 * Validate an IR object against the schema
 */
export function validateIR(ir: object): ValidationResult {
	try {
		cannoliIntentSchema.parse(ir);
		return { errors: [], warnings: [] };
	} catch (error) {
		return {
			errors: [`IR validation failed: ${error instanceof Error ? error.message : "Unknown error"}`],
			warnings: [],
		};
	}
}

// Export types for consumers
export * from "./types";
export { NLParser } from "./parser";
export { CanvasCompiler } from "./compiler";