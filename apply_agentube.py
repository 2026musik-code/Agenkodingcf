import json

def main():
    # Define the backend logic with AGENTUBE HEADERS and CORRECT URL
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
    return { ferdevApiKey: '', githubToken: '', proxyUrl: '' };
  }
  return await object.json();
}

app.get('/api/config', async (c) => {
  try {
    const config: any = await getConfig(c.env);
    return c.json({
        ferdevApiKey: config.ferdevApiKey ? '********' : '',
        githubToken: config.githubToken ? '********' : '',
        proxyUrl: config.proxyUrl || ''
    });
  } catch (e) {
    return c.json({ error: 'Failed to fetch config' }, 500);
  }
});

app.post('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    await c.env.vpsai.put('config.json', JSON.stringify(body));
    return c.json({ success: true, message: 'Configuration saved' });
  } catch (e) {
    return c.json({ error: 'Failed to save config' }, 500);
  }
});

// --- GitHub Integration Endpoints ---

app.post('/api/github/tree', async (c) => {
  try {
    const { owner, repo, branch } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;

    const branchName = branch || 'main';
    let targetBranch = branchName;
    const headers: any = {
      'User-Agent': 'Cloudflare-Worker-Agent',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    if (!branch) {
       const repoInfoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
       if (repoInfoRes.ok) {
           const repoInfo: any = await repoInfoRes.json();
           targetBranch = repoInfo.default_branch;
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

app.post('/api/github/file', async (c) => {
  try {
    const { owner, repo, path } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;

    const headers: any = {
      'User-Agent': 'Cloudflare-Worker-Agent',
      'Accept': 'application/vnd.github.v3.raw'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
         return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
    }

    const content = await response.text();
    return c.json({ content });
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch file content', details: e.message }, 500);
  }
});

// --- AI Chat Endpoint ---

app.post('/api/chat', async (c) => {
  try {
    const { message, contextFiles } = await c.req.json();
    const config: any = await getConfig(c.env);
    const apiKey = config.ferdevApiKey;
    const proxyUrl = config.proxyUrl;

    if (!apiKey) {
      return c.json({ error: 'AI API Key not configured. Please go to Settings.' }, 400);
    }

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

    // Call Ferdev API - CORRECT ENDPOINT: /ai/aicoding
    const encodedPrompt = encodeURIComponent(prompt);
    // Limit prompt length
    if (encodedPrompt.length > 5000) {
        return c.json({ error: 'Context too large. Please select fewer files.' }, 400);
    }

    let targetUrl = `https://api.ferdev.my.id/ai/aicoding?prompt=${encodedPrompt}&apikey=${apiKey}`;

    // Apply Proxy if configured
    if (proxyUrl && proxyUrl.trim() !== '') {
        targetUrl = proxyUrl.trim() + encodeURIComponent(targetUrl);
    }

    // Headers logic - MIMIC AGENTUBE REPO EXACTLY
    const headers: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://google.com',
        'Accept': '*/*'
    };

    // Only use custom headers if NOT using a proxy (or proxy supports them)
    // If proxyUrl is set, we still send them, hoping the proxy forwards them.

    const response = await fetch(targetUrl, { headers });

    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        data = { message: responseText };
    }

    if (!response.ok) {
        return c.json({
            error: `AI API Error: ${response.status} ${response.statusText}`,
            details: data.message || JSON.stringify(data)
        }, response.status);
    }

    if (data.success === false) {
         return c.json({
            error: `AI API returned failure: ${data.message}`,
            details: data
        }, 400);
    }

    return c.json(data);

  } catch (e: any) {
    return c.json({ error: 'Failed to process AI request', details: e.message }, 500);
  }
});
"""

    # Read the updated UI files
    with open('src/ui.html', 'r') as f:
        html_code = f.read()

    with open('src/ui.js', 'r') as f:
        js_code = f.read()

    # Construct the FINAL full content for src/index.ts
    full_content = f"""{backend_code}

// --- Frontend Serving ---

const htmlContent = {json.dumps(html_code)};
const jsContent = {json.dumps(js_code)};

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, {{ 'Content-Type': 'application/javascript' }}));

export default app;
"""

    with open('src/index.ts', 'w') as f:
        f.write(full_content)

    print("Successfully generated src/index.ts with Agentube headers.")

if __name__ == "__main__":
    main()
