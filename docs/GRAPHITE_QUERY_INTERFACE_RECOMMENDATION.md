# Recommendation: Extend Graphite with Agent-Agnostic Search and Natural-Language Querying

**Status:** Proposed  
**Audience:** Graphite maintainers and contributors  
**Prepared:** 23 July 2026  
**Observed Graphite version:** 0.1.0

## Executive summary

Graphite's deterministic graph construction and structured query model should
remain the authoritative foundation. However, its current query interface is
easy to misuse because `graphite query` expects a supported query verb as the
first token, while users and coding agents naturally try questions, symbols,
paths, and concepts directly.

For example:

```text
graphite query "How does mobile pairing work?"
```

currently produces:

```json
{
  "error": "unknown query verb: how"
}
```

Likewise, a direct symbol query such as:

```text
graphite query "acceptPairing"
```

is interpreted as an unknown verb rather than as a symbol search.

This proposal recommends an additive query layer consisting of:

1. A deterministic general-purpose `search` command.
2. An optional natural-language query mode.
3. A validated, inspectable intermediate query plan.
4. Stable JSON contracts and machine-readable capability discovery.
5. Better errors, suggestions, ambiguity handling, and provenance.

The existing structured query syntax must remain supported and unchanged. The
new layer should translate user or agent intent into the same deterministic
graph operations. Graphite—not an AI model—must remain responsible for graph
resolution, traversal, ranking, and factual output.

## Problem statement

### Current behavior

The current CLI advertises:

```text
graphite query <query>
```

and provides an example resembling:

```text
graphite query "depends-on db.ts"
```

The positional argument appears open-ended, but the implementation requires a
recognized verb. Inputs beginning with a natural-language word, symbol, file
alias, or unsupported relationship are rejected.

### Why this matters

The behavior creates several problems:

- Users can reasonably mistake a syntax error for an empty or incomplete graph.
- Coding agents must already know Graphite's private query grammar.
- `query --help` does not sufficiently expose the supported operations.
- Agents may fall back to broad file searches when a graph lookup would be
  faster and more precise.
- Agent instruction files may say `graphite query "<question>"`, even though
  Graphite does not accept natural-language questions.
- Different agents may invent incompatible query forms.
- Automation must parse human-oriented errors instead of stable error codes.

This is an interface and discoverability limitation, not evidence of a graph
extraction failure.

## Goals

- Preserve deterministic, local-first graph querying.
- Make common symbol, file, relationship, and concept searches discoverable.
- Allow natural-language questions without coupling Graphite to one model.
- Provide stable, machine-readable contracts for agents, IDEs, CI, and scripts.
- Make query translation observable and auditable.
- Return bounded, relevant subgraphs with source provenance.
- Fail safely when an input is ambiguous or unsupported.
- Maintain full backward compatibility with existing structured commands.

## Non-goals

- Replacing Graphite's graph engine with an LLM.
- Allowing a model to invent nodes, edges, or source facts.
- Requiring network access or an API key for ordinary graph queries.
- Making probabilistic output authoritative.
- Sending repository contents to an external provider by default.
- Silently guessing when multiple symbols or paths are plausible.

## Design principles

### 1. Deterministic core, optional intelligence

All execution should terminate in a validated Graphite query plan handled by
the deterministic graph engine. Natural-language processing is an input
adapter, not an alternate source of truth.

### 2. Local-first and provider-neutral

Common intent should be handled by a deterministic local parser. Complex
natural-language translation may optionally use a provider adapter, but no
specific model vendor should be required.

### 3. Transparent translation

Users and agents should be able to inspect how an input was interpreted before
or alongside execution.

### 4. Stable automation contract

Human-readable output is useful, but every command should support versioned,
documented JSON output with stable error codes.

### 5. Explicit ambiguity

If a token matches several files or symbols, Graphite should return candidates
and require disambiguation unless a documented deterministic ranking threshold
is met.

## Proposed user experience

### Preserve existing structured queries

Existing commands must continue to work:

```powershell
graphite query "depends-on web/sync.js"
graphite context web/sync.js
graphite impact web/sync.js
```

### Add deterministic general search

```powershell
graphite search "acceptPairing"
graphite search "mobile pairing"
graphite search "web/sync.js"
graphite search "notification subscription"
```

Search should cover, as applicable:

