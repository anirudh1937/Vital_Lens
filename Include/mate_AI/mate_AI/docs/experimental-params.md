# Experimental Parameters

This project now includes a non-standard behavior config:

- `data/experimental_params.json`: active default values.
- `data/experimental_params.schema.json`: validation schema and rollout tags.

## Rollout Tags

- `safe_default`: suitable for default-on behavior.
- `experimental`: keep opt-in until validated with real user feedback.

## Suggested Activation Policy

1. Keep all `safe_default` fields active.
2. Turn on `experimental` fields in small batches (2-4 at a time).
3. Measure changes in response quality, user correction rate, and task completion speed.
4. Roll back any field that raises hallucination, confusion, or user friction.
