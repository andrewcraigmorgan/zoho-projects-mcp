#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Environment variables for configuration
const ZOHO_ACCESS_TOKEN = process.env.ZOHO_ACCESS_TOKEN;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_DOMAIN = process.env.ZOHO_DOMAIN || "zoho.com"; // zoho.com, zoho.eu, zoho.in, etc.
const ZOHO_USER_ID = process.env.ZOHO_USER_ID; // Optional: default user ID for task assignment

let accessToken = ZOHO_ACCESS_TOKEN;

// Zoho API base URL
function getBaseUrl(): string {
  return `https://projectsapi.${ZOHO_DOMAIN}/restapi`;
}

function getApiV3BaseUrl(): string {
  return `https://projectsapi.${ZOHO_DOMAIN}/api/v3`;
}

function getAccountsUrl(): string {
  return `https://accounts.${ZOHO_DOMAIN}`;
}

const FALLBACK_TASK_STATUSES = [
  { id: "1013893000003815509", name: "In Review" },
  { id: "1013893000001076068", name: "Open" },
  { id: "1013893000010930025", name: "Need More Information" },
  { id: "1013893000013190027", name: "With Client" },
  { id: "1013893000001076071", name: "Closed" },
  { id: "1013893000016215201", name: "Awaiting Approval" },
] as const;

// Note: Status extraction functions were removed as we're using fallback statuses directly.
// May be revisited in the future when API strategies are confirmed working.

// Slim response transformers - reduce context usage by returning only essential fields
function slimPortalResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { portals?: Array<Record<string, unknown>> };
  return {
    portals:
      data.portals?.map((p) => ({
        id: p.id,
        name: p.name,
        is_default: p.is_default,
      })) || [],
  };
}

function slimProjectResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { projects?: Array<Record<string, unknown>> };
  return {
    projects:
      data.projects?.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        owner_name: p.owner_name,
        open_task_count: (p.task_count as Record<string, unknown>)?.open,
      })) || [],
    has_more: !!data.projects?.length,
  };
}

function slimTaskResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { tasks?: Array<Record<string, unknown>> };
  return {
    tasks:
      data.tasks?.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        percent_complete: t.percent_complete,
        start_date: t.start_date,
        end_date: t.end_date,
        owner_name: (t.details as Record<string, unknown>)?.owners
          ? ((t.details as Record<string, unknown>).owners as Array<Record<string, unknown>>)?.[0]?.name
          : undefined,
      })) || [],
    has_more: !!data.tasks?.length,
  };
}

function slimSingleTaskResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { tasks?: Array<Record<string, unknown>> };
  const t = data.tasks?.[0];
  if (!t) return raw;
  return {
    task: {
      id: t.id,
      name: t.name,
      description: (t.details as Record<string, unknown>)?.description,
      status: t.status,
      priority: t.priority,
      percent_complete: t.percent_complete,
      start_date: t.start_date,
      end_date: t.end_date,
      tasklist: t.tasklist,
      owners: (t.details as Record<string, unknown>)?.owners,
    },
  };
}

function slimCommentResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { comments?: Array<Record<string, unknown>> };
  return {
    comments:
      data.comments?.map((c) => ({
        id: c.id,
        content: c.content,
        author: (c.added_by as Record<string, unknown>)?.name,
        created_time: c.created_time,
      })) || [],
    has_more: !!data.comments?.length,
  };
}

function slimTasklistResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { tasklists?: Array<Record<string, unknown>> };
  return {
    tasklists:
      data.tasklists?.map((tl) => ({
        id: tl.id,
        name: tl.name,
        milestone_id: (tl.milestone as Record<string, unknown>)?.id,
      })) || [],
  };
}

function slimUserResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { users?: Array<Record<string, unknown>> };
  return {
    users:
      data.users?.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
      })) || [],
  };
}

function slimMyTasksResponse(raw: unknown, slim: boolean): unknown {
  if (!slim) return raw;
  const data = raw as { tasks?: Array<Record<string, unknown>> };
  return {
    tasks:
      data.tasks?.map((t) => ({
        id: t.id,
        name: t.name,
        project_name: (t.project as Record<string, unknown>)?.name,
        status: t.status,
        priority: t.priority,
        end_date: t.end_date,
      })) || [],
    has_more: !!data.tasks?.length,
  };
}

