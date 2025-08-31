import { CannoliIntent, CannoliIntentNode, CannoliIntentEdge, GenerationOptions } from "./types";

/**
 * Natural Language Parser
 * Extracts workflow intentions from natural language descriptions
 */
export class NLParser {
	private options: GenerationOptions;

	constructor(options: GenerationOptions = {}) {
		this.options = {
			aiProvider: "openai",
			model: "gpt-4",
			temperature: 0.7,
			enableVision: true,
			wrapInCannoliGroup: true,
			...options,
		};
	}

	/**
	 * Parse natural language into a structured plan
	 */
	parseToIntent(naturalLanguage: string): CannoliIntent {
		const plan = this.extractSemanticPlan(naturalLanguage);
		return this.planToIR(plan, naturalLanguage);
	}

	/**
	 * Extract semantic plan from natural language
	 */
	private extractSemanticPlan(nl: string): SemanticPlan {
		const normalized = nl.toLowerCase().trim();
		const assumptions: string[] = [];
		
		// Simple pattern matching for common workflows
		const plan: SemanticPlan = {
			objective: this.extractObjective(normalized),
			steps: this.extractSteps(normalized),
			inputs: this.extractInputs(normalized),
			outputs: this.extractOutputs(normalized),
			configs: this.extractConfigs(normalized),
			conditions: this.extractConditions(normalized),
			loops: this.extractLoops(normalized),
			parallel: this.extractParallel(normalized),
		};

		return plan;
	}

	private extractObjective(nl: string): string {
		// Extract main objective
		const matches = nl.match(/(?:create|generate|build|make)\s+(.+?)(?:\.|$|,)/);
		return matches?.[1] || "Generate workflow";
	}

	private extractSteps(nl: string): WorkflowStep[] {
		const steps: WorkflowStep[] = [];
		
		// Look for AI operations
		if (nl.includes("ai") || nl.includes("gpt") || nl.includes("chatgpt") || nl.includes("llm")) {
			steps.push({
				type: "ai",
				description: "AI processing step",
				prompt: this.extractPrompt(nl),
			});
		}

		// Look for content operations
		if (nl.includes("write") || nl.includes("save") || nl.includes("output")) {
			steps.push({
				type: "content",
				description: "Content output step",
			});
		}

		// Look for actions
		if (nl.includes("http") || nl.includes("request") || nl.includes("api")) {
			steps.push({
				type: "action",
				description: "HTTP action step",
				action: "http",
			});
		}

		if (nl.includes("modal") || nl.includes("form") || nl.includes("input")) {
			steps.push({
				type: "action",
				description: "Modal form step", 
				action: "modal",
			});
		}

		return steps.length > 0 ? steps : [{ type: "ai", description: "Default AI step" }];
	}

	private extractPrompt(nl: string): string {
		// Extract quoted text or common prompt patterns
		const quotedMatch = nl.match(/"([^"]+)"/);
		if (quotedMatch) return quotedMatch[1];

		const promptMatch = nl.match(/prompt[:\s]+([^.]+)/i);
		if (promptMatch) return promptMatch[1].trim();

