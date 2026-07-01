// ════════════════════════════════════════════════════════════════════
// lib/aerolux/airbot-grammars.js
//
// GBNF grammar strings for llama.cpp grammar-constrained decoding.
//
// When a grammar is passed to llama_generate, the model physically
// cannot produce output that doesn't match the schema — eliminating
// the entire class of JSON parse failures that require the fallback
// cleanup logic in the panels.
//
// Reference: https://github.com/ggerganov/llama.cpp/blob/master/grammars/README.md
//
// Three grammars are exported:
//   GENERATIVE_GRAMMAR     — used by AirbotPanel (new gradient from description)
//   AGENTIC_GRAMMAR        — used by AirbotAgenticPanel single mode
//   AGENTIC_BATCH_GRAMMAR  — used by AirbotAgenticPanel batch mode
// ════════════════════════════════════════════════════════════════════

// ── Shared terminal rules ─────────────────────────────────────────
// Inlined into each grammar string rather than referenced, because
// GBNF grammars are self-contained — there is no import mechanism.

const _PRIMITIVES = `
ws      ::= [ \\t\\n]*
string  ::= "\\"" ([^"\\\\\\x7F\\x00-\\x1F] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]))* "\\""
number  ::= "-"? ([0-9] | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?
int     ::= "-"? ([0-9] | [1-9] [0-9]*)

algorithm ::= "\\"rgb\\"" | "\\"lab\\"" | "\\"hsl\\"" | "\\"vivid\\"" | "\\"stepped\\""

hsldir ::= "\\"shortest\\"" | "\\"longest\\""

easing ::= "\\"linear\\""   | "\\"easeIn\\""  | "\\"easeOut\\""  | "\\"sCurve\\""
         | "\\"cubicIn\\""  | "\\"cubicOut\\""
         | "\\"sineIn\\""   | "\\"sineOut\\""  | "\\"sineBoth\\""
         | "\\"expoIn\\""   | "\\"expoOut\\""
         | "\\"bounce\\""   | "\\"elastic\\""

palette-idx ::= "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
              | [1-9] [0-9]
              | "1" [0-1] [0-9]
              | "12" [0-7]
`;

// ── Generative grammar ────────────────────────────────────────────
// AirbotPanel: model describes a brand-new gradient as RGB stops.
//
// Expected shape:
// {
//   "name": "...",
//   "description": "...",
//   "stops": [{"pos": 0.0, "r": 0, "g": 0, "b": 0}, ...],
//   "length": 16,
//   "algorithm": "lab",
//   "hslDir": "shortest",
//   "easing": "linear"
// }

export const GENERATIVE_GRAMMAR = `
root ::= "{" ws
  "\\"name\\":" ws string ws "," ws
  "\\"description\\":" ws string ws "," ws
  "\\"stops\\":" ws gen-stops ws "," ws
  "\\"length\\":" ws int ws "," ws
  "\\"algorithm\\":" ws algorithm ws "," ws
  "\\"hslDir\\":" ws hsldir ws "," ws
  "\\"easing\\":" ws easing ws
"}"

gen-stops ::= "[" ws gen-stop (ws "," ws gen-stop)* ws "]"
gen-stop  ::= "{" ws
  "\\"pos\\":" ws number ws "," ws
  "\\"r\\":" ws int ws "," ws
  "\\"g\\":" ws int ws "," ws
  "\\"b\\":" ws int ws
"}"

${_PRIMITIVES}
`.trim();

// ── Agentic grammar — single mode ─────────────────────────────────
// AirbotAgenticPanel: model outputs a list of editor actions to apply
// to the current gradient, plus a plain-text explanation.
//
// Expected shape:
// {
//   "actions": [...],
//   "explanation": "..."
// }