// Refresh access token using refresh token
async function refreshAccessToken(): Promise<string> {
  if (!ZOHO_REFRESH_TOKEN || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
    throw new Error(
      "Missing OAuth credentials. Set ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, and ZOHO_CLIENT_SECRET"
    );
  }

  const url = `${getAccountsUrl()}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${responseText}`);
  }

  const data = JSON.parse(responseText) as { access_token: string };
  accessToken = data.access_token;
  return accessToken;
}

// Make authenticated API request with automatic token refresh
async function zohoRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  if (!accessToken) {
    await refreshAccessToken();
  }

  const makeRequest = async (token: string): Promise<Response> => {
    return fetch(`${getBaseUrl()}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...options.headers,
      },
    });
  };

  let response = await makeRequest(accessToken!);

  // If unauthorized, try refreshing the token once
  if (response.status === 401) {
    await refreshAccessToken();
    response = await makeRequest(accessToken!);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Zoho API error (${response.status}): ${error}`);
  }

  return response.json();
}

// Make authenticated API request to Zoho API v3 (JSON)
async function zohoRequestV3(
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  if (!accessToken) {
    await refreshAccessToken();
  }

  const makeRequest = async (token: string): Promise<Response> => {
    return fetch(`${getApiV3BaseUrl()}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  };

  let response = await makeRequest(accessToken!);

  if (response.status === 401) {
    await refreshAccessToken();
    response = await makeRequest(accessToken!);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Zoho API error (${response.status}): ${error}`);
  }

  return response.json();
}