		return nl;
	}

	private extractInputs(nl: string): string[] {
		const inputs: string[] = [];
		
		// Look for variable patterns
		const variableMatches = nl.match(/\{\{(\w+)\}\}/g);
		if (variableMatches) {
			variableMatches.forEach(match => {
				const varName = match.replace(/[{}]/g, "");
				if (!inputs.includes(varName)) {
					inputs.push(varName);
				}
			});
		}

		// Look for input patterns
		const inputMatch = nl.match(/input[:\s]+(\w+)/i);
		if (inputMatch && !inputs.includes(inputMatch[1])) {
			inputs.push(inputMatch[1]);
		}

		return inputs;
	}

	private extractOutputs(nl: string): string[] {
		const outputs: string[] = [];
		
		// Look for output patterns
		const outputMatch = nl.match(/output[:\s]+(\w+)/i);
		if (outputMatch) {
			outputs.push(outputMatch[1]);
		}

		// Default output if writing/saving mentioned
		if ((nl.includes("write") || nl.includes("save")) && outputs.length === 0) {
			outputs.push("result");
		}

		return outputs;
	}

	private extractConfigs(nl: string): Record<string, string> {
		const configs: Record<string, string> = {};
		
		// Temperature
		const tempMatch = nl.match(/temperature[:\s]+([0-9.]+)/i);
		if (tempMatch) configs.temperature = tempMatch[1];

		// Model
		const modelMatch = nl.match(/model[:\s]+([a-zA-Z0-9-_]+)/i);
		if (modelMatch) configs.model = modelMatch[1];

		// Provider
		const providerMatch = nl.match(/provider[:\s]+(\w+)/i);
		if (providerMatch) configs.provider = providerMatch[1];

		return configs;
	}

	private extractConditions(nl: string): ConditionalStep[] {
		const conditions: ConditionalStep[] = [];
		
		// Look for choice patterns
		if (nl.includes("choose") || nl.includes("choice") || nl.includes("if")) {
			// Simple yes/no pattern
			if (nl.includes("yes") && nl.includes("no")) {
				conditions.push({
					type: "choice",
					options: ["yes", "no"],
					description: "Yes/No choice",
				});
			}
		}

		return conditions;
	}

	private extractLoops(nl: string): LoopStep[] {
		const loops: LoopStep[] = [];
		
		// Look for loop patterns
		const loopMatch = nl.match(/(?:loop|repeat|iterate)\s+(\d+)/i);
		if (loopMatch) {
			loops.push({
				type: "loop",
				count: parseInt(loopMatch[1]),
				description: `Loop ${loopMatch[1]} times`,
			});
		}

		return loops;
	}

	private extractParallel(nl: string): ParallelStep[] {
		const parallel: ParallelStep[] = [];
		
		// Look for parallel patterns
		if (nl.includes("parallel") || nl.includes("for each") || nl.includes("all at once")) {
			parallel.push({
				type: "parallel",
				description: "Parallel processing",
			});
		}

		return parallel;
	}

	/**
	 * Convert semantic plan to IR
	 */
	private planToIR(plan: SemanticPlan, originalNL: string): CannoliIntent {
		const nodes: CannoliIntentNode[] = [];
		const edges: CannoliIntentEdge[] = [];
		const assumptions: string[] = [];

		// Create input nodes
		plan.inputs.forEach(input => {
			nodes.push({
				kind: "content",
				name: input,
				text: `[${input}]`,
				attrs: { color: "6" },
			});
		});

		// Create main workflow nodes
		let previousNodeId: string | null = null;
		
		plan.steps.forEach((step, index) => {
			const nodeId = `step_${index}`;
			
			switch (step.type) {
				case "ai":
					nodes.push({
						id: nodeId,
						kind: "ai",
						text: step.prompt || plan.objective,
						attrs: { color: "auto" },
					});
					break;
				case "content":
					nodes.push({
						id: nodeId,
						kind: "content",
						text: "",
						attrs: { color: "6" },
					});
					break;
				case "action":
					nodes.push({
						id: nodeId,
						kind: "action",
						action: step.action || "http",
						attrs: { color: "2" },
					});
					break;
			}

			// Connect to previous node
			if (previousNodeId) {
				edges.push({
					from: previousNodeId,
					to: nodeId,
					type: "basic",
				});
			}

			// Connect inputs to first node
			if (index === 0) {
				plan.inputs.forEach(input => {
					edges.push({
						from: `input_${input}`,
						to: nodeId,
						type: "variable",
						label: input,
					});
				});
			}

			previousNodeId = nodeId;
		});

		// Create output nodes
		plan.outputs.forEach(output => {
			const outputNodeId = `output_${output}`;
			nodes.push({
				id: outputNodeId,
				kind: "content",
				name: output,
				text: `[${output}]`,
				attrs: { color: "6" },
			});

			// Connect last step to output
			if (previousNodeId) {
				edges.push({
					from: previousNodeId,
					to: outputNodeId,
					type: "basic",
				});
			}
		});

		// Add assumptions for default behaviors
		if (plan.steps.length === 0) {
			assumptions.push("No specific steps detected, created default AI workflow");
		}

		return {
			meta: {
				title: `Generated from: ${originalNL.substring(0, 50)}...`,
				description: plan.objective,
				assumptions,
				defaults: {
					aiProvider: this.options.aiProvider as any,
					model: this.options.model || "gpt-4",
					temperature: this.options.temperature || 0.7,
					enableVision: this.options.enableVision ?? true,
					wrapInCannoliGroup: this.options.wrapInCannoliGroup ?? true,
				},
			},
			io: {
				inputs: plan.inputs.map(name => ({ name })),
				outputs: plan.outputs.map(name => ({ name })),
			},
			nodes,
			edges,
			layout: { strategy: "dag" },
		};
	}
}

/**
 * Internal types for semantic analysis
 */
interface SemanticPlan {
	objective: string;
	steps: WorkflowStep[];
	inputs: string[];
	outputs: string[];
	configs: Record<string, string>;
	conditions: ConditionalStep[];
	loops: LoopStep[];
	parallel: ParallelStep[];
}

interface WorkflowStep {
	type: "ai" | "content" | "action";
	description: string;
	prompt?: string;
	action?: string;
}

interface ConditionalStep {
	type: "choice";
	options: string[];
	description: string;
}

interface LoopStep {
	type: "loop";
	count: number;
	description: string;
}

interface ParallelStep {
	type: "parallel";
	description: string;
}