- Exact node IDs
- Symbol names
- File paths and path suffixes
- Qualified names
- Node kinds
- Extracted documentation and labels
- Normalized tokens
- Deterministic fuzzy matches

Results should identify why each item matched.

### Add optional natural-language mode

Recommended explicit syntax:

```powershell
graphite query --natural "How does mobile pairing work?"
graphite query --natural "What calls acceptPairing?"
graphite query --natural "Which tests are affected if web/sync.js changes?"
graphite query --natural "Show the path from the scanner to schedule import."
```

An explicit flag avoids breaking or ambiguously reinterpreting the current
grammar.

An optional convenience mode could detect non-verb input:

```powershell
graphite query "How does mobile pairing work?"
```

If automatic detection is implemented, Graphite should state that it switched
to natural-language mode and display the resulting plan. It must not silently
change semantics.

### Add capability discovery

```powershell
graphite capabilities
graphite capabilities --json
```

This should return:

- Supported commands and query verbs
- Argument definitions
- Supported node and edge kinds
- Output schema versions
- Natural-language availability
- Available local or optional provider adapters
- Limits such as maximum depth and result count

This is essential for agent-agnostic integration because an agent can discover
the installed Graphite version's capabilities rather than relying on embedded
assumptions.

### Improve invalid-query errors

Instead of only:

```json
{
  "error": "unknown query verb: how"
}
```

return a structured response such as:

```json
{
  "ok": false,
  "error": {
    "code": "UNKNOWN_QUERY_VERB",
    "message": "Unknown query verb: how",
    "token": "how",
    "suggestions": [
      "Use `graphite query --natural \"How does mobile pairing work?\"`",
      "Use `graphite search \"mobile pairing\"`",
      "Run `graphite capabilities` to list supported operations"
    ]
  },
  "schemaVersion": "1"
}
```

## Proposed architecture

```text
CLI / API / IDE / coding agent
              |
              v
       Input classification
       /        |         \
 structured   search    natural language
       \        |         /
              v
      Query-plan construction
              |
              v
      Schema and policy validation
              |
              v
   Deterministic Graphite executor
              |
              v
 Ranking, bounding, and provenance
              |
              v
 Human output or versioned JSON