// Tool definitions
const tools: Tool[] = [
  {
    name: "list_task_comments",
    description:
      "Get all comments for a specific task in Zoho Projects. Returns comments with author, content, and timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to get comments for",
        },
        index: {
          type: "number",
          description: "Starting index for pagination (default: 0)",
          default: 0,
        },
        range: {
          type: "number",
          description: "Number of comments to retrieve (default: 100)",
          default: 100,
        },
        sort_column: {
          type: "string",
          description: "Sort by 'created_time' or 'last_modified_time'",
          enum: ["created_time", "last_modified_time"],
          default: "created_time",
        },
        sort_order: {
          type: "string",
          description: "Sort order: 'ascending' or 'descending'",
          enum: ["ascending", "descending"],
          default: "descending",
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id", "project_id", "task_id"],
    },
  },
  {
    name: "add_task_comment",
    description:
      "Add a new comment to a task in Zoho Projects. Requires ZohoProjects.tasks.CREATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to add a comment to",
        },
        content: {
          type: "string",
          description: "The comment text content",
        },
      },
      required: ["portal_id", "project_id", "task_id", "content"],
    },
  },
  {
    name: "update_task_comment",
    description:
      "Update an existing comment on a task in Zoho Projects. Requires ZohoProjects.tasks.UPDATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID containing the comment",
        },
        comment_id: {
          type: "string",
          description: "The comment ID to update",
        },
        content: {
          type: "string",
          description: "The new comment text content",
        },
      },
      required: ["portal_id", "project_id", "task_id", "comment_id", "content"],
    },
  },
  {
    name: "delete_task_comment",
    description:
      "Delete a comment from a task in Zoho Projects. Requires ZohoProjects.tasks.DELETE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID containing the comment",
        },
        comment_id: {
          type: "string",
          description: "The comment ID to delete",
        },
      },
      required: ["portal_id", "project_id", "task_id", "comment_id"],
    },
  },
  {
    name: "list_portals",
    description:
      "List all Zoho Projects portals accessible with the current credentials. Useful for getting portal IDs.",
    inputSchema: {
      type: "object",
      properties: {
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: "list_projects",
    description:
      "List all projects in a Zoho Projects portal. Useful for getting project IDs.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        index: {
          type: "number",
          description: "Starting index for pagination (default: 0)",
          default: 0,
        },
        range: {
          type: "number",
          description: "Number of projects to retrieve (default: 100)",
          default: 100,
        },
        status: {
          type: "string",
          description: "Filter by project status",
          enum: ["active", "archived", "template"],
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List all tasks in a Zoho Projects project. Useful for getting task IDs.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID to list tasks from",
        },
        index: {
          type: "number",
          description: "Starting index for pagination (default: 0)",
          default: 0,
        },
        range: {
          type: "number",
          description: "Number of tasks to retrieve (default: 100)",
          default: 100,
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id", "project_id"],
    },
  },
  {
    name: "list_task_statuses",
    description:
      "List all available task statuses for a project. Falls back to a known set when the API call fails.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID to list task statuses from",
        },
      },
      required: ["portal_id", "project_id"],
    },
  },
  {
    name: "update_task_status",
    description:
      "Update a task's status and/or completion percentage. Requires ZohoProjects.tasks.UPDATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to update",
        },
        status: {
          type: "string",
          description:
            "New task status (must match a valid Zoho Projects task status)",
        },
        status_id: {
          type: "string",
          description:
            "Task status ID (use list_task_statuses to discover valid values)",
        },
        percent_complete: {
          type: "number",
          description: "Completion percentage from 0 to 100",
          minimum: 0,
          maximum: 100,
        },
      },
      required: ["portal_id", "project_id", "task_id"],
    },
  },
  // Task CRUD tools
  {
    name: "get_task",
    description: "Get details of a specific task by ID.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to retrieve",
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id", "project_id", "task_id"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in a project. Requires ZohoProjects.tasks.CREATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID to create the task in",
        },
        name: {
          type: "string",
          description: "Task name",
        },
        tasklist_id: {
          type: "string",
          description:
            "Task list ID to add task to (use list_tasklists to get IDs)",
        },
        description: {
          type: "string",
          description: "Task description",
        },
        start_date: {
          type: "string",
          description: "Start date in MM-DD-YYYY format",
        },
        end_date: {
          type: "string",
          description: "End date in MM-DD-YYYY format",
        },
        priority: {
          type: "string",
          description: "Task priority",
          enum: ["None", "Low", "Medium", "High"],
        },
        owner_ids: {
          type: "array",
          description:
            "Array of user IDs to assign (use list_project_users to get IDs)",
          items: { type: "string" },
        },
      },
      required: ["portal_id", "project_id", "name"],
    },
  },
  {
    name: "update_task",
    description:
      "Update task properties (name, description, dates, priority). Requires ZohoProjects.tasks.UPDATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to update",
        },
        name: {
          type: "string",
          description: "New task name",
        },
        description: {
          type: "string",
          description: "New task description",
        },
        start_date: {
          type: "string",
          description: "Start date in MM-DD-YYYY format",
        },
        end_date: {
          type: "string",
          description: "End date in MM-DD-YYYY format",
        },
        priority: {
          type: "string",
          description: "Task priority",
          enum: ["None", "Low", "Medium", "High"],
        },
        percent_complete: {
          type: "number",
          description: "Completion percentage from 0 to 100",
          minimum: 0,
          maximum: 100,
        },
      },
      required: ["portal_id", "project_id", "task_id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Delete a task. Requires ZohoProjects.tasks.DELETE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to delete",
        },
      },
      required: ["portal_id", "project_id", "task_id"],
    },
  },
  // Task List tools
  {
    name: "list_tasklists",
    description: "List all task lists (folders) in a project.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID to list task lists from",
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id", "project_id"],
    },
  },
  {
    name: "create_tasklist",
    description:
      "Create a new task list in a project. Requires ZohoProjects.tasklists.CREATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID to create the task list in",
        },
        name: {
          type: "string",
          description: "Task list name",
        },
        milestone_id: {
          type: "string",
          description: "Optional milestone ID to associate with the task list",
        },
      },
      required: ["portal_id", "project_id", "name"],
    },
  },
  // User tools
  {
    name: "list_project_users",
    description:
      "List all users in a project who can be assigned to tasks.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID to list users from",
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id", "project_id"],
    },
  },
  {
    name: "get_my_tasks",
    description:
      "Get tasks assigned to the current authenticated user across all projects.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        index: {
          type: "number",
          description: "Starting index for pagination (default: 0)",
          default: 0,
        },
        range: {
          type: "number",
          description: "Number of tasks to retrieve (default: 100)",
          default: 100,
        },
        raw: {
          type: "boolean",
          description:
            "Return full API response instead of slim response (default: false)",
          default: false,
        },
      },
      required: ["portal_id"],
    },
  },
  {
    name: "assign_task",
    description:
      "Assign one or more users to a task. If user_ids is omitted, uses ZOHO_USER_ID env variable. Requires ZohoProjects.tasks.UPDATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the task",
        },
        task_id: {
          type: "string",
          description: "The task ID to assign users to",
        },
        user_ids: {
          type: "array",
          description:
            "Array of user IDs to assign to the task. If omitted, uses ZOHO_USER_ID env variable.",
          items: { type: "string" },
        },
      },
      required: ["portal_id", "project_id", "task_id"],
    },
  },
  {
    name: "add_task_dependency",
    description:
      "Add a dependency between two tasks (predecessor/successor relationship). Requires ZohoProjects.tasks.UPDATE scope.",
    inputSchema: {
      type: "object",
      properties: {
        portal_id: {
          type: "string",
          description: "The Zoho Projects portal ID",
        },
        project_id: {
          type: "string",
          description: "The project ID containing the tasks",
        },
        task_id: {
          type: "string",
          description: "The task ID that will have the dependency (successor task)",
        },
        predecessor_id: {
          type: "string",
          description: "The task ID of the predecessor task",
        },
        dependency_type: {
          type: "string",
          description:
            "Type of dependency: FS (Finish-to-Start), SS (Start-to-Start), SF (Start-to-Finish), FF (Finish-to-Finish). Default: FS",
          enum: ["FS", "SS", "SF", "FF"],
          default: "FS",
        },
        lag_value: {
          type: "number",
          description: "Lag time between tasks (optional)",
        },
        lag_type: {
          type: "string",
          description: "Unit for lag time: days or hours",
          enum: ["days", "hours"],
        },
      },
      required: ["portal_id", "project_id", "task_id", "predecessor_id"],
    },
  },
];

