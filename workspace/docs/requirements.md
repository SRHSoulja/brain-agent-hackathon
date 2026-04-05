# Widget Service Requirements

## Business Rules

1. Widget names must be unique across the entire system (case-insensitive).
2. Premium widgets require a `config.timeout` of at least 5000ms.
3. Enterprise widgets must have at least 2 tags in `config.tags`.
4. The `maxRetries` value for standard widgets is capped at 3 (silently clamped, not rejected).
5. Tags must be lowercase alphanumeric only (no spaces, no special characters).

## Validation Priority

When multiple validation errors exist, return them all in a single response. Do not short-circuit on the first error.

## Security Constraints

- All string inputs must be trimmed of leading/trailing whitespace before validation.
- Reject any input containing `<script`, `javascript:`, or `data:text/html` (XSS prevention).
- Widget IDs in path params must match UUID v4 regex exactly.

## Performance Requirements

- Input validation must complete in under 5ms for any single request.
- Validation logic must be stateless (no database lookups during validation -- uniqueness is checked separately).
