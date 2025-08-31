import { CanvasData, CanvasNodeData, CanvasEdgeData, CanvasGroupData } from "../persistor";
import { CannoliIntent, CannoliIntentNode, CannoliIntentEdge, ValidationResult } from "./types";

/**
 * Canvas Compiler
 * Converts Intermediate Representation (IR) to valid JSON Canvas format
 */
export class CanvasCompiler {
	private idCounter = 0;

	/**
	 * Compile IR to JSON Canvas
	 */
	compileToCanvas(ir: CannoliIntent): CanvasData {
		const canvas: CanvasData = {
			nodes: [],
			edges: [],
		};

		// Generate node IDs for nodes that don't have them
		const nodeIdMap = new Map<string, string>();
		ir.nodes.forEach((node, index) => {
			const originalId = node.id || `node_${index}`;
			const canvasId = node.id || this.generateId();
			nodeIdMap.set(originalId, canvasId);
		});

		// Create nodes
		ir.nodes.forEach((node, index) => {
			const originalId = node.id || `node_${index}`;
			const canvasId = nodeIdMap.get(originalId)!;
			const canvasNode = this.compileNode(node, canvasId);
			if (canvasNode) {
				canvas.nodes.push(canvasNode);
			}
		});

		// Create edges
		ir.edges.forEach(edge => {
			const canvasEdge = this.compileEdge(edge, nodeIdMap);
			if (canvasEdge) {
				canvas.edges.push(canvasEdge);
			}
		});

		// Apply layout
		this.applyLayout(canvas, ir);

		// Wrap in cannoli group if requested
		if (ir.meta.defaults.wrapInCannoliGroup) {
			this.wrapInCannoliGroup(canvas);
		}

		return canvas;
	}

	/**
	 * Compile a single node
	 */
	private compileNode(node: CannoliIntentNode, id: string): CanvasNodeData | null {
		const width = node.attrs?.width ?? 250;
		const height = node.attrs?.height ?? 60;
		// couleur "auto" si non fournie
		const colorAuto = node.attrs?.color ?? "auto";

		const baseNode = {
			id,
			x: 0, // Will be set by layout
			y: 0, // Will be set by layout  
			width,
			height,
		};

		switch (node.kind) {
			case "ai":
				return {
					...baseNode,
					type: "text",
					text: node.text || "",
					// AI nodes are colorless by default (Cannoli recognizes them)
				};

			case "content":
				return {
					...baseNode,
					type: "text",
					text: node.text || "",
					color: node.attrs.color === "auto" ? "6" : node.attrs.color, // Purple for content
				};

			case "action":
				return {
					...baseNode,
					type: "text",
					text: this.formatActionText(node),
					color: node.attrs.color === "auto" ? "2" : node.attrs.color, // Orange for actions
				};

			case "formatter":
				return {
					...baseNode,
					type: "text",
					text: `""${node.text || ""}""`, // Double-double quotes for formatters
					color: node.attrs.color === "auto" ? "6" : node.attrs.color,
				};

			case "reference":
				return {
					...baseNode,
					type: "text",
					text: `{{${node.text || "[[Note]]"}}}`, // Reference format
					color: node.attrs.color === "auto" ? "6" : node.attrs.color,
				};

			case "floating":
				return {
					...baseNode,
					type: "text",
					text: `[${node.name || "Variable"}]\n${node.text || ""}`,
					// Floating nodes can have any color
				};

			case "file":
				return {
					...baseNode,
					type: "file",
					file: node.file || "",
				};

			case "link":
				return {
					...baseNode,
					type: "link",
					url: node.url || "",
				};

			case "group": {
				const groupNode: CanvasGroupData = {
					...baseNode,
					type: "group",
					label: node.group?.label?.toString(),
				};
				
				// Apply color for specific group types
				if (node.group?.type === "parallel") {
					groupNode.color = "5"; // Cyan for parallel groups
				}
				
				return groupNode;
			}

			default:
				return null;
		}
	}

	/**
	 * Format action text based on action type
	 */
	private formatActionText(node: CannoliIntentNode): string {
		const action = node.action;
		
		if (!action) return node.text || "";

		switch (action) {
			case "http":
				// Default HTTP template
				return JSON.stringify({
					url: "{{url}}",
					method: "GET",
					headers: {},
					body: {},
				}, null, 2);
			
			case "modal":
				return "[modal]";
			
			case "dalle":
				return "[dalle]";
			
			case "dataview":
				return node.text?.startsWith("```") ? node.text : `[dataview]\n${node.text || ""}`;
			
			case "smart-connections":
				return node.text?.startsWith("```") ? node.text : `[smart-connections]\n${node.text || ""}`;
			
			default:
				return `[${action}]${node.text ? "\n" + node.text : ""}`;
		}
	}