// Tool handlers
async function handleListTaskComments(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  index?: number;
  range?: number;
  sort_column?: string;
  sort_order?: string;
  raw?: boolean;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));
  if (args.sort_column) params.set("sort_column", args.sort_column);
  if (args.sort_order) params.set("sort_order", args.sort_order);

  const result = await zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/comments/?${params.toString()}`
  );
  return slimCommentResponse(result, !(args.raw ?? false));
}

async function handleAddTaskComment(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  content: string;
}): Promise<unknown> {
  const body = new URLSearchParams();
  body.set("content", args.content);

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/comments/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

async function handleUpdateTaskComment(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  comment_id: string;
  content: string;
}): Promise<unknown> {
  const body = new URLSearchParams();
  body.set("content", args.content);

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/comments/${args.comment_id}/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

async function handleDeleteTaskComment(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  comment_id: string;
}): Promise<unknown> {
  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/comments/${args.comment_id}/`,
    {
      method: "DELETE",
    }
  );
}

async function handleListPortals(args: { raw?: boolean }): Promise<unknown> {
  const result = await zohoRequest("/portals/");
  return slimPortalResponse(result, !(args.raw ?? false));
}

async function handleListProjects(args: {
  portal_id: string;
  index?: number;
  range?: number;
  status?: string;
  raw?: boolean;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));
  if (args.status) params.set("status", args.status);

  const result = await zohoRequest(
    `/portal/${args.portal_id}/projects/?${params.toString()}`
  );
  return slimProjectResponse(result, !(args.raw ?? false));
}