export const AGENTIC_GRAMMAR = `
root ::= "{" ws
  "\\"actions\\":" ws actions ws "," ws
  "\\"explanation\\":" ws string ws
"}"

actions ::= "[" ws action (ws "," ws action)* ws "]"

action ::= action-set-stops
         | action-set-algorithm
         | action-set-hsl-dir
         | action-set-easing
         | action-set-steps
         | action-set-tint
         | action-clear-tint

action-set-stops ::= "{" ws
  "\\"action\\":" ws "\\"setStops\\"" ws "," ws
  "\\"stops\\":" ws stops ws
"}"

stops ::= "[" ws stop (ws "," ws stop)* ws "]"
stop  ::= "{" ws
  "\\"pos\\":" ws number ws "," ws
  "\\"paletteIdx\\":" ws palette-idx ws
"}"

action-set-algorithm ::= "{" ws
  "\\"action\\":" ws "\\"setAlgorithm\\"" ws "," ws
  "\\"value\\":" ws algorithm ws
"}"

action-set-hsl-dir ::= "{" ws
  "\\"action\\":" ws "\\"setHslDir\\"" ws "," ws
  "\\"value\\":" ws hsldir ws
"}"

action-set-easing ::= "{" ws
  "\\"action\\":" ws "\\"setEasing\\"" ws "," ws
  "\\"value\\":" ws easing ws
"}"

action-set-steps ::= "{" ws
  "\\"action\\":" ws "\\"setSteps\\"" ws "," ws
  "\\"value\\":" ws int ws
"}"

action-set-tint ::= "{" ws
  "\\"action\\":" ws "\\"setTint\\"" ws "," ws
  "\\"paletteIdx\\":" ws palette-idx ws "," ws
  "\\"strength\\":" ws int ws
"}"

action-clear-tint ::= "{" ws
  "\\"action\\":" ws "\\"clearTint\\"" ws
"}"

${_PRIMITIVES}
`.trim();

// ── Agentic batch grammar ─────────────────────────────────────────
// AirbotAgenticPanel batch mode: model outputs N named variations,
// each with its own action list.
//
// Expected shape:
// {
//   "variations": [{"name": "...", "actions": [...]}, ...],
//   "explanation": "..."
// }

export const AGENTIC_BATCH_GRAMMAR = `
root ::= "{" ws
  "\\"variations\\":" ws variations ws "," ws
  "\\"explanation\\":" ws string ws
"}"

variations ::= "[" ws variation (ws "," ws variation)* ws "]"

variation ::= "{" ws
  "\\"name\\":" ws string ws "," ws
  "\\"actions\\":" ws actions ws
"}"

actions ::= "[" ws action (ws "," ws action)* ws "]"

action ::= action-set-stops
         | action-set-algorithm
         | action-set-hsl-dir
         | action-set-easing
         | action-set-steps
         | action-set-tint
         | action-clear-tint

action-set-stops ::= "{" ws
  "\\"action\\":" ws "\\"setStops\\"" ws "," ws
  "\\"stops\\":" ws stops ws
"}"

stops ::= "[" ws stop (ws "," ws stop)* ws "]"
stop  ::= "{" ws
  "\\"pos\\":" ws number ws "," ws
  "\\"paletteIdx\\":" ws palette-idx ws
"}"

action-set-algorithm ::= "{" ws
  "\\"action\\":" ws "\\"setAlgorithm\\"" ws "," ws
  "\\"value\\":" ws algorithm ws
"}"

action-set-hsl-dir ::= "{" ws
  "\\"action\\":" ws "\\"setHslDir\\"" ws "," ws
  "\\"value\\":" ws hsldir ws
"}"

action-set-easing ::= "{" ws
  "\\"action\\":" ws "\\"setEasing\\"" ws "," ws
  "\\"value\\":" ws easing ws
"}"

action-set-steps ::= "{" ws
  "\\"action\\":" ws "\\"setSteps\\"" ws "," ws
  "\\"value\\":" ws int ws
"}"

action-set-tint ::= "{" ws
  "\\"action\\":" ws "\\"setTint\\"" ws "," ws
  "\\"paletteIdx\\":" ws palette-idx ws "," ws
  "\\"strength\\":" ws int ws
"}"

action-clear-tint ::= "{" ws
  "\\"action\\":" ws "\\"clearTint\\"" ws
"}"

${_PRIMITIVES}
`.trim();