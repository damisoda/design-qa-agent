# Dify RAG v6

RAG lives in the existing local Dify knowledge bases (`design-qa-docs-v2`, `design-qa-cases-v2`). No second local vector store. `corpus.json` adds 24 contextual rule cards, 2 bounded probe recipes and 3 historical/documented case cards. Existing 139 document segments and 51 case segments remain. The added 26 document cards and 3 case cards bring the counts to 165 and 54. Native document metadata: kind/platform/rule/scope/version. Historical measured cases and documented negative cases are identified separately.

`load.py` indexes idempotently through the local Dify knowledge API, reads the API key into memory only, then assigns native metadata. `../act_v6.py` extends the existing task app and renders the graph. Use the existing environment's Python with PyYAML.

Dify sequence: initial measurement → CSSOM/clickable inventory → sequential iteration → native Knowledge Retrieval with metadata filters and weighted hybrid reranking → deterministic applicability selection → allowlisted measured recheck → final facts → per-defect iteration/retrieval/reranking → Gemma → per-defect numeric/citation validation. The report cap is still three definitions; every measured defect remains visible.

This is native weighted hybrid ranking plus transparent rule/applicability ranking in Dify Code nodes, not a cross-encoder model. Legacy project tokens/cases without matching scope are excluded from generic web evidence; matching cbh project runs may use their own token/case evidence. explicitly mapped generic primary-source chunks remain eligible. No match yields no invented evidence or forced probe. If a known risk query lacks its recipe evidence, that condition is marked incomplete. Actual embedding vectors are health-checked before and after planning so a disconnected tunnel cannot masquerade as an empty successful search.

Probe limits: at most four screens/eight risk queries, four additional viewport sizes (320–430 × 568–932), two interaction sizes, one recheck, 50 seconds recheck wait. CSS pixel media boundaries only; inaccessible stylesheets are recorded. Existing bounded click count applies. Failed or cancelled rechecks are incomplete, never success. Rechecks use the frozen built snapshot; both commit sides are rechecked when present. Original source is never edited. External requests and real writes remain blocked/stubbed by the normal browser contexts.

Artifacts per run: `rag_inventory.json`, `probe_retrieval.json`, `rag_plan.json`, `before-adaptive/`, `retrieval.json`. Real node events appear in the existing progress UI. `/dify/*` web calls retain the current run nonce. Status/report-only requests do not remeasure. Apply/undo/PR confirmation rules are unchanged.

Evaluation: `eval/rag-20261014/`. Search evaluation measures whether an allowed rule-relevant reference is present, not semantic correctness of every sentence. Detection gains come from measured coverage expansion; they are not proof that embeddings diagnose defects.