async function handleListTasks(args: {
  portal_id: string;
  project_id: string;
  index?: number;
  range?: number;
  raw?: boolean;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));

  const result = await zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/?${params.toString()}`
  );
  return slimTaskResponse(result, !(args.raw ?? false));
}

async function handleListTaskStatuses(_args: {
  portal_id: string;
  project_id: string;
}): Promise<unknown> {
  // Using fallback statuses directly - API strategies may be revisited in the future
  return {
    source: "fallback",
    statuses: FALLBACK_TASK_STATUSES,
  };
}

async function handleUpdateTaskStatus(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  status?: string;
  status_id?: string;
  percent_complete?: number;
}): Promise<unknown> {
  if (
    args.status === undefined &&
    args.status_id === undefined &&
    args.percent_complete === undefined
  ) {
    throw new Error(
      "Provide at least one of status, status_id, or percent_complete to update the task"
    );
  }

  if (
    args.percent_complete !== undefined &&
    (args.percent_complete < 0 || args.percent_complete > 100)
  ) {
    throw new Error("percent_complete must be between 0 and 100");
  }

  const payload: Record<string, unknown> = {};

  if (args.status_id !== undefined) {
    payload.status = { id: args.status_id };
  } else if (args.status !== undefined) {
    payload.status = { name: args.status };
  }

  if (args.percent_complete !== undefined) {
    payload.completion_percentage = args.percent_complete;
  }

  return zohoRequestV3(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

// Task CRUD handlers
async function handleGetTask(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  raw?: boolean;
}): Promise<unknown> {
  const result = await zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/`
  );
  return slimSingleTaskResponse(result, !(args.raw ?? false));
}

async function handleCreateTask(args: {
  portal_id: string;
  project_id: string;
  name: string;
  tasklist_id?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  priority?: string;
  owner_ids?: string[];
}): Promise<unknown> {
  const body = new URLSearchParams();
  body.set("name", args.name);
  if (args.tasklist_id) body.set("tasklist_id", args.tasklist_id);
  if (args.description) body.set("description", args.description);
  if (args.start_date) body.set("start_date", args.start_date);
  if (args.end_date) body.set("end_date", args.end_date);
  if (args.priority) body.set("priority", args.priority);
  if (args.owner_ids && args.owner_ids.length > 0) {
    body.set("person_responsible", args.owner_ids.join(","));
  }

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

async function handleUpdateTask(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  priority?: string;
  percent_complete?: number;
}): Promise<unknown> {
  const body = new URLSearchParams();
  if (args.name) body.set("name", args.name);
  if (args.description) body.set("description", args.description);
  if (args.start_date) body.set("start_date", args.start_date);
  if (args.end_date) body.set("end_date", args.end_date);
  if (args.priority) body.set("priority", args.priority);
  if (args.percent_complete !== undefined) {
    body.set("percent_complete", String(args.percent_complete));
  }

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

async function handleDeleteTask(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
}): Promise<unknown> {
  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/`,
    {
      method: "DELETE",
    }
  );
}

// Task List handlers
async function handleListTasklists(args: {
  portal_id: string;
  project_id: string;
  raw?: boolean;
}): Promise<unknown> {
  const result = await zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasklists/`
  );
  return slimTasklistResponse(result, !(args.raw ?? false));
}

