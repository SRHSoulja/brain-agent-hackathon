# Widget API Specification

## Base URL
`/api/v1/widgets`

## Endpoints

### POST /widgets
Create a new widget.

**Request body:**
```json
{
  "name": "string (3-50 chars, alphanumeric + hyphens)",
  "type": "standard | premium | enterprise",
  "config": {
    "maxRetries": "integer (1-10)",
    "timeout": "integer (100-30000, milliseconds)",
    "tags": "string[] (max 5 items, each 1-20 chars)"
  }
}
```

**Responses:**
- 201: Widget created, returns `{ id, name, type, config, created_at }`
- 400: Validation error, returns `{ error, fields }`
- 409: Duplicate name

### GET /widgets/:id
Retrieve a widget by ID.

**Path params:**
- `id`: UUID v4 format

**Responses:**
- 200: Widget object
- 404: Not found

### PATCH /widgets/:id
Update widget fields. Partial updates allowed.

**Request body:** Same schema as POST, all fields optional.

**Responses:**
- 200: Updated widget
- 400: Validation error
- 404: Not found

### DELETE /widgets/:id
Delete a widget. Irreversible.

**Responses:**
- 204: Deleted
- 404: Not found

## Rate Limits
- 100 requests per minute per API key
- Burst: 20 requests per second