	/**
	 * Compile a single edge
	 */
	private compileEdge(edge: CannoliIntentEdge, nodeIdMap: Map<string, string>): CanvasEdgeData | null {
		const fromId = nodeIdMap.get(edge.from);
		const toId = nodeIdMap.get(edge.to);
		
		if (!fromId || !toId) {
			return null;
		}

		const baseEdge = {
			id: this.generateId(),
			fromNode: fromId,
			toNode: toId,
		};

		// Apply edge type styling
		switch (edge.type) {
			case "basic":
				return {
					...baseEdge,
					// No color, no label
				};

			case "variable":
				return {
					...baseEdge,
					label: edge.label || "variable",
					// No color for variable edges
				};

			case "logging":
				return {
					...baseEdge,
					color: "2", // Orange
					// No label for logging
				};

			case "config":
				return {
					...baseEdge,
					color: "2", // Orange
					label: edge.label || "config",
				};

			case "field":
				return {
					...baseEdge,
					color: "6", // Purple
					label: edge.label || "field",
				};

			case "choice": {
				let choiceLabel = edge.label || "option";
				// Add history modifier if needed
				if (edge.chatHistory === "suppress") {
					choiceLabel += "~";
				} else if (edge.chatHistory === "force") {
					choiceLabel += "|";
				}
				return {
					...baseEdge,
					color: "3", // Yellow
					label: choiceLabel,
				};
			}
			case "list":
				return {
					...baseEdge,
					color: "5", // Cyan
					label: edge.label,
				};

@@ packages/cannoli-core/src/nl-generator/compiler.ts
-			case "chat":
			case "chat": {
				let chatLabel = edge.label || "";

 				// Add limits to label
 				if (edge.limits?.messages) {
 					chatLabel = edge.limits.messages.toString();
 				} else if (edge.limits?.tokens) {
 					chatLabel = `#${edge.limits.tokens}`;
 				}

 				// Add history modifiers
 				if (edge.chatHistory === "suppress") {
 					chatLabel += "~";
 				} else if (edge.chatHistory === "force") {
 					chatLabel += "|";
 				}

 				return {
 					...baseEdge,
 					color: "4", // Green for chat
 					label: chatLabel || undefined,
 				};
			}

			default:
				return {
					...baseEdge,
				};
		}
	}

	/**
	 * Apply automatic layout to nodes
	 */
	private applyLayout(canvas: CanvasData, ir: CannoliIntent): void {
		const layout = ir.layout;
		
		if (layout.strategy === "dag") {
			this.applyDAGLayout(canvas, ir);
		} else {
			this.applyGridLayout(canvas);
		}
	}

	/**
	 * Apply DAG (Directed Acyclic Graph) layout
	 */
	private applyDAGLayout(canvas: CanvasData, ir: CannoliIntent): void {
		const nodePositions = new Map<string, { x: number; y: number }>();
		const visited = new Set<string>();
		const layers: string[][] = [];

		// Build adjacency list
		const adj = new Map<string, string[]>();
		canvas.edges.forEach(edge => {
			if (!adj.has(edge.fromNode)) {
				adj.set(edge.fromNode, []);
			}
			adj.get(edge.fromNode)!.push(edge.toNode);
		});

		// Topological sort to determine layers
		const getLayer = (nodeId: string, layer: number = 0): number => {
			if (visited.has(nodeId)) return layer;
			visited.add(nodeId);

			let maxChildLayer = layer;
			const children = adj.get(nodeId) || [];
			children.forEach(childId => {
				maxChildLayer = Math.max(maxChildLayer, getLayer(childId, layer + 1));
			});

			// Ensure layers array exists
			while (layers.length <= layer) {
				layers.push([]);
			}
			layers[layer].push(nodeId);

			return maxChildLayer;
		};

		// Process all nodes
		canvas.nodes.forEach(node => {
			if (!visited.has(node.id)) {
				getLayer(node.id);
			}
		});

		// Position nodes in layers
		const layerWidth = 300;
		const layerHeight = 120;
		const nodeSpacing = 20;

		layers.forEach((layer, layerIndex) => {
			const x = layerIndex * layerWidth;
			layer.forEach((nodeId, nodeIndex) => {
				const y = nodeIndex * layerHeight;
				nodePositions.set(nodeId, { x, y });
			});
		});

		// Apply positions to canvas nodes
		canvas.nodes.forEach(node => {
			const pos = nodePositions.get(node.id);
			if (pos) {
				node.x = pos.x;
				node.y = pos.y;
			}
		});
	}