async function handleCreateTasklist(args: {
  portal_id: string;
  project_id: string;
  name: string;
  milestone_id?: string;
}): Promise<unknown> {
  const body = new URLSearchParams();
  body.set("name", args.name);
  if (args.milestone_id) body.set("milestone_id", args.milestone_id);

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasklists/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

// User handlers
async function handleListProjectUsers(args: {
  portal_id: string;
  project_id: string;
  raw?: boolean;
}): Promise<unknown> {
  const result = await zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/users/`
  );
  return slimUserResponse(result, !(args.raw ?? false));
}

async function handleGetMyTasks(args: {
  portal_id: string;
  index?: number;
  range?: number;
  raw?: boolean;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));

  const result = await zohoRequest(
    `/portal/${args.portal_id}/mytasks/?${params.toString()}`
  );
  return slimMyTasksResponse(result, !(args.raw ?? false));
}

async function handleAssignTask(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  user_ids?: string[];
}): Promise<unknown> {
  let userIds = args.user_ids;

  // Fall back to ZOHO_USER_ID env variable if no user_ids provided
  if (!userIds || userIds.length === 0) {
    if (!ZOHO_USER_ID) {
      throw new Error(
        "No user_ids provided and ZOHO_USER_ID environment variable is not set"
      );
    }
    userIds = [ZOHO_USER_ID];
  }

  const body = new URLSearchParams();
  body.set("person_responsible", userIds.join(","));

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

async function handleAddTaskDependency(args: {
  portal_id: string;
  project_id: string;
  task_id: string;
  predecessor_id: string;
  dependency_type?: string;
  lag_value?: number;
  lag_type?: string;
}): Promise<unknown> {
  const body = new URLSearchParams();
  body.set("taskid", args.task_id);
  body.set("projId", args.project_id);
  body.set("toupdate", "dependencyset");
  body.set("predids", args.predecessor_id);
  body.set("childprojId", args.project_id); // Required by API

  if (args.dependency_type) {
    body.set("dependencytype", args.dependency_type);
  }
  if (args.lag_value !== undefined) {
    body.set("gapvalue", String(args.lag_value));
  }
  if (args.lag_type) {
    body.set("gaptype", args.lag_type);
  }

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/taskdependency/`,
    {
      method: "POST",
      body: body.toString(),
    }
  );
}

// Create and configure the MCP server
const server = new Server(
  {
    name: "zoho-projects-v2-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "list_task_comments":
        result = await handleListTaskComments(
          args as Parameters<typeof handleListTaskComments>[0]
        );
        break;
      case "add_task_comment":
        result = await handleAddTaskComment(
          args as Parameters<typeof handleAddTaskComment>[0]
        );
        break;
      case "update_task_comment":
        result = await handleUpdateTaskComment(
          args as Parameters<typeof handleUpdateTaskComment>[0]
        );
        break;
      case "delete_task_comment":
        result = await handleDeleteTaskComment(
          args as Parameters<typeof handleDeleteTaskComment>[0]
        );
        break;
      case "list_portals":
        result = await handleListPortals(
          args as Parameters<typeof handleListPortals>[0]
        );
        break;
      case "list_projects":
        result = await handleListProjects(
          args as Parameters<typeof handleListProjects>[0]
        );
        break;
      case "list_tasks":
        result = await handleListTasks(
          args as Parameters<typeof handleListTasks>[0]
        );
        break;
      case "list_task_statuses":
        result = await handleListTaskStatuses(
          args as Parameters<typeof handleListTaskStatuses>[0]
        );
        break;
      case "update_task_status":
        result = await handleUpdateTaskStatus(
          args as Parameters<typeof handleUpdateTaskStatus>[0]
        );
        break;
      // Task CRUD tools
      case "get_task":
        result = await handleGetTask(
          args as Parameters<typeof handleGetTask>[0]
        );
        break;
      case "create_task":
        result = await handleCreateTask(
          args as Parameters<typeof handleCreateTask>[0]
        );
        break;
      case "update_task":
        result = await handleUpdateTask(
          args as Parameters<typeof handleUpdateTask>[0]
        );
        break;
      case "delete_task":
        result = await handleDeleteTask(
          args as Parameters<typeof handleDeleteTask>[0]
        );
        break;
      // Task List tools
      case "list_tasklists":
        result = await handleListTasklists(
          args as Parameters<typeof handleListTasklists>[0]
        );
        break;
      case "create_tasklist":
        result = await handleCreateTasklist(
          args as Parameters<typeof handleCreateTasklist>[0]
        );
        break;
      // User tools
      case "list_project_users":
        result = await handleListProjectUsers(
          args as Parameters<typeof handleListProjectUsers>[0]
        );
        break;
      case "get_my_tasks":
        result = await handleGetMyTasks(
          args as Parameters<typeof handleGetMyTasks>[0]
        );
        break;
      case "assign_task":
        result = await handleAssignTask(
          args as Parameters<typeof handleAssignTask>[0]
        );
        break;
      case "add_task_dependency":
        result = await handleAddTaskDependency(
          args as Parameters<typeof handleAddTaskDependency>[0]
        );
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zoho Projects v2 MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
