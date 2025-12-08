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
      properties: {},
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
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));
  if (args.sort_column) params.set("sort_column", args.sort_column);
  if (args.sort_order) params.set("sort_order", args.sort_order);

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/${args.task_id}/comments/?${params.toString()}`
  );
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

async function handleListPortals(): Promise<unknown> {
  return zohoRequest("/portals/");
}

async function handleListProjects(args: {
  portal_id: string;
  index?: number;
  range?: number;
  status?: string;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));
  if (args.status) params.set("status", args.status);

  return zohoRequest(
    `/portal/${args.portal_id}/projects/?${params.toString()}`
  );
}

async function handleListTasks(args: {
  portal_id: string;
  project_id: string;
  index?: number;
  range?: number;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("index", String(args.index ?? 0));
  params.set("range", String(args.range ?? 100));

  return zohoRequest(
    `/portal/${args.portal_id}/projects/${args.project_id}/tasks/?${params.toString()}`
  );
}

async function handleListTaskStatuses(args: {
  portal_id: string;
  project_id: string;
}): Promise<unknown> {
  try {
    const result = await zohoRequest(
      `/portal/${args.portal_id}/projects/${args.project_id}/taskstatuses/`
    );

    return {
      source: "api",
      data: result,
      fallback_statuses: FALLBACK_TASK_STATUSES,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: "fallback",
      error: message,
      statuses: FALLBACK_TASK_STATUSES,
    };
  }
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
        result = await handleListPortals();
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
