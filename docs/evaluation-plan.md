# Evaluation plan

## Internal quality gates (not official NASA scoring)
1. Relevance: each feature maps to a stated challenge requirement.
2. Correctness: sample inputs have checked expected outputs and units.
3. Reproducibility: clean setup reproduces results.
4. Robustness: empty, missing, extreme and invalid inputs fail safely.
5. Communication: a new viewer understands problem, solution, and limitations.

## Test matrix
| Test | Expected result | Owner | Evidence |
|---|---|---|---|
| Data parsing | Correct schema, units, missing values | TBD | TBD |
| Baseline model | Matches independently computed reference | TBD | TBD |
| UI smoke test | Main demo path works | TBD | TBD |
| Offline demo | Recorded fallback works if internet fails | TBD | TBD |

## Acceptance checklist
- [ ] Challenge compliance checked against official page
- [ ] Data license and citations checked
- [ ] No fabricated claims or results
- [ ] Demo works from clean environment
- [ ] Final links, credits, and submission constraints verified
