# Zoho Projects v2 MCP Server

An MCP (Model Context Protocol) server for interacting with the Zoho Projects v2 API, specifically for task comments functionality that is not available in v3.

## Features

- **Task Updates**: Update task status and completion percentage
- **Task Statuses**: List valid task statuses for a project (with fallback defaults)
- **Task Comments**: Add, update, delete, and list comments on tasks
- **Helper Tools**: List portals, projects, and tasks to get required IDs
- **OAuth Support**: Automatic token refresh using refresh tokens

## Installation

```bash
cd zoho-projects-v2-mcp
npm install
npm run build
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_ACCESS_TOKEN` | Your Zoho OAuth access token (optional if using refresh token) |
| `ZOHO_REFRESH_TOKEN` | Your Zoho OAuth refresh token |
| `ZOHO_CLIENT_ID` | Your Zoho API client ID |
| `ZOHO_CLIENT_SECRET` | Your Zoho API client secret |
| `ZOHO_DOMAIN` | Zoho domain (default: `zoho.com`). Use `zoho.eu`, `zoho.in`, etc. for other regions |

### Required OAuth Scopes

- `ZohoProjects.portals.READ` - List portals
- `ZohoProjects.projects.READ` - List projects
- `ZohoProjects.tasks.READ` - List tasks and comments
- `ZohoProjects.tasks.CREATE` - Add comments
- `ZohoProjects.tasks.UPDATE` - Update comments
- `ZohoProjects.tasks.DELETE` - Delete comments

## Adding to Claude Code

```bash
claude mcp add zoho-projects-v2 -- node /path/to/zoho-projects-v2-mcp/dist/index.js
```

With environment variables:

```bash
claude mcp add zoho-projects-v2 \
  -e ZOHO_REFRESH_TOKEN=your_refresh_token \
  -e ZOHO_CLIENT_ID=your_client_id \
  -e ZOHO_CLIENT_SECRET=your_client_secret \
  -e ZOHO_DOMAIN=zoho.com \
  -- node /path/to/zoho-projects-v2-mcp/dist/index.js
```

## Available Tools

### Task Comment Tools

#### `list_task_comments`
Get all comments for a specific task.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The task ID
- `index`: Starting index for pagination (default: 0)
- `range`: Number of comments to retrieve (default: 100)
- `sort_column`: Sort by `created_time` or `last_modified_time`
- `sort_order`: `ascending` or `descending`

#### `add_task_comment`
Add a new comment to a task.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The task ID
- `content` (required): The comment text

#### `update_task_comment`
Update an existing comment.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The task ID
- `comment_id` (required): The comment ID to update
- `content` (required): The new comment text

#### `delete_task_comment`
Delete a comment from a task.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The task ID
- `comment_id` (required): The comment ID to delete

### Task Update Tool

#### `list_task_statuses`
List all available task statuses for a project so you can supply valid values when updating tasks. If the API call fails, it returns a known fallback set:

- `1013893000003815509` = In Review
- `1013893000001076068` = Open
- `1013893000010930025` = Need More Information
- `1013893000013190027` = With Client
- `1013893000001076071` = Closed
- `1013893000016215201` = Awaiting Approval

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID

#### `update_task_status`
Update a task's status and/or completion percentage. Provide at least one of `status`, `status_id`, or `percent_complete`.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The task ID to update
- `status`: New task status (must match a valid Zoho Projects task status)
- `status_id`: Task status ID (use `list_task_statuses` to discover valid values)
- `percent_complete`: Completion percentage from 0 to 100

### Helper Tools

#### `list_portals`
List all accessible Zoho Projects portals. Use this to get your portal ID.

#### `list_projects`
List projects in a portal.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `index`: Starting index (default: 0)
- `range`: Number of projects (default: 100)
- `status`: Filter by `active`, `archived`, or `template`

#### `list_tasks`
List tasks in a project.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `index`: Starting index (default: 0)
- `range`: Number of tasks (default: 100)

## Getting Zoho OAuth Credentials

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a new Self Client
3. Generate tokens with the required scopes listed above
4. Save your Client ID, Client Secret, and Refresh Token

## License

MIT
