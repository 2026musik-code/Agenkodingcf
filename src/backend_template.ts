import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  vpsai: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// --- Configuration Helper ---
async function getConfig(env: Bindings) {
  const object = await env.vpsai.get('config.json');
  if (object === null) {
    return {
        githubToken: '',
        githubUsername: '',
        proxyUrl: '',
        aiProvider: 'magma',
        geminiApiKey: '',
        geminiModel: ''
    };
  }
  return await object.json();
}

const getGithubHeaders = (token: string) => ({
    'User-Agent': 'Cloudflare-Worker-Agent',
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`
});

// --- API Endpoints ---

// 1. Config Management
app.get('/api/config', async (c) => {
  try {
    const config: any = await getConfig(c.env);
    return c.json({
        githubToken: config.githubToken ? '********' : '',
        githubUsername: config.githubUsername || '',
        proxyUrl: config.proxyUrl || '',
        aiProvider: config.aiProvider || 'magma',
        geminiApiKey: config.geminiApiKey ? '********' : '',
        geminiModel: config.geminiModel || 'gemini-2.0-flash-exp'
    });
  } catch (e) {
    return c.json({ error: 'Failed to fetch config' }, 500);
  }
});

app.post('/api/config', async (c) => {
  try {
    const body = await c.req.json();
    const existingConfig: any = await getConfig(c.env);

    // Merge existing keys if masked
    const newConfig = {
        githubToken: body.githubToken === '********' ? existingConfig.githubToken : body.githubToken,
        githubUsername: body.githubUsername,
        proxyUrl: body.proxyUrl,
        aiProvider: body.aiProvider,
        geminiApiKey: body.geminiApiKey === '********' ? existingConfig.geminiApiKey : body.geminiApiKey,
        geminiModel: body.geminiModel
    };

    await c.env.vpsai.put('config.json', JSON.stringify(newConfig));
    return c.json({ success: true, message: 'Configuration saved' });
  } catch (e) {
    return c.json({ error: 'Failed to save config' }, 500);
  }
});

// 2. GitHub Integration
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

app.post('/api/github/tree', async (c) => {
  try {
    const { owner, repo, branch } = await c.req.json();
    const config: any = await getConfig(c.env);
    const token = config.githubToken;

    let targetBranch = branch;
    const headers = token ? getGithubHeaders(token) : { 'User-Agent': 'Cloudflare-Worker' };

    if (!targetBranch) {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        if (repoRes.ok) {
            const r: any = await repoRes.json();
            targetBranch = r.default_branch;
        } else {
            targetBranch = 'main';
        }
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
        // Handle empty repo gracefully
        if (response.status === 409 || response.status === 404) {
             return c.json({ tree: [] });
        }
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
    const headers: any = token ? getGithubHeaders(token) : { 'User-Agent': 'Cloudflare-Worker' };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
         return c.json({ error: `GitHub API Error: ${response.status}` }, response.status);
    }

    const data: any = await response.json();
    let content = "";
    if (data.encoding === 'base64' && data.content) {
        content = atob(data.content.replace(/\n/g, ''));
    } else {
        content = "Binary content not displayed.";
    }

    return c.json({ content, sha: data.sha });
  } catch (e: any) {
    return c.json({ error: 'Failed to fetch file content', details: e.message }, 500);
  }
});

app.put('/api/github/file', async (c) => {
    try {
        const { owner, repo, path, content, message, sha } = await c.req.json();
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const body: any = {
            message: message || `Update ${path}`,
            content: btoa(content),
        };
        if (sha) body.sha = sha;

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

app.delete('/api/github/file', async (c) => {
    try {
        const { owner, repo, path, sha } = await c.req.json();
        const config: any = await getConfig(c.env);
        const token = config.githubToken;
        if (!token) return c.json({ error: 'GitHub Token required' }, 401);

        let fileSha = sha;
        if (!fileSha) {
             const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
                 headers: getGithubHeaders(token)
             });
             if (getRes.ok) {
                 const fileData: any = await getRes.json();
                 fileSha = fileData.sha;
             } else {
                 return c.json({ error: 'File not found or unable to fetch SHA' }, 404);
             }
        }

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: getGithubHeaders(token),
            body: JSON.stringify({
                message: `Delete ${path} via AI Agent`,
                sha: fileSha
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return c.json({ error: `GitHub API Error: ${response.status}`, details: errText }, response.status);
        }

        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: 'Failed to delete file', details: e.message }, 500);
    }
});

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
                auto_init: true
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

// 3. Chat History
app.get('/api/history/list', async (c) => {
    try {
        const list = await c.env.vpsai.list({ prefix: 'chats/' });
        const chats = [];
        for (const obj of list.objects) {
            const id = obj.key.replace('chats/', '').replace('.json', '');
            chats.push({ id, updated_at: obj.uploaded });
        }
        chats.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return c.json({ chats });
    } catch (e: any) {
        return c.json({ error: 'Failed to list history', details: e.message }, 500);
    }
});

app.get('/api/history/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const object = await c.env.vpsai.get(`chats/${id}.json`);
        if (!object) return c.json({ error: 'Chat not found' }, 404);
        const data = await object.json();
        return c.json(data);
    } catch (e: any) {
        return c.json({ error: 'Failed to load chat', details: e.message }, 500);
    }
});

app.post('/api/history/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const data = await c.req.json();
        await c.env.vpsai.put(`chats/${id}.json`, JSON.stringify(data));
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: 'Failed to save chat', details: e.message }, 500);
    }
});

app.delete('/api/history/:id', async (c) => {
    try {
        const id = c.req.param('id');
        await c.env.vpsai.delete(`chats/${id}.json`);
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: 'Failed to delete chat', details: e.message }, 500);
    }
});

// 4. AI Chat
app.post('/api/chat', async (c) => {
  try {
    const { message, contextFiles, repo, fileTree } = await c.req.json();
    const config: any = await getConfig(c.env);

    // System Prompt Construction
    let prompt = "You are an expert AI Coding Agent. Analyze the following code context and answer the user's request.\n\n";
    prompt += "IMPORTANT: When generating code files, ALWAYS start the code block with a comment line specifying the full filename path, like this:\n";
    prompt += "// filename: src/example.js\n";
    prompt += "# filename: scripts/deploy.py\n";
    prompt += "<!-- filename: index.html -->\n";
    prompt += "To DELETE a file, use: // delete-file: path/to/file\n\n";

    if (repo && repo.owner && repo.repo) {
        prompt += `Current Repository: ${repo.owner}/${repo.repo}\n`;
    }

    if (fileTree && Array.isArray(fileTree) && fileTree.length > 0) {
        prompt += "--- REPOSITORY STRUCTURE ---\n";
        const treeStr = fileTree.join('\n');
        prompt += (treeStr.length > 2000) ? treeStr.substring(0, 2000) + "\n...(truncated)..." : treeStr;
        prompt += "\n--- END STRUCTURE ---\n\n";
    }

    if (contextFiles && Array.isArray(contextFiles)) {
      prompt += "--- CONTEXT FILES ---\n";
      for (const file of contextFiles) {
        prompt += `File: ${file.path}\n`;
        prompt += `Content:\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
      }
      prompt += "--- END CONTEXT ---\n\n";
    }

    prompt += `User Request: ${message}`;

    // Provider Switching
    if (config.aiProvider === 'gemini') {
        const apiKey = config.geminiApiKey;
        const model = config.geminiModel || 'gemini-2.0-flash-exp';
        if (!apiKey) return c.json({ error: 'Gemini API Key required' }, 401);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data: any = await response.json();
        if (!response.ok) return c.json({ error: `Gemini API Error: ${response.status}`, details: data }, response.status);

        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            return c.json({ result: data.candidates[0].content.parts[0].text });
        }
        return c.json({ result: 'No response from Gemini.' });

    } else {
        // Magma (Default)
        const encodedPrompt = encodeURIComponent(prompt);
        if (encodedPrompt.length > 5000) return c.json({ error: 'Context too large.' }, 400);

        let targetUrl = `https://magma-api.biz.id/ai/gpt5?prompt=${encodedPrompt}`;
        if (config.proxyUrl) targetUrl = config.proxyUrl + encodeURIComponent(targetUrl);

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://google.com'
            }
        });

        const responseText = await response.text();
        let data;
        try { data = JSON.parse(responseText); } catch { data = { message: responseText }; }

        if (!response.ok) return c.json({ error: `AI API Error: ${response.status}`, details: data }, response.status);

        if (data.status === true && data.result && data.result.response) {
            return c.json({ result: data.result.response });
        }
        return c.json({ result: data.message || JSON.stringify(data) });
    }

  } catch (e: any) {
    return c.json({ error: 'Failed to process AI request', details: e.message }, 500);
  }
});

// --- Frontend Assets ---
// Generated by build script
const htmlContent = `{{HTML_CONTENT}}`;
const jsContent = `{{JS_CONTENT}}`;

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, { 'Content-Type': 'application/javascript' }));

export default app;