```

### Components

#### Input classifier

Classifies input as:

- Existing structured query
- Direct search
- Natural-language request
- Invalid or ambiguous input

The classifier should be deterministic for recognized structured verbs.

#### Intent parser

The local parser should support common intents without an LLM:

- Find a symbol or file
- Show dependencies
- Show dependents
- Show a relationship path
- Show change impact
- Show tests associated with a file or symbol
- Explain or summarize a bounded concept subgraph
- Return local context around a node

#### Optional provider adapter

For questions outside the local grammar, an optional adapter may translate text
into the canonical query-plan schema.

Provider adapters must:

- Be disabled by default for canonical commands.
- Implement a documented provider-neutral interface.
- Receive only the minimum metadata necessary.
- Respect explicit repository and data-sharing policies.
- Operate under time, token, and size limits.
- Never write directly to the graph.
- Never bypass query-plan validation.
- Return an error or ambiguity result rather than fabricate an operation.

#### Query-plan validator

Every plan, including one produced by a model, must pass strict validation:

- Known operation
- Valid argument types
- Allowed depth and result limits
- Resolvable or explicitly ambiguous targets
- Valid edge and node kinds
- Repository-bound paths
- No unrecognized fields

#### Deterministic executor

The executor should remain the only component authorized to resolve and
traverse the authoritative graph.

## Canonical query-plan contract

Illustrative version 1:

```json
{
  "schemaVersion": "1",
  "operation": "path",
  "targets": [
    {
      "input": "openScanner",
      "resolvedNodeId": "web_sync_openscanner"
    },
    {
      "input": "acceptPairing",
      "resolvedNodeId": "web_sync_acceptpairing"
    }
  ],
  "options": {
    "maxDepth": 4,
    "maxResults": 50,
    "edgeKinds": []
  },
  "source": {
    "mode": "natural",
    "originalInput": "Show the path from the scanner to pairing."
  }
}
```

The exact schema may differ, but it should be:

- Versioned
- Strictly validated
- Serializable
- Provider-neutral
- Suitable for logging and test fixtures
- Independent of display formatting

Recommended operations include:

- `search`
- `dependencies`
- `dependents`
- `path`
- `impact`
- `context`
- `tests`
- `subgraph`

## Result contract

Every successful result should expose:

- Resolved target nodes
- Resolution method for each target
- Alternate matches
- Nodes and edges returned
- Source file and location where available
- Truncation status
- Applied depth and result limits
- Graph freshness metadata
- Graph and schema versions
- Warnings and ambiguity information

Illustrative response:

```json
{
  "ok": true,
  "schemaVersion": "1",
  "graph": {
    "fresh": true,
    "nodeCount": 745,
    "edgeCount": 1250
  },
  "plan": {
    "operation": "dependencies",
    "target": "web_sync"
  },
  "matches": [
    {
      "input": "web/sync.js",
      "nodeId": "web_sync",
      "matchType": "path-suffix",
      "confidence": 1.0
    }
  ],
  "nodes": [],
  "edges": [],
  "truncated": false,
  "warnings": []
}
```

## Resolution and ranking

Graphite should use deterministic resolution before optional semantic methods.
A recommended precedence order is:

1. Exact node ID
2. Exact qualified symbol
3. Exact normalized file path
4. Exact symbol name
5. Path suffix
6. Case-insensitive exact match
7. Token match
8. Deterministic fuzzy match
9. Optional semantic match

Each result should include its match type and score. Ties or close matches
should return an ambiguity response:

```json
{
  "ok": false,
  "error": {
    "code": "AMBIGUOUS_TARGET",
    "message": "Multiple symbols match `syncNow`.",
    "candidates": []
  }
}
```

## Model and agent agnosticism

This proposal improves agent independence in four ways:

1. **Capability discovery:** agents inspect the installed Graphite interface.
2. **Canonical plans:** all agents target the same versioned data contract.
3. **Provider adapters:** optional natural-language translation is not tied to
   one AI vendor.
4. **Deterministic execution:** facts come from the graph rather than from the
   translating model.

The expected integrations include:

- Command-line users
- Codex and other coding agents
- IDE extensions
- CI pipelines
- Local models
- Hosted models
- Repository analysis services

No integration should need to scrape formatted terminal output when JSON mode
is available.

## Security and privacy requirements

- Structured and deterministic local queries must never require network access.
- External model use must be explicit and disabled by default.
- Never transmit source code, secrets, environment values, or full graph data
  unless an explicit policy permits it.
- Minimize data sent to any optional provider.
- Treat natural-language input and model-produced plans as untrusted.
- Validate plans against a closed schema.
- Reject paths outside the configured repository root.
- Enforce maximum depth, result count, input size, and execution time.
- Prevent query expansion from exhausting memory or CPU.
- Redact secrets from logs and provider payloads.
- Record provider use and translation metadata without recording sensitive
  content by default.
- Keep canonical graph commands independent from provider availability.

## Backward compatibility

The change should be additive:

- Existing structured query strings retain their current meaning.
- Existing JSON fields should not be removed without a version transition.
- New response envelopes should be introduced behind an explicit JSON version
  if current consumers depend on the existing shape.
- Natural-language mode should require `--natural` initially.
- Automatic mode detection, if later added, should be configurable.
- Deprecations should emit warnings for at least one documented release cycle.

## Observability and diagnostics

Recommended diagnostics:

- Query mode selected
- Query-plan construction duration
- Target-resolution method
- Executor duration
- Nodes and edges examined
- Results returned
- Truncation
- Cache usage
- Provider usage, when explicitly enabled
- Validation and ambiguity failures

Diagnostics must avoid repository secrets and should support a structured
logging format.

## Implementation plan

### Phase 1: Discoverability and deterministic search

- Add `graphite capabilities [--json]`.
- Add `graphite search <text> [--json]`.
- Document all existing query verbs.
- Introduce stable error codes and actionable suggestions.
- Add exact symbol, qualified name, path, and suffix resolution.

This phase provides immediate value without introducing any model dependency.

### Phase 2: Canonical query plans

- Define and version the query-plan schema.
- Route existing structured queries through the plan validator.
- Add `--show-plan` and `--plan-only`.
- Version the machine-readable result envelope.
- Add ambiguity and truncation metadata.

### Phase 3: Deterministic natural-language parser

- Add `graphite query --natural`.
- Map common question forms to canonical operations.
- Support deterministic file and symbol extraction.
- Return clarification candidates for ambiguous inputs.
- Fall back to search when an exact traversal intent cannot be established.

### Phase 4: Optional provider-neutral translation

- Define a small provider adapter interface.
- Add explicit provider configuration and consent controls.
- Send only bounded metadata.
- Validate all returned plans.
- Add timeouts, circuit breaking, and deterministic fallback behavior.

### Phase 5: Integration tooling

- Publish JSON Schemas.
- Add agent-instruction examples.
- Add IDE and CI integration examples.
- Provide compatibility tests for third-party agents.

## Acceptance criteria

### Functional

- `graphite search "acceptPairing"` resolves the correct symbol without a query
  verb.
- `graphite search "web/sync.js"` resolves the file deterministically.
- `graphite query --natural "What does web/sync.js depend on?"` produces and
  executes a valid dependency plan.
- `graphite query --natural "What calls acceptPairing?"` returns dependents or
  a clear statement that none exist.
- Ambiguous names return candidates and do not silently select one.
- Unsupported requests return stable error codes and actionable suggestions.
- Existing structured queries continue producing compatible results.

### Agent interoperability

- An agent can discover supported operations using one JSON command.
- An agent can request plan-only output without executing a traversal.
- All successful and failed JSON responses validate against published schemas.
- No provider-specific fields are required in canonical plans.

### Reliability

- Local structured search and query work offline.
- Provider failure does not break structured or deterministic queries.
- Query limits prevent unbounded traversal.
- Results identify whether they were truncated.
- Graph freshness is exposed in machine-readable output.

### Security

- External translation is opt-in.
- Model-produced plans cannot bypass schema or repository-boundary validation.
- Tests verify path traversal, oversized input, excessive depth, invalid
  operations, malformed plans, and provider timeout behavior.

## Recommended test matrix

| Area | Required cases |
|---|---|
| Structured compatibility | Every existing verb and representative fixture |
| Symbol resolution | Exact, qualified, duplicate, case variant, absent |
| File resolution | Exact path, suffix, ambiguous suffix, outside root |
| Search | Symbol, path, token, documentation, no match |
| Natural language | Dependencies, dependents, path, impact, context, tests |
| Ambiguity | Duplicate symbol, conflicting file/symbol, low confidence |
| Errors | Unknown verb, malformed plan, unsupported operation |
| Limits | Maximum depth, maximum results, oversized input, timeout |
| Offline behavior | Structured, search, and local natural parser |
| Provider behavior | Disabled, unavailable, timeout, malformed response |
| Privacy | Payload minimization and secret-redaction fixtures |
| Schemas | Forward-compatible parsing and invalid-field rejection |

## Documentation changes

Graphite's generated agent instructions should distinguish structured syntax
from natural language. Instead of:

```text
For codebase questions, run `graphite query "<question>"`.
```

use language similar to:

```text
For codebase questions, first run `graphite search "<symbol, path, or concept>"`
or a documented structured query. Use `graphite query --natural "<question>"`
only when natural-language mode is available. Run
`graphite capabilities --json` to discover supported operations.
```

This prevents agents from treating a free-form question as a query verb.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Natural-language translation selects the wrong operation | Show and validate the plan; report ambiguity |
| Existing scripts break | Preserve current syntax and version JSON changes |
| Model dependency reduces reliability | Keep deterministic parser and executor; make providers optional |
| Repository data leaks to a provider | Explicit opt-in, payload minimization, policy enforcement |
| Search results become noisy | Deterministic ranking, match reasons, bounded results |
| Query expansion consumes excessive resources | Depth, size, time, and result limits |
| Agents depend on undocumented behavior | Machine-readable capabilities and published schemas |

## Decision recommendation

Proceed with the feature as an additive interface, starting with deterministic
`search`, capability discovery, stable errors, and canonical query plans.

Do not begin with an LLM-only natural-language implementation. Establish the
provider-neutral plan and result contracts first. Once those contracts are
stable, add a deterministic natural-language parser and then optional model
adapters for requests that cannot be translated locally.

This sequence provides immediate usability improvements while preserving
Graphite's strongest properties: deterministic operation, local-first
execution, auditability, and authoritative graph-based answers.

