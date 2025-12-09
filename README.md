# Zoho Projects v2 MCP Server

An MCP (Model Context Protocol) server for interacting with the Zoho Projects v2 API, specifically for task comments functionality that is not available in v3.

## Features

- **Task Management**: Create, update, delete tasks and manage assignments
- **Task Dependencies**: Create predecessor/successor relationships between tasks
- **Task Updates**: Update task status and completion percentage
- **Task Statuses**: List valid task statuses for a project (with fallback defaults)
- **Task Comments**: Add, update, delete, and list comments on tasks
- **Task Lists**: List, create, and update task lists (folders) with visibility control
- **User Management**: List project users and get tasks assigned to you
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
| `ZOHO_USER_ID` | Your Zoho user ID (optional, for default task assignment) |

### Required OAuth Scopes

The following scopes are required for full functionality:

| Scope | Purpose |
|-------|---------|
| `ZohoProjects.portals.READ` | List portals |
| `ZohoProjects.projects.READ` | List projects |
| `ZohoProjects.tasks.READ` | List tasks, task lists, comments, users |
| `ZohoProjects.tasks.CREATE` | Create tasks, add comments |
| `ZohoProjects.tasks.UPDATE` | Update tasks, assign users, add dependencies |
| `ZohoProjects.tasks.DELETE` | Delete tasks and comments |
| `ZohoProjects.tasklists.READ` | List task lists |
| `ZohoProjects.tasklists.CREATE` | Create task lists |
| `ZohoProjects.tasklists.UPDATE` | Update task lists |

**Comma-separated list for easy copying:**

```
ZohoProjects.portals.READ,ZohoProjects.projects.READ,ZohoProjects.tasks.READ,ZohoProjects.tasks.CREATE,ZohoProjects.tasks.UPDATE,ZohoProjects.tasks.DELETE,ZohoProjects.tasklists.READ,ZohoProjects.tasklists.CREATE,ZohoProjects.tasklists.UPDATE
```

## Adding to Claude Code

```bash
claude mcp add zoho-projects-v2 -s user -- node /path/to/zoho-projects-v2-mcp/dist/index.js
```

With environment variables:

```bash
claude mcp add zoho-projects-v2 -s user \
  -e ZOHO_REFRESH_TOKEN=your_refresh_token \
  -e ZOHO_CLIENT_ID=your_client_id \
  -e ZOHO_CLIENT_SECRET=your_client_secret \
  -e ZOHO_DOMAIN=zoho.com \
  -e ZOHO_USER_ID=your_user_id \
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

#### `assign_task`
Assign one or more users to a task. If `user_ids` is omitted, falls back to `ZOHO_USER_ID` environment variable.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The task ID to assign users to
- `user_ids`: Array of user IDs to assign (optional if `ZOHO_USER_ID` is set)

#### `add_task_dependency`
Add a dependency between two tasks (predecessor/successor relationship).

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `task_id` (required): The successor task ID (the task that depends on another)
- `predecessor_id` (required): The predecessor task ID (the task that must complete first)
- `dependency_type`: Type of dependency - `FS` (Finish-to-Start, default), `SS` (Start-to-Start), `SF` (Start-to-Finish), `FF` (Finish-to-Finish)
- `lag_value`: Lag time between tasks
- `lag_type`: Unit for lag time - `days` or `hours`

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

### Task List Tools

#### `list_tasklists`
List all task lists (folders) in a project.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID

#### `create_tasklist`
Create a new task list in a project.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `name` (required): Task list name
- `milestone_id`: Optional milestone ID to associate with the task list
- `visibility`: Visibility of the task list - `external` (visible to clients, default) or `internal` (team only)

#### `update_tasklist`
Update an existing task list.

Parameters:
- `portal_id` (required): The Zoho Projects portal ID
- `project_id` (required): The project ID
- `tasklist_id` (required): The task list ID to update
- `name`: New task list name
- `visibility`: Visibility of the task list - `external` (visible to clients) or `internal` (team only)

## Getting Zoho OAuth Credentials

### Step 1: Create a Self Client

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Click **Add Client** → **Self Client**
3. Give it a name (e.g., "Zoho Projects MCP")
4. Click **Create**
5. Note your **Client ID** and **Client Secret**

### Step 2: Generate an Authorization Code

1. In the Self Client, go to the **Generate Code** tab
2. Enter the scopes (comma-separated):
   ```
   ZohoProjects.portals.READ,ZohoProjects.projects.READ,ZohoProjects.tasks.READ,ZohoProjects.tasks.CREATE,ZohoProjects.tasks.UPDATE,ZohoProjects.tasks.DELETE,ZohoProjects.tasklists.READ,ZohoProjects.tasklists.CREATE,ZohoProjects.tasklists.UPDATE
   ```
3. Set **Time Duration** to the maximum (10 minutes)
4. Enter a **Scope Description** (e.g., "MCP Server Access")
5. Click **Create**
6. Copy the generated **authorization code** (it expires in 10 minutes!)

### Step 3: Exchange the Code for a Refresh Token

Run this curl command in your terminal, replacing the placeholders:

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTHORIZATION_CODE"
```

**For EU region**, use `https://accounts.zoho.eu/oauth/v2/token`
**For IN region**, use `https://accounts.zoho.in/oauth/v2/token`

The response will include:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Save the `refresh_token`** - this is what you need for the MCP server. The refresh token doesn't expire (unless revoked), so you only need to do this once.

### Step 4: Configure the MCP Server

Use the Client ID, Client Secret, and Refresh Token when adding the MCP server:

```bash
claude mcp add zoho-projects-v2 -s user \
  -e ZOHO_REFRESH_TOKEN=your_refresh_token \
  -e ZOHO_CLIENT_ID=your_client_id \
  -e ZOHO_CLIENT_SECRET=your_client_secret \
  -e ZOHO_DOMAIN=zoho.com \
  -e ZOHO_USER_ID=your_user_id \
  -- node /path/to/zoho-projects-v2-mcp/dist/index.js
```

To find your User ID, use `list_project_users` after setup, or check your Zoho profile.

## License

MIT
