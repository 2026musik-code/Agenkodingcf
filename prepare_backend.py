import json

def main():
    # Define the backend logic with NEW GITHUB ENDPOINTS
    backend_code = """import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  vpsai: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// --- R2 Configuration Endpoints ---

async function getConfig(env: Bindings) {
  const object = await env.vpsai.get('config.json');
  if (object === null) {
    return { githubToken: '', githubUsername: '', proxyUrl: '' };
  }
  return await object.json();
}

app.get('/api/config', async (c) => {
  try {
    const config: any = await getConfig(c.env);
    return c.json({
        githubToken: config.githubToken ? '********' : '',
        githubUsername: config.githubUsername || '',
        proxyUrl: config.proxyUrl || ''
    });
  } catch (e) {
    return c.json({ error: 'Failed to fetch config' }, 500);
  }
});

app.post('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    const newConfig = {
        githubToken: body.githubToken,
        githubUsername: body.githubUsername,
        proxyUrl: body.proxyUrl
    };
    await c.env.vpsai.put('config.json', JSON.stringify(newConfig));
    return c.json({ success: true, message: 'Configuration saved' });
  } catch (e) {
    return c.json({ error: 'Failed to save config' }, 500);
  }
});

// --- GitHub Integration Endpoints ---

// Helper for headers
const getGithubHeaders = (token: string) => ({
    'User-Agent': 'Cloudflare-Worker-Agent',
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`
});

// List User Repositories
app.get('/api/github/list', async (c) => {
    try {
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/user/repos?sort=updated&per_page=100`;
        const response = await fetch(url, { headers: getGithubHeaders(token) });

        if (!response.ok) {
            return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
        }

        const data: any = await response.json();
        // Map to simpler format
        const repos = data.map((r: any) => ({
            full_name: r.full_name,
            private: r.private,
            updated_at: r.updated_at
        }));
        return c.json({ repos });
    } catch (e: any) {
        return c.json({ error: 'Failed to fetch repo list', details: e.message }, 500);
    }
});

// Create Repository
app.post('/api/github/create', async (c) => {
    try {
        const { name, private: isPrivate, description } = await c.req.json();
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/user/repos`;
        const response = await fetch(url, {
            method: 'POST',
            headers: getGithubHeaders(token),
            body: JSON.stringify({
                name,
                private: isPrivate,
                description,
                auto_init: true // Initialize with README
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
        }

        const data: any = await response.json();
        return c.json({ success: true, repo: data.full_name });
    } catch (e: any) {
        return c.json({ error: 'Failed to create repo', details: e.message }, 500);
    }
});

// Update/Create File
app.put('/api/github/file', async (c) => {
    try {
        const { owner, repo, path, content, message, sha } = await c.req.json();
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        // Prepare body
        const body: any = {
            message: message || `Update ${path}`,
            content: btoa(content), // Base64 encode
        };
        if (sha) body.sha = sha; // Required if updating existing file

        const response = await fetch(url, {
            method: 'PUT',
            headers: getGithubHeaders(token),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
        }

        const data = await response.json();
        return c.json({ success: true, content: data.content });
    } catch (e: any) {
        return c.json({ error: 'Failed to save file', details: e.message }, 500);
    }
});

// Get Tree (Existing)
app.post('/api/github/tree', async (c) => {
  try {
    const { owner, repo, branch } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;

    // Resolve Default Branch if not provided
    let targetBranch = branch;
    const headers = token ? getGithubHeaders(token) : { 'User-Agent': 'Cloudflare-Worker' };

    if (!targetBranch) {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        if (repoRes.ok) {
            const r: any = await repoRes.json();
            targetBranch = r.default_branch;
        } else {
            targetBranch = 'main'; // Fallback
        }
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
        const errText = await response.text();
        return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
    }

    const data = await response.json();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch GitHub tree', details: e.message }, 500);
  }
});

// Get File Content (Existing)
app.post('/api/github/file', async (c) => {
  try {
    const { owner, repo, path } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;
    const headers: any = token ? getGithubHeaders(token) : { 'User-Agent': 'Cloudflare-Worker' };

    // We need the SHA to update the file later, so getting metadata is useful,
    // but the raw content is better for viewing.
    // Strategy: Fetch raw for display. Frontend handles SHA if needed (by re-fetching metadata or just overwrite? Git API needs SHA for updates).
    // Better: Fetch the metadata endpoint which gives content (base64) AND sha.

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
         return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
    }

    const data: any = await response.json();
    // Decode if base64
    let content = "";
    if (data.encoding === 'base64' && data.content) {
        content = atob(data.content.replace(/\\n/g, ''));
    } else {
        // If it's a directory or other, handle?
        // Assume file.
        content = "Binary or large file content not displayed.";
    }

    return c.json({ content, sha: data.sha });
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch file content', details: e.message }, 500);
  }
});

// --- AI Chat Endpoint ---

app.post('/api/chat', async (c) => {
  try {
    const { message, contextFiles } = await c.req.json();
    const config: any = await getConfig(c.env);
    const proxyUrl = config.proxyUrl;

    // Construct Prompt
    let prompt = "You are an expert AI Coding Agent. Analyze the following code context and answer the user's request.\\n\\n";

    if (contextFiles && Array.isArray(contextFiles)) {
      prompt += "--- CONTEXT FILES ---\\n";
      for (const file of contextFiles) {
        prompt += `File: ${file.path}\\n`;
        prompt += `Content:\\n\`\`\`\\n${file.content}\\n\`\`\`\\n\\n`;
      }
      prompt += "--- END CONTEXT ---\\n\\n";
    }

    prompt += `User Request: ${message}`;

    const encodedPrompt = encodeURIComponent(prompt);
    if (encodedPrompt.length > 5000) {
        return c.json({ error: 'Context too large. Please select fewer files.' }, 400);
    }

    let targetUrl = `https://magma-api.biz.id/ai/gpt5?prompt=${encodedPrompt}`;

    if (proxyUrl && proxyUrl.trim() !== '') {
        targetUrl = proxyUrl.trim() + encodeURIComponent(targetUrl);
    }

    const headers: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://google.com'
    };

    const response = await fetch(targetUrl, { headers });
    const responseText = await response.text();

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        data = { message: responseText };
    }

    if (!response.ok) {
        return c.json({ error: `AI API Error: ${response.status}`, details: data }, response.status);
    }

    if (data.status === true && data.result && data.result.response) {
        return c.json({ result: data.result.response });
    }
    return c.json({ result: data.message || JSON.stringify(data) });

  } catch (e: any) {
    return c.json({ error: 'Failed to process AI request', details: e.message }, 500);
  }
});
"""

    # Read the updated UI files (Placeholder - I need to update them NEXT)
    # I will write empty placeholders to the file for now, then update UI files, then run the final assembly script.
    # Actually, I can't do that. I need to update UI files FIRST or define them in the final script.
    # Since I am splitting the task, I will write this backend code to a temporary file `src/backend.ts`
    # and use it later? No, I'll just keep it in this script but I need the UI strings.

    # I will proceed to Plan Step 2 (Update UI) and then do the final assembly in Step 4.
    # So for this step, I'll just create the backend logic file to verify it compiles?
    # I'll write it to `src/index.ts.part` or similar?
    # Better: I will update `src/ui.html` and `src/ui.js` NOW in the next steps, then come back to assembly.

    pass

if __name__ == "__main__":
    main()
