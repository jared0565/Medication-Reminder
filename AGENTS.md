## Graphite

Graphite is the sole authority for this project's code graph. The authoritative
artifacts are stored in `graph-out/`.

Rules:
- Never invoke Graphify or update `graphify-out/`; those files are legacy and non-authoritative.
- For codebase questions, run `graphite query "<question>"` against the current Graphite graph before broad source browsing.
- Before relying on the graph, run `graphite check .`. If it reports stale, run `graphite build .`.
- After modifying code, run `graphite build .`, then `graphite validate` and `graphite check .`.
- Use `graph-out/GRAPH_REPORT.md` only for broad architecture review or when a scoped query is insufficient.