	/**
	 * Apply simple grid layout
	 */
	private applyGridLayout(canvas: CanvasData): void {
		const cols = Math.ceil(Math.sqrt(canvas.nodes.length));
		const cellWidth = 300;
		const cellHeight = 120;

		canvas.nodes.forEach((node, index) => {
			const row = Math.floor(index / cols);
			const col = index % cols;
			node.x = col * cellWidth;
			node.y = row * cellHeight;
		});
	}

	/**
	 * Wrap the entire canvas in a "cannoli" group
	 */
	private wrapInCannoliGroup(canvas: CanvasData): void {
		if (canvas.nodes.length === 0) return;

		// Calculate bounding box
		let minX = Number.MAX_VALUE;
		let minY = Number.MAX_VALUE;
		let maxX = Number.MIN_VALUE;
		let maxY = Number.MIN_VALUE;

		canvas.nodes.forEach(node => {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x + node.width);
			maxY = Math.max(maxY, node.y + node.height);
		});

		// Add padding
		const padding = 50;
		const groupNode: CanvasGroupData = {
			id: this.generateId(),
			type: "group",
			label: "cannoli",
			x: minX - padding,
			y: minY - padding,
			width: (maxX - minX) + (2 * padding),
			height: (maxY - minY) + (2 * padding),
		};

		// Insert group at the beginning (bottom z-index)
		canvas.nodes.unshift(groupNode);
	}

	/**
	 * Generate unique IDs in the style of existing Cannoli IDs
	 */
	private generateId(): string {
		// Generate 16-character hex ID similar to existing Cannoli patterns
		const chars = "0123456789abcdef";
		let result = "";
		for (let i = 0; i < 16; i++) {
			result += chars[Math.floor(Math.random() * chars.length)];
		}
		return result;
	}

	/**
	 * Validate IR before compilation
	 */
	validateIR(ir: CannoliIntent): ValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Validate node IDs are unique
		const nodeIds = new Set<string>();
		ir.nodes.forEach((node, index) => {
			const id = node.id || `node_${index}`;
			if (nodeIds.has(id)) {
				errors.push(`Duplicate node ID: ${id}`);
			}
			nodeIds.add(id);
		});

		// Validate edges reference existing nodes
		ir.edges.forEach(edge => {
			if (!nodeIds.has(edge.from)) {
				errors.push(`Edge references non-existent from node: ${edge.from}`);
			}
			if (!nodeIds.has(edge.to)) {
				errors.push(`Edge references non-existent to node: ${edge.to}`);
			}
		});

		// Validate Input/Output names are valid JS identifiers
		[...ir.io.inputs, ...ir.io.outputs].forEach(io => {
			if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(io.name)) {
				errors.push(`Invalid Input/Output name: ${io.name}. Must be a valid JavaScript identifier.`);
			}
		});

		// Check for potential cycles (simplified check)
		if (this.hasCycles(ir)) {
			warnings.push("Potential cycles detected in workflow. This may cause infinite loops unless using Loop groups.");
		}

		// Check for expensive operations
		const parallelGroups = ir.nodes.filter(n => n.group?.type === "parallel");
		const loopGroups = ir.nodes.filter(n => n.group?.type === "loop");
		if (parallelGroups.length > 0 || loopGroups.length > 0) {
			warnings.push("Workflow contains parallel or loop operations which may generate multiple LLM requests and increase costs.");
		}

		return { errors, warnings };
	}

	/**
	 * Simple cycle detection (simplified for this implementation)
	 */
	private hasCycles(ir: CannoliIntent): boolean {
		const adj = new Map<string, string[]>();
		const nodeIds = new Set<string>();

		// Build node ID set
		ir.nodes.forEach((node, index) => {
			nodeIds.add(node.id || `node_${index}`);
		});

		// Build adjacency list
		ir.edges.forEach(edge => {
			if (!adj.has(edge.from)) {
				adj.set(edge.from, []);
			}
			adj.get(edge.from)!.push(edge.to);
		});

		// DFS to detect cycles
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const hasCycleDFS = (nodeId: string): boolean => {
			if (recursionStack.has(nodeId)) return true;
			if (visited.has(nodeId)) return false;

			visited.add(nodeId);
			recursionStack.add(nodeId);

			const neighbors = adj.get(nodeId) || [];
			for (const neighbor of neighbors) {
				if (hasCycleDFS(neighbor)) return true;
			}

			recursionStack.delete(nodeId);
			return false;
		};

		for (const nodeId of nodeIds) {
			if (hasCycleDFS(nodeId)) {
				return true;
			}
		}

		return false;
	}
}