import { z } from "zod";
import { CanvasData } from "../persistor";

/**
 * Intermediate Representation (IR) schema for Natural Language to Cannoli generation
 * Based on the CannoliIntent specification
 */

export const cannoliIntentMetaSchema = z.object({
	title: z.string(),
	description: z.string(),
	assumptions: z.array(z.string()).default([]),
	defaults: z.object({
		aiProvider: z.enum(["openai", "anthropic", "gemini", "ollama", "groq"]).default("openai"),
		model: z.string().default("gpt-4"),
		temperature: z.number().default(0.7),
		enableVision: z.boolean().default(true),
		wrapInCannoliGroup: z.boolean().default(true),
	}).default({}),
});

export const cannoliIntentIOSchema = z.object({
	inputs: z.array(z.object({
		name: z.string(),
		initial: z.string().optional(),
	})).default([]),
	outputs: z.array(z.object({
		name: z.string(),
	})).default([]),
});

export const cannoliIntentNodeSchema = z.object({
	id: z.string().regex(/^[0-9a-f]{16}$/i, "ID attendu: 16 hex").optional(),
	kind: z.enum([
		"ai",
		"content",
		"action",
		"formatter",
		"reference",
		"floating",
		"file",
		"link",
		"group",
	]),
	name: z.string().optional(),
	text: z.string().optional(),
	action: z.string().optional(),
	file: z.string().optional(),
	url: z.string().optional(),
	reference: z.enum(["note", "floating", "dynamic"]).optional(),
	group: z.object({
		type: z.enum(["basic", "loop", "parallel", "cannoli"]),
		label: z.union([z.string(), z.number()]),
	}).optional(),
	attrs: z.object({
		role: z.enum(["user", "system", "assistant"]).optional(),
		width: z.number().default(250),
		height: z.number().default(60),
		color: z.union([
			z.literal("auto"),
			z.literal("1"), z.literal("2"), z.literal("3"),
			z.literal("4"), z.literal("5"), z.literal("6"),
			z.string().regex(/^#[0-9a-fA-F]{6}$/)
		]).default("auto"),
	}).default({}),
	config: z.object({
		provider: z.string().optional(),
		apiKey: z.string().optional(),
		baseURL: z.string().optional(),
		model: z.string().optional(),
		temperature: z.number().optional(),
		role: z.string().optional(),
		enableVision: z.boolean().optional(),
		stop: z.union([z.string(), z.array(z.string())]).optional(),
	}).default({}),
});

export const cannoliIntentEdgeSchema = z.object({
	from: z.string(),
	to: z.string(),
	type: z.enum(["basic", "variable", "logging", "config", "field", "choice", "list", "chat"]),
	label: z.string().optional(),
	chatHistory: z.enum(["default", "force", "suppress"]).default("default"),
	jsonPath: z.string().optional(),
	limits: z.object({
		messages: z.number().optional(),
		tokens: z.number().optional(),
	}).optional(),
});

export const cannoliIntentLayoutSchema = z.object({
	strategy: z.enum(["auto", "grid", "dag"]).default("dag"),
	laneHints: z.array(z.object({
		id: z.string(),
		lane: z.enum(["source", "process", "sink"]),
	})).default([]),
});

export const cannoliIntentSchema = z.object({
	meta: cannoliIntentMetaSchema,
	io: cannoliIntentIOSchema,
	nodes: z.array(cannoliIntentNodeSchema),
	edges: z.array(cannoliIntentEdgeSchema),
	layout: cannoliIntentLayoutSchema.default({}),
});

export type CannoliIntentMeta = z.infer<typeof cannoliIntentMetaSchema>;
export type CannoliIntentIO = z.infer<typeof cannoliIntentIOSchema>;
export type CannoliIntentNode = z.infer<typeof cannoliIntentNodeSchema>;
export type CannoliIntentEdge = z.infer<typeof cannoliIntentEdgeSchema>;
export type CannoliIntentLayout = z.infer<typeof cannoliIntentLayoutSchema>;
export type CannoliIntent = z.infer<typeof cannoliIntentSchema>;

/**
 * Generation result containing the canvas, report and optional IR
 */
export interface GenerationResult {
	canvas: CanvasData;
	report: {
		assumptions: string[];
		warnings: string[];
		questions: string[];
	};
	ir?: CannoliIntent;
}

/**
 * Validation result for canvas or IR
 */
export interface ValidationResult {
	errors: string[];
	warnings: string[];
}

/**
 * Options for generation
 */
export interface GenerationOptions {
	aiProvider?: string;
	model?: string;
	temperature?: number;
	enableVision?: boolean;
	wrapInCannoliGroup?: boolean;
	includeIR?: boolean;
}