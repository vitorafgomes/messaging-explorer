export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  ALLOWED_ORIGINS: string;
}

interface BugReport {
  type: 'bug' | 'feature';
  title: string;
  description: string;
  version: string;
  platform: string;
  errors?: string[];
  reporter?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, env);
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, request, env);
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/report') {
      return handleReport(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404, request, env);
  },
};

async function handleReport(request: Request, env: Env): Promise<Response> {
  let body: BugReport;

  try {
    body = await request.json() as BugReport;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, request, env);
  }

  // Validate required fields
  if (!body.title || !body.description || !body.type) {
    return jsonResponse({ error: 'Missing required fields: title, description, type' }, 400, request, env);
  }

  // Sanitize inputs (prevent injection)
  const title = sanitize(body.title).slice(0, 200);
  const description = sanitize(body.description).slice(0, 5000);
  const version = sanitize(body.version || 'unknown').slice(0, 20);
  const platform = sanitize(body.platform || 'unknown').slice(0, 50);
  const reporter = sanitize(body.reporter || 'Anonymous').slice(0, 100);
  const errors = (body.errors || []).slice(0, 5).map(e => sanitize(e).slice(0, 500));

  // Build issue body
  const isBug = body.type === 'bug';
  const label = isBug ? 'bug' : 'enhancement';
  const prefix = isBug ? '[Bug]' : '[Feature]';

  let issueBody = `**Version:** ${version}\n**Platform:** ${platform}\n**Reported by:** ${reporter}\n`;

  if (errors.length > 0) {
    issueBody += `\n**Error log:**\n\`\`\`\n${errors.join('\n')}\n\`\`\`\n`;
  }

  issueBody += `\n**Description:**\n${description}\n`;
  issueBody += `\n---\n*Submitted via Message Explorer in-app reporter*`;

  // Create GitHub issue
  const ghResponse = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MessageExplorer-BugReporter/1.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `${prefix} ${title}`,
      body: issueBody,
      labels: [label, 'in-app-report'],
    }),
  });

  if (!ghResponse.ok) {
    const error = await ghResponse.text();
    console.error('GitHub API error:', error);
    return jsonResponse({ error: 'Failed to create issue' }, 502, request, env);
  }

  const issue = await ghResponse.json() as { html_url: string; number: number };

  return jsonResponse({
    success: true,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  }, 201, request, env);
}

function sanitize(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/```/g, '~~~') // Prevent markdown code block injection
    .trim();
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());

  // Allow any localhost origin for development, packaged Electron
  // (file:// pages report Origin: null), and custom app:// schemes.
  const isAllowed = allowed.includes(origin) ||
    origin.startsWith('http://localhost:') ||
    origin === 'null' ||
    origin.startsWith('app://');

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function handleCors(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
}

function jsonResponse(body: object, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(request, env),
    },
  });
}
