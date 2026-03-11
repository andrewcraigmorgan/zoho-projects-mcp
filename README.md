# Zoho Projects MCP Server

MCP server for Zoho Projects API integration. Enables AI assistants to manage projects, tasks, issues, milestones, and more.

## Quick Start

### 1. Install

```bash
git clone <repository-url>
cd zoho-projects-mcp
npm install && npm run build
```

### 2. Get Zoho OAuth Credentials

1. Go to [Zoho API Console](https://api-console.zoho.com/) → **Add Client** → **Self Client**
2. Generate a code with these scopes:
   ```
   ZohoProjects.portals.ALL,ZohoProjects.projects.ALL,ZohoProjects.tasks.ALL,ZohoProjects.bugs.ALL,ZohoProjects.milestones.ALL,ZohoProjects.users.READ,ZohoSearch.securesearch.READ
   ```
3. Exchange code for tokens:
   ```bash
   curl -X POST https://accounts.zoho.{REGION}/oauth/v2/token \
     -d "code=YOUR_CODE&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&redirect_uri=YOUR_REDIRECT_URI&grant_type=authorization_code"
   ```
4. Find your Portal ID from the Zoho Projects URL: `https://projects.zoho.{REGION}/portal/{PORTAL_ID}/...`

**Regions:** `com` (US), `eu` (EU), `in` (IN), `com.au` (AU), `com.cn` (CN)

### 3. Configure

Create `.env`:

```bash
ZOHO_ACCESS_TOKEN=your_access_token
ZOHO_REFRESH_TOKEN=your_refresh_token
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_PORTAL_ID=your_portal_id
ZOHO_API_DOMAIN=https://projectsapi.zoho.com      # Match your region
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.com    # Match your region
```

### 4. Run

```bash
npm start          # Stdio server (for Claude Desktop)
npm run start:http # HTTP server (for remote access)
```

### 5. Claude Desktop Config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "zoho-projects": {
      "command": "node",
      "args": ["/path/to/zoho-projects-mcp/dist/index.js"],
      "env": {
        "ZOHO_ACCESS_TOKEN": "...",
        "ZOHO_REFRESH_TOKEN": "...",
        "ZOHO_CLIENT_ID": "...",
        "ZOHO_CLIENT_SECRET": "...",
        "ZOHO_PORTAL_ID": "...",
        "ZOHO_API_DOMAIN": "https://projectsapi.zoho.com",
        "ZOHO_ACCOUNTS_DOMAIN": "https://accounts.zoho.com"
      }
    }
  }
}
```

## Available Tools

| Category | Tools |
|----------|-------|
| **Portals** | `list_portals`, `get_portal` |
| **Projects** | `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project` |
| **Tasks** | `list_tasks`, `get_task`, `get_task_by_prefix`, `create_task`, `update_task`, `delete_task`, `restore_task`, `get_my_tasks` |
| **Subtasks** | `list_subtasks`, `create_subtask`, `add_task_dependency` |
| **Tasklists** | `create_tasklist`, `update_tasklist`, `move_task`, `delete_tasklist` |
| **Comments** | `list_task_comments`, `add_task_comment`, `edit_task_comment`, `delete_task_comment` |
| **Attachments** | `upload_task_attachment`, `list_task_attachments`, `delete_task_attachment`, `download_inline_image`, `extract_inline_images`, `download_task_images` |
| **Issues** | `list_issues`, `get_issue`, `create_issue`, `update_issue` |
| **Phases** | `list_phases`, `create_phase`, `update_phase`, `delete_phase` |
| **Tags** | `list_tags` |
| **Other** | `list_statuses`, `search`, `list_users`, `export_project` |

## Troubleshooting

- **Auth errors**: Verify token scopes and portal ID
- **API errors**: Check you're using the correct regional domain
- **Connection issues**: Restart Claude Desktop after config changes

## License

MIT
