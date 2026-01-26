# Zoho Projects API Formatting Guide

## Comments

Zoho Projects converts newlines to `<br>` tags automatically. To avoid excessive spacing:

- **Write HTML on a single line** - no newlines between elements
- Use proper HTML tags: `<h4>`, `<p>`, `<ul>`, `<li>`, `<strong>`
- Don't use markdown - Zoho doesn't render it
- **No emojis, emoticons, or ASCII art** - keep content professional and plain text only (no checkmarks, arrows, symbols etc.)

### Example (correct)

```html
<h4>Title</h4><p>Introduction paragraph.</p><p><strong>Section 1</strong></p><ul><li>Item one</li><li>Item two</li></ul><p>Closing paragraph.</p>
```

### Example (incorrect - causes double spacing)

```html
<h4>Title</h4>

<p>Introduction paragraph.</p>

<p><strong>Section 1</strong></p>
<ul>
<li>Item one</li>
<li>Item two</li>
</ul>
```

## Task Descriptions

Same rules apply - use HTML, avoid newlines between elements.

### Standard structure for task descriptions:

```html
<p>Opening paragraph explaining what this task does.</p><h4>What this means for you:</h4><ul><li>Benefit or outcome 1</li><li>Benefit or outcome 2</li></ul><h4>How to verify this is complete:</h4><ul><li>Verification step 1</li><li>Verification step 2</li></ul>
```

## API Parameter Mappings

Some Zoho API parameters require nested object format:

| MCP Parameter | API Format |
|---------------|------------|
| `status_id` | `{ status: { id: value } }` |
| `tasklist_id` (update_task) | `{ tasklist: { id: value } }` |
| `milestone_id` (create_tasklist) | `{ milestone: { id: value } }` |
| `target_tasklist_id` (move_task) | Direct value |

## Empty Response Handling

Some endpoints (like `move_task`, `delete_tasklist`) return empty responses on success. The MCP handles this by returning `{ success: true }`.
