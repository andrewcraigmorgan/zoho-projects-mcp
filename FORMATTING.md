# Zoho Projects API Formatting Guide

## Comment Workflow

**Always show the user a rendered preview before posting comments.** Never show raw HTML to the user - render it as formatted text so they can see exactly how it will appear in Zoho. Only post after user approval.

## Writing Style

- **Write in plain English** - avoid jargon, technical terms, and corporate-speak
- No phrases like "Update:", "Per-Zone Breakdown", "Implementation Complete"
- Write naturally as if speaking to a colleague
- Keep it conversational and clear

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

**IMPORTANT:** Zoho does NOT render Markdown. Always use HTML tags. Markdown syntax like `**bold**` or `- list item` will display as raw text.

### Required HTML Tags

| Purpose | HTML Tag |
|---------|----------|
| Bold text | `<strong>` or `<b>` |
| Paragraphs | `<p>` |
| Line breaks | `<br>` |
| Unordered lists | `<ul><li>...</li></ul>` |
| Ordered lists | `<ol><li>...</li></ol>` |
| Code inline | `<code>` |
| Code blocks | `<pre>` |
| Headings | `<h4>` |
| Links | `<a href="...">` |

### Standard Task Description Structure

```html
<p><strong>Issue Type or Source</strong></p><p>Brief description of the problem or requirement.</p><p><strong>Details:</strong></p><ul><li>Specific detail 1</li><li>Specific detail 2</li></ul><p><strong>Actions:</strong></p><ol><li>First action to take</li><li>Second action to take</li></ol><p><strong>Expected outcome or savings</strong></p>
```

### Example - Bad (Markdown won't render)

```
**Lighthouse Issue** Legacy JavaScript polyfills are being served to modern browsers.

**Actions:**
1. Use module/nomodule pattern
2. Configure Babel to target modern browsers

**Potential savings: 340ms, 13KB**
```

This will display as raw text with asterisks showing.

### Example - Good (HTML renders correctly)

```html
<p><strong>Lighthouse Issue</strong></p><p>Legacy JavaScript polyfills are being served to modern browsers.</p><p><strong>Actions:</strong></p><ol><li>Use module/nomodule pattern</li><li>Configure Babel to target modern browsers</li></ol><p><strong>Potential savings: 340ms, 13KB</strong></p>
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
