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
 * Generate a Cannoli canvas from a natural-language specification.
 *
 * Parses the input specification into the Cannoli intermediate representation (IR),
 * validates the IR, and if valid compiles it into a CanvasData result.
 *
 * If IR validation fails, returns an empty canvas and a report containing the validation
 * warnings and a question summarizing the validation errors. On successful validation,
 * returns the compiled canvas and a report containing any IR-derived assumptions and warnings.
 *
 * If an unexpected exception occurs, returns an empty canvas and a report with a single
 * failure question containing the error message; the IR is not included in this error path.
 *
 * @param spec - Natural-language description of the desired canvas.
 * @param options - Generation options. When `options.includeIR` is true, the returned
 *                  GenerationResult will include the parsed IR on both the successful
 *                  and IR-validation-failure paths (but not when an unexpected exception occurs).
 * @returns A GenerationResult containing `canvas`, a `report` (assumptions, warnings, questions),
 *          and optionally `ir` when requested via `options.includeIR`.
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
 * Validate the structure and Cannoli-specific correctness of a canvas object.
 *
 * Performs structural checks (presence and array-ness of `nodes` and `edges`), per-node
 * and per-edge required-field validation, and cross-reference checks (edge endpoints
 * reference existing node ids). Also performs Cannoli-specific heuristics such as
 * detecting AI/content/action text nodes and the presence of a "cannoli" group.
 *
 * Runtime errors are not thrown; any internal exception is captured and returned as a
 * validation error string in the `errors` array.
 *
 * @param canvas - The canvas object to validate (expected to conform to CanvasData).
 * @returns An object with `errors` (fatal or structural problems) and `warnings`
 *          (non-fatal issues and Cannoli-specific suggestions).
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
 * Produce a concise natural-language summary of a canvas.
 *
 * Analyzes nodes and edges to report counts and high-level categories:
 * - Counts node categories (AI, content, action, group, file, link) inferred from node type and color.
 * - Aggregates edge categories (config/logging, choice, chat, list, field, variable, basic) based on edge color or label; edges whose label contains a `{{...}}` placeholder and have no color are reported as "variable".
 * - Detects a Cannoli group when a group node has a string label equal to "cannoli" (case-insensitive) and notes controlled execution wrapping.
 *
 * @param canvas - Canvas-like object (treated as CanvasData) to explain.
 * @returns A human-readable summary string. On failure returns an error message starting with "Could not explain canvas:" followed by the error text.
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
 * Refines a Cannoli canvas or intermediate representation (IR) using provided answers.
 *
 * If the input parses as a Cannoli IR, the IR is validated and, if valid, compiled to a canvas;
 * the returned GenerationResult includes the IR. If the parsed IR is invalid, an empty canvas is
 * returned with a report containing validation errors and the IR. If the input is not IR, the
 * function returns the original input cast as a canvas with a generic refinement note.
 *
 * Note: this basic implementation does not apply the `answers` to modify the IR — answers are
 * accepted but not yet used to alter the canvas/IR.
 *
 * @param canvasOrIR - Either a CanvasData object or a Cannoli intent IR; when a valid IR is provided
 *   the result will include that IR in `GenerationResult.ir`.
 * @param answers - Map of question identifiers to user responses; currently not applied to refinement.
 * @returns A GenerationResult containing the (possibly new) canvas, a report with assumptions/warnings/questions,
 *   and the parsed IR when the input could be interpreted as an IR.
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