# Natural Language to Cannoli Generator

This module allows users to describe Cannoli workflows in natural language and automatically generate valid JSON Canvas files that follow Cannoli conventions.

## Overview

The Natural Language to Cannoli Generator follows a structured pipeline:

```
Natural Language → Semantic Plan → Intermediate Representation (IR) → JSON Canvas
```

This approach ensures reliable generation with proper validation and error handling.

## Features

### Supported Node Types
- **AI Nodes**: Colorless nodes for LLM interactions
- **Content Nodes**: Purple nodes (color "6") for content storage
- **Action Nodes**: Orange nodes (color "2") for HTTP, modal, and other actions
- **Formatter Nodes**: Purple nodes with double-double quote format (`""text""`)
- **Reference Nodes**: Purple nodes with reference format (`{{[[Note]]}}`)
- **Floating Nodes**: Variables with `[Name]` format
- **File/Link Nodes**: File references and external links
- **Group Nodes**: Basic, Loop, Parallel, and Cannoli groups

### Supported Edge Types
- **Basic**: Uncolored, unlabeled edges
- **Variable**: Uncolored edges with labels for variable injection
- **Logging**: Orange edges without labels
- **Config**: Orange edges with configuration parameter labels
- **Field**: Purple edges for function calling field extraction
- **Choice**: Yellow edges for branching logic
- **List**: Cyan edges for parallel group processing
- **Chat**: Green edges for chat history management

### Advanced Features
- **System Prompts**: Automatic detection and proper edge routing
- **Variable Substitution**: `{{variable}}` pattern recognition
- **Configuration**: Temperature, model, provider settings
- **Layout Engine**: Automatic DAG-based node positioning
- **Validation**: IR and Canvas validation with error reporting
- **Cannoli Group Wrapping**: Automatic wrapping to prevent accidental execution

## Usage

### Basic API

```typescript
import { generateCanvasFromNL, validateCanvas, explainCanvas } from "@deablabs/cannoli-core";

// Generate a canvas from natural language
const result = await generateCanvasFromNL(
  "Ask the AI 'What is the capital of France?' and save the response",
  { 
    wrapInCannoliGroup: true,
    aiProvider: "openai",
    model: "gpt-4"
  }
);

// Validate the generated canvas
const validation = validateCanvas(result.canvas);

// Get human-readable explanation
const explanation = explainCanvas(result.canvas);
```

### Obsidian Integration

In Obsidian, use the command palette:
1. Open Command Palette (`Cmd/Ctrl + P`)
2. Search for "Generate Cannoli from Natural Language"
3. Enter your workflow description
4. The canvas will be created and opened automatically

## Example Workflows

### 1. Simple AI Interaction
```
Input: "Ask the AI 'Hello world!' and write the response to a content node"
Output: AI node → Content node with basic edge
```

### 2. Variable Substitution
```
Input: "Ask the AI to translate {{text}} to French and save the result"
Output: Input[text] → AI node → Content node with variable edge
```

### 3. System Prompt + User Input
```
Input: "System: You are a helpful translator. User: Translate {{phrase}} to Spanish"
Output: System Content → AI node ← Variable[phrase], AI → Content
```

### 4. Configuration
```
Input: "Ask the AI 'Write a story' with temperature 1.0 and save the response"
Output: Config[1.0] → AI node → Content node with config edge
```

### 5. Choice/Branching
```
Input: "Ask 'Coffee or tea?' with choices coffee/tea, respond accordingly"
Output: AI node → Choice edges → Multiple response paths
```

### 6. HTTP Action
```
Input: "Make an HTTP GET request to {{url}} and show the result"
Output: Variable[url] → HTTP Action → Content result
```

## Architecture

### Core Components

1. **NLParser** (`parser.ts`): Extracts semantic intentions from natural language
2. **CanvasCompiler** (`compiler.ts`): Converts IR to JSON Canvas format
3. **Types & Schema** (`types.ts`): Zod-validated IR structure
4. **Main API** (`index.ts`): Public interface functions

### Intermediate Representation (IR)

The IR follows this schema:

```typescript
interface CannoliIntent {
  meta: {
    title: string;
    description: string;
    assumptions: string[];
    defaults: {
      aiProvider: string;
      model: string;
      temperature: number;
      enableVision: boolean;
      wrapInCannoliGroup: boolean;
    };
  };
  io: {
    inputs: Array<{ name: string; initial?: string }>;
    outputs: Array<{ name: string }>;
  };
  nodes: Array<CannoliIntentNode>;
  edges: Array<CannoliIntentEdge>;
  layout: {
    strategy: "auto" | "grid" | "dag";
    laneHints: Array<{ id: string; lane: string }>;
  };
}
```

### Layout Engine

The layout engine uses a DAG (Directed Acyclic Graph) strategy by default:

1. **Topological Sort**: Determines node layers based on dependencies
2. **Layer Positioning**: Places nodes in vertical columns
3. **Spacing**: Applies consistent spacing between nodes and layers
4. **Group Wrapping**: Automatically wraps content in "cannoli" group

## Validation

### IR Validation
- Schema compliance with Zod
- Unique node IDs
- Valid edge references
- JavaScript identifier compliance for Input/Output names

### Canvas Validation
- Required fields (id, type, coordinates, dimensions)
- Valid node/edge references
- Cannoli-specific conventions
- Cycle detection (with exceptions for Loop groups)

## Error Handling

The module provides comprehensive error reporting:

- **Errors**: Critical issues that prevent generation
- **Warnings**: Non-critical issues or potential problems
- **Assumptions**: Default behaviors applied during generation
- **Questions**: Clarification needed (for future interactive refinement)

## Extending the Module

### Adding New Node Types

1. Update the `CannoliIntentNode` schema in `types.ts`
2. Add handling in `NLParser.extractSteps()`
3. Implement compilation in `CanvasCompiler.compileNode()`

### Adding New Edge Types

1. Update the edge type enum in `types.ts`
2. Add pattern recognition in `NLParser`
3. Implement styling in `CanvasCompiler.compileEdge()`

### Improving NL Parsing

The current parser uses simple pattern matching. For more sophisticated parsing:

1. Integrate with NLP libraries (e.g., spaCy, NLTK)
2. Add intent classification
3. Implement entity extraction
4. Add context understanding

## Testing

Run the built-in tests and examples:

```typescript
import { testNLGenerator, runExamples, generateSampleCanvases } from "@deablabs/cannoli-core";

// Basic functionality test
await testNLGenerator();

// Run example workflows
await runExamples();

// Generate sample canvas files
await generateSampleCanvases();
```

## License

MIT License - Part of the Cannoli project.