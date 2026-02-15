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
const htmlContent = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>AI Agent Coding</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
    <style>
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #6b7280; }
        .glass { background: rgba(31, 41, 55, 0.7); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.05); }
        .mobile-safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
        .mobile-safe-top { padding-top: env(safe-area-inset-top); }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fadeInUp 0.3s ease-out forwards; }
    </style>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: { extend: { colors: { primary: '#3b82f6', secondary: '#10b981', dark: '#0f172a', darker: '#020617' } } }
        }
    </script>
</head>
<body class="bg-darker text-gray-200 font-sans h-[100dvh] flex flex-col md:flex-row overflow-hidden select-none touch-manipulation">
    <header class="md:hidden flex items-center justify-between p-4 glass border-b border-gray-800 z-50 mobile-safe-top shrink-0">
        <button id="mobileMenuBtn" class="text-gray-300 hover:text-white p-2"><i class="fa-solid fa-bars text-xl"></i></button>
        <h1 class="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">AI Agent</h1>
        <button id="mobileSettingsBtn" class="text-gray-300 hover:text-white p-2"><i class="fa-solid fa-gear text-xl"></i></button>
    </header>
    <aside id="sidebar" class="fixed inset-y-0 left-0 w-80 bg-dark/95 backdrop-blur-xl border-r border-gray-800 flex flex-col z-40 transform -translate-x-full md:translate-x-0 transition-transform duration-300 md:static md:bg-dark md:glass">
        <div class="hidden md:flex p-4 border-b border-gray-800 justify-between items-center">
            <h1 class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400"><i class="fa-solid fa-robot mr-2"></i>AI Agent</h1>
            <button id="desktopSettingsBtn" class="text-gray-400 hover:text-white transition"><i class="fa-solid fa-gear"></i></button>
        </div>
        <div class="md:hidden p-4 flex justify-end mobile-safe-top"><button id="closeSidebarBtn" class="text-gray-400 p-2"><i class="fa-solid fa-xmark text-xl"></i></button></div>
        <div class="flex border-b border-gray-800 bg-gray-900/20">
            <button id="tabRepoBtn" class="flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium transition"><i class="fa-brands fa-github mr-2"></i>Repo</button>
            <button id="tabHistoryBtn" class="flex-1 py-3 text-sm text-gray-400 hover:text-white transition"><i class="fa-solid fa-clock-rotate-left mr-2"></i>History</button>
        </div>
        <div id="tabRepoContent" class="flex-1 flex flex-col h-full overflow-hidden">
            <div class="p-4 space-y-3 shrink-0">
                <div class="flex space-x-2 bg-gray-900/50 p-1 rounded-lg">
                    <button id="modeManualBtn" class="flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition">Manual</button>
                    <button id="modeListBtn" class="flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition">My Repos</button>
                </div>
                <div id="manualRepoInputGroup" class="flex space-x-2">
                    <input type="text" id="repoInput" placeholder="owner/repo" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition">
                    <button id="loadRepoBtn" class="bg-primary hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm transition shadow-lg"><i class="fa-solid fa-download"></i></button>
                </div>
                <div id="repoListGroup" class="hidden space-y-2">
                    <select id="repoSelect" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition"><option value="">Select...</option></select>
                    <div class="flex space-x-2">
                        <button id="refreshReposBtn" class="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-2 rounded-lg text-xs transition"><i class="fa-solid fa-sync"></i> Refresh</button>
                        <button id="createRepoBtn" class="flex-1 bg-green-600 hover:bg-green-500 text-white px-2 py-2 rounded-lg text-xs transition"><i class="fa-solid fa-plus"></i> New</button>
                    </div>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto p-2 scrollbar-thin" id="fileTree"><div class="flex flex-col items-center justify-center h-full text-gray-500 text-sm space-y-2"><i class="fa-brands fa-github text-4xl opacity-20"></i><p>Load a repo to start</p></div></div>
        </div>
        <div id="tabHistoryContent" class="hidden flex-1 flex-col h-full overflow-hidden">
             <div class="p-4 shrink-0"><button id="newChatBtn" class="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm shadow-md transition flex items-center justify-center"><i class="fa-solid fa-plus mr-2"></i> New Chat</button></div>
             <div id="historyList" class="flex-1 overflow-y-auto p-2 scrollbar-thin space-y-1"></div>
        </div>
        <div class="p-4 border-t border-gray-800 bg-gray-900/30 text-xs text-gray-400 flex justify-between items-center mobile-safe-bottom">
            <span>Selected: <span id="selectedCount" class="text-white font-bold">0</span></span>
            <button id="clearContextBtn" class="text-red-400 hover:text-red-300 transition px-2 py-1 rounded hover:bg-red-500/10">Clear All</button>
        </div>
    </aside>
    <div id="sidebarOverlay" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 hidden md:hidden transition-opacity opacity-0"></div>
    <main class="flex-1 flex flex-col relative bg-darker w-full h-full overflow-hidden">
        <div id="fileToolbar" class="hidden absolute top-4 right-4 z-20 flex space-x-2">
            <button id="saveFileBtn" class="bg-blue-600/90 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs shadow-lg backdrop-blur-sm flex items-center transition"><i class="fa-solid fa-floppy-disk mr-2"></i> Save Changes</button>
        </div>
        <div id="chatContainer" class="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth">
            <div class="flex items-start space-x-3 md:space-x-4 animate-fade-in-up">
                <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-robot text-white text-sm md:text-base"></i></div>
                <div class="glass rounded-2xl rounded-tl-none p-3 md:p-4 max-w-[85%] md:max-w-3xl shadow-xl text-sm md:text-base"><p>Hello! I am your AI Coding Agent. <br>Login in Settings to manage your GitHub repositories.</p></div>
            </div>
        </div>
        <div class="w-full p-2 md:p-6 bg-darker mobile-safe-bottom z-20 shrink-0 border-t border-gray-800/50">
            <div class="max-w-4xl mx-auto relative glass rounded-2xl shadow-2xl border border-gray-700/50 backdrop-blur-md">
                <textarea id="promptInput" rows="1" placeholder="Ask AI to generate code..." class="w-full bg-transparent border-none text-white p-3 md:p-4 focus:ring-0 resize-none placeholder-gray-500 text-sm md:text-base max-h-32 overflow-y-auto leading-relaxed"></textarea>
                <div class="flex justify-between items-center px-3 pb-2 md:px-4 md:pb-3 border-t border-gray-700/30 pt-2">
                    <div class="text-[10px] md:text-xs text-gray-500 flex items-center"><i class="fa-brands fa-markdown mr-1"></i> <span class="hidden md:inline">Markdown supported</span></div>
                    <button id="sendBtn" class="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white px-4 py-1.5 md:px-6 md:py-2 rounded-xl font-semibold shadow-lg shadow-blue-500/20 transition transform active:scale-95 flex items-center text-sm md:text-base"><span>Send</span> <i class="fa-solid fa-paper-plane ml-2"></i></button>
                </div>
            </div>
        </div>
    </main>
    <div id="settingsModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] hidden flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl transform transition-all scale-95 opacity-0" id="settingsContent">
            <div class="flex justify-between items-center mb-6"><h2 class="text-xl font-bold text-white">Settings</h2><button id="closeSettingsBtn" class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800 transition"><i class="fa-solid fa-xmark text-lg"></i></button></div>
            <div class="space-y-5">
                <div class="p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
                    <label class="block text-xs font-bold text-blue-400 uppercase tracking-wider mb-3">AI Configuration</label>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-300 mb-1.5">AI Provider</label>
                        <select id="aiProviderSelect" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition">
                            <option value="magma">Magma (Free / GPT-5)</option>
                            <option value="gemini">Google Gemini</option>
                        </select>
                    </div>
                    <div id="geminiKeyGroup" class="hidden space-y-4">
                        <div><label class="block text-sm font-medium text-gray-300 mb-1.5">Gemini API Key</label><input type="password" id="geminiKeyInput" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="AIz..."></div>
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-1.5">Model Name</label>
                            <input type="text" id="geminiModelInput" list="geminiModels" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="gemini-3.0-flash">
                            <datalist id="geminiModels">
                                <option value="gemini-3.0-flash"><option value="gemini-3.0-pro"><option value="gemini-2.5-flash"><option value="gemini-2.5-pro"><option value="gemini-2.0-flash-exp"><option value="gemini-1.5-pro"><option value="gemini-1.5-flash">
                            </datalist>
                            <p class="text-xs text-gray-500 mt-1.5">Select a model or type a custom ID</p>
                        </div>
                    </div>
                </div>
                <div><label class="block text-sm font-medium text-gray-400 mb-1.5">GitHub Username</label><input type="text" id="githubUsernameInput" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="e.g. ferdev"></div>
                <div><label class="block text-sm font-medium text-gray-400 mb-1.5">GitHub Token</label><input type="password" id="githubTokenInput" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="ghp_..."><p class="text-xs text-gray-600 mt-1.5">Required for accessing private repos.</p></div>
                <div><label class="block text-sm font-medium text-gray-400 mb-1.5">Custom Proxy URL</label><input type="text" id="proxyUrlInput" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition" placeholder="Optional"></div>
            </div>
            <div class="mt-8 flex justify-end"><button id="saveSettingsBtn" class="w-full md:w-auto bg-primary hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg transition shadow-lg font-medium">Save Configuration</button></div>
        </div>
    </div>
    <div id="createRepoModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] hidden flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h2 class="text-xl font-bold text-white mb-4">Create Repository</h2>
            <div class="space-y-4">
                <input type="text" id="newRepoName" placeholder="Repository Name" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white">
                <input type="text" id="newRepoDesc" placeholder="Description" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white">
                <div class="flex items-center"><input type="checkbox" id="newRepoPrivate" class="mr-2"><label for="newRepoPrivate" class="text-gray-300 text-sm">Private Repository</label></div>
            </div>
            <div class="mt-6 flex justify-end space-x-3"><button id="cancelCreateRepoBtn" class="text-gray-400 hover:text-white px-4 py-2">Cancel</button><button id="confirmCreateRepoBtn" class="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg">Create</button></div>
        </div>
    </div>
    <script src="/ui.js"></script>
</body>
</html>`;
const jsContent = `// State
let selectedFiles = new Map();
let currentRepo = { owner: '', repo: '' };
let currentRepoFiles = [];
let currentFile = { path: '', sha: '' };
let currentSessionId = Date.now().toString();
let chatHistory = [];

// DOM Elements
const settingsModal = document.getElementById('settingsModal');
const settingsContent = document.getElementById('settingsContent');
const settingsBtn = document.getElementById('settingsBtn');
const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
const desktopSettingsBtn = document.getElementById('desktopSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const githubUsernameInput = document.getElementById('githubUsernameInput');
const githubTokenInput = document.getElementById('githubTokenInput');
const proxyUrlInput = document.getElementById('proxyUrlInput');
const aiProviderSelect = document.getElementById('aiProviderSelect');
const geminiKeyGroup = document.getElementById('geminiKeyGroup');
const geminiKeyInput = document.getElementById('geminiKeyInput');
const geminiModelInput = document.getElementById('geminiModelInput');
const repoInput = document.getElementById('repoInput');
const loadRepoBtn = document.getElementById('loadRepoBtn');
const fileTree = document.getElementById('fileTree');
const selectedCount = document.getElementById('selectedCount');
const clearContextBtn = document.getElementById('clearContextBtn');
const chatContainer = document.getElementById('chatContainer');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const modeManualBtn = document.getElementById('modeManualBtn');
const modeListBtn = document.getElementById('modeListBtn');
const manualRepoInputGroup = document.getElementById('manualRepoInputGroup');
const repoListGroup = document.getElementById('repoListGroup');
const repoSelect = document.getElementById('repoSelect');
const refreshReposBtn = document.getElementById('refreshReposBtn');
const createRepoBtn = document.getElementById('createRepoBtn');
const createRepoModal = document.getElementById('createRepoModal');
const confirmCreateRepoBtn = document.getElementById('confirmCreateRepoBtn');
const cancelCreateRepoBtn = document.getElementById('cancelCreateRepoBtn');
const newRepoName = document.getElementById('newRepoName');
const newRepoDesc = document.getElementById('newRepoDesc');
const newRepoPrivate = document.getElementById('newRepoPrivate');
const fileToolbar = document.getElementById('fileToolbar');
const saveFileBtn = document.getElementById('saveFileBtn');
const tabRepoBtn = document.getElementById('tabRepoBtn');
const tabHistoryBtn = document.getElementById('tabHistoryBtn');
const tabRepoContent = document.getElementById('tabRepoContent');
const tabHistoryContent = document.getElementById('tabHistoryContent');
const historyList = document.getElementById('historyList');
const newChatBtn = document.getElementById('newChatBtn');

// Marked Init
const renderer = new marked.Renderer();
renderer.code = function(code, language) {
    const blockId = 'code-' + Math.random().toString(36).substr(2, 9);
    let highlighted = code;
    if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(code, { language: language }).value;
    } else {
        highlighted = hljs.highlightAuto(code).value;
    }
    return \`<div class="relative group my-4">
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition duration-200 z-10 flex space-x-2">
                 <button onclick="copyCode('\${blockId}')" class="bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded shadow-md border border-gray-600 flex items-center" title="Copy"><i class="fa-regular fa-copy mr-1"></i> Copy</button>
                 <button onclick="saveCodeToRepo('\${blockId}')" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-md border border-blue-500 flex items-center" title="Save"><i class="fa-brands fa-github mr-1"></i> Save</button>
            </div>
            <pre><code id="\${blockId}" class="hljs language-\${language || 'plaintext'} p-4 rounded-lg block overflow-x-auto text-sm bg-[#282c34]">\${highlighted}</code></pre>
            <textarea id="\${blockId}-raw" class="hidden">\${code}</textarea>
        </div>\`;
};
marked.use({ renderer });

// Global Helpers
window.copyCode = function(id) {
    const raw = document.getElementById(id + '-raw').value;
    navigator.clipboard.writeText(raw).then(() => addMessage('system', 'Code copied to clipboard!'));
};
window.saveCodeToRepo = async function(id) {
    const raw = document.getElementById(id + '-raw').value;
    const filename = prompt("Enter the path to save this file (e.g., src/index.js):");
    if (!filename) return;
    if (!currentRepo.owner || !currentRepo.repo) { alert("Please select a repository first!"); return; }
    try {
        // Auto-fetch SHA if exists
        let sha = null;
        try {
            const checkRes = await fetch('/api/github/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename }) });
            if (checkRes.ok) sha = (await checkRes.json()).sha;
        } catch (e) {}

        const res = await fetch('/api/github/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename, content: raw, message: \`Update \${filename} from AI\`, sha: sha })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        addMessage('system', \`Successfully saved <b>\${filename}</b>\`);
        loadRepository(currentRepo.owner, currentRepo.repo);
    } catch (e) { alert(\`Error saving file: \${e.message}\`); }
};
window.deleteChat = async function(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    try { await fetch(\`/api/history/\${id}\`, { method: 'DELETE' }); loadHistoryList(); if (id === currentSessionId) startNewChat(); } catch (e) { alert('Failed to delete'); }
};
window.loadChatSession = async function(id) {
    chatContainer.innerHTML = ''; chatHistory = []; currentSessionId = id; localStorage.setItem('lastSessionId', id);
    const loader = document.createElement('div'); loader.className = 'text-center text-gray-500 mt-10'; loader.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...'; chatContainer.appendChild(loader);
    try {
        const res = await fetch(\`/api/history/\${id}\`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        chatContainer.removeChild(loader);
        if (data.messages) { chatHistory = data.messages; chatHistory.forEach(msg => addMessageToUI(msg.role, msg.content)); }
        if (window.innerWidth < 768) toggleSidebar(false);
    } catch (e) { chatContainer.innerHTML = ''; addMessage('system', \`Error: \${e.message}\`); }
};

// UI Logic
function toggleSidebar(show) {
    if (show) { sidebar.classList.remove('-translate-x-full'); sidebarOverlay.classList.remove('hidden'); setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10); if (!tabHistoryContent.classList.contains('hidden')) loadHistoryList(); }
    else { sidebar.classList.add('-translate-x-full'); sidebarOverlay.classList.add('opacity-0'); setTimeout(() => sidebarOverlay.classList.add('hidden'), 300); }
}
mobileMenuBtn?.addEventListener('click', () => toggleSidebar(true));
closeSidebarBtn?.addEventListener('click', () => toggleSidebar(false));
sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));

function toggleSettings(show) {
    if (show) { settingsModal.classList.remove('hidden'); setTimeout(() => { settingsContent.classList.remove('scale-95', 'opacity-0'); settingsContent.classList.add('scale-100', 'opacity-100'); }, 10); }
    else { settingsContent.classList.remove('scale-100', 'opacity-100'); settingsContent.classList.add('scale-95', 'opacity-0'); setTimeout(() => settingsModal.classList.add('hidden'), 300); }
}
settingsBtn?.addEventListener('click', () => toggleSettings(true));
desktopSettingsBtn?.addEventListener('click', () => toggleSettings(true));
mobileSettingsBtn?.addEventListener('click', () => toggleSettings(true));
closeSettingsBtn?.addEventListener('click', () => toggleSettings(false));

// Tabs
tabRepoBtn.addEventListener('click', () => { tabRepoBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium'; tabHistoryBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white'; tabRepoContent.classList.remove('hidden'); tabHistoryContent.classList.add('hidden'); });
tabHistoryBtn.addEventListener('click', () => { tabHistoryBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium'; tabRepoBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white'; tabHistoryContent.classList.remove('hidden'); tabRepoContent.classList.add('hidden'); loadHistoryList(); });

// Settings Logic
aiProviderSelect.addEventListener('change', () => { if (aiProviderSelect.value === 'gemini') geminiKeyGroup.classList.remove('hidden'); else geminiKeyGroup.classList.add('hidden'); });
async function loadConfig() {
    try {
        const res = await fetch('/api/config'); const data = await res.json();
        if (data.githubUsername) githubUsernameInput.value = data.githubUsername;
        if (data.githubToken) githubTokenInput.value = data.githubToken;
        if (data.proxyUrl) proxyUrlInput.value = data.proxyUrl;
        if (data.aiProvider) { aiProviderSelect.value = data.aiProvider; if (data.aiProvider === 'gemini') geminiKeyGroup.classList.remove('hidden'); }
        if (data.geminiApiKey) geminiKeyInput.value = data.geminiApiKey;
        if (data.geminiModel) geminiModelInput.value = data.geminiModel;
    } catch (e) { console.error(e); }
}
saveSettingsBtn.addEventListener('click', async () => {
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; saveSettingsBtn.disabled = true;
    try {
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ githubUsername: githubUsernameInput.value, githubToken: githubTokenInput.value, proxyUrl: proxyUrlInput.value, aiProvider: aiProviderSelect.value, geminiApiKey: geminiKeyInput.value, geminiModel: geminiModelInput.value }) });
        toggleSettings(false); addMessage('system', 'Configuration saved.'); if (!modeListBtn.className.includes('text-gray-400')) fetchMyRepos();
    } catch (e) { alert('Failed to save'); } finally { saveSettingsBtn.textContent = 'Save Configuration'; saveSettingsBtn.disabled = false; }
});

// GitHub Logic
modeManualBtn.addEventListener('click', () => { modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition'; modeListBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition'; manualRepoInputGroup.classList.remove('hidden'); repoListGroup.classList.add('hidden'); });
modeListBtn.addEventListener('click', () => { modeListBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition'; modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition'; manualRepoInputGroup.classList.add('hidden'); repoListGroup.classList.remove('hidden'); fetchMyRepos(); });
async function fetchMyRepos() {
    repoSelect.innerHTML = '<option>Loading...</option>';
    try { const res = await fetch('/api/github/list'); if(!res.ok) throw new Error('Failed'); const data = await res.json(); repoSelect.innerHTML = '<option value="">Select...</option>'; data.repos.forEach(r => { const opt = document.createElement('option'); opt.value = r.full_name; opt.textContent = \`\${r.full_name} \${r.private ? '(🔒)' : ''}\`; repoSelect.appendChild(opt); }); }
    catch (e) { repoSelect.innerHTML = \`<option>Error: \${e.message}</option>\`; }
}
refreshReposBtn.addEventListener('click', fetchMyRepos);
repoSelect.addEventListener('change', () => { if(repoSelect.value) { const [o, r] = repoSelect.value.split('/'); loadRepository(o, r); } });
loadRepoBtn.addEventListener('click', () => { const v = repoInput.value.trim(); if(v) { const [o, r] = v.split('/'); if(o && r) loadRepository(o, r); } });

async function loadRepository(owner, repo) {
    fileTree.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400"><i class="fa-solid fa-circle-notch fa-spin text-2xl mr-3"></i> Loading...</div>';
    try {
        const res = await fetch('/api/github/tree', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, repo }) });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json(); currentRepo = { owner, repo }; localStorage.setItem('lastRepo', JSON.stringify(currentRepo)); currentRepoFiles = data.tree || []; renderFileTree(data.tree); addMessage('system', \`Loaded: \${owner}/\${repo}\`); if(window.innerWidth<768) toggleSidebar(false);
    } catch (e) { fileTree.innerHTML = \`<div class="p-4 text-red-400 text-center text-sm">Error: \${e.message}</div>\`; }
}
function renderFileTree(tree) {
    fileTree.innerHTML = ''; if(!tree || tree.length===0) { fileTree.innerHTML = '<div class="text-center text-gray-500 mt-4 text-sm">Empty.</div>'; return; }
    const sorted = tree.sort((a,b) => (a.type===b.type ? a.path.localeCompare(b.path) : (a.type==='tree' ? -1 : 1)));
    const list = document.createElement('ul'); list.className = 'space-y-1 text-sm p-2';
    sorted.forEach(item => {
        const li = document.createElement('li'); li.className = 'cursor-pointer hover:bg-gray-800/50 rounded-lg px-3 py-2 truncate flex items-center select-none active:bg-gray-700';
        li.innerHTML = \`\${item.type==='tree'?'<i class="fa-regular fa-folder text-blue-400 mr-2.5"></i>':'<i class="fa-regular fa-file text-gray-400 mr-2.5"></i>'}<span class="truncate">\${item.path}</span>\`;
        if (item.type==='blob') li.addEventListener('click', () => selectFile(item.path, li));
        list.appendChild(li);
    });
    fileTree.appendChild(list);
}
async function selectFile(path, el) {
    fileTree.querySelectorAll('li').forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500')); el.classList.add('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');
    try { const res = await fetch('/api/github/file', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path }) }); if(!res.ok) throw new Error('Failed'); const data = await res.json(); selectedFiles.set(path, data.content); currentFile = { path, sha: data.sha }; updateContextCount(); fileToolbar.classList.remove('hidden'); addMessage('system', \`Selected: \${path}\`); } catch (e) { alert(e.message); }
}
function updateContextCount() { selectedCount.textContent = selectedFiles.size; }
clearContextBtn.addEventListener('click', () => { selectedFiles.clear(); currentFile = {path:'', sha:''}; fileToolbar.classList.add('hidden'); updateContextCount(); fileTree.querySelectorAll('li').forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500')); });
saveFileBtn.addEventListener('click', async () => {
    if (!currentFile.path) return; const c = prompt("Confirm content:", selectedFiles.get(currentFile.path)); if (c === null) return;
    saveFileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    try { const res = await fetch('/api/github/file', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: currentFile.path, content: c, sha: currentFile.sha, message: \`Update \${currentFile.path}\` }) }); if(!res.ok) throw new Error((await res.json()).error); const data = await res.json(); selectedFiles.set(currentFile.path, c); addMessage('system', \`Saved: \${currentFile.path}\`); } catch (e) { alert(e.message); } finally { saveFileBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Save Changes'; }
});
createRepoBtn.addEventListener('click', () => createRepoModal.classList.remove('hidden'));
cancelCreateRepoBtn.addEventListener('click', () => createRepoModal.classList.add('hidden'));
confirmCreateRepoBtn.addEventListener('click', async () => {
    const name = newRepoName.value.trim(); if (!name) return alert('Name required'); confirmCreateRepoBtn.disabled = true; confirmCreateRepoBtn.textContent = 'Creating...';
    try { const res = await fetch('/api/github/create', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, description: newRepoDesc.value, private: newRepoPrivate.checked }) }); if(!res.ok) throw new Error((await res.json()).error); const data = await res.json(); createRepoModal.classList.add('hidden'); addMessage('system', \`Created: \${data.repo}\`); fetchMyRepos(); } catch (e) { alert(e.message); } finally { confirmCreateRepoBtn.disabled = false; confirmCreateRepoBtn.textContent = 'Create'; }
});

// Chat & Automation
async function autoSaveFiles(content) {
    if (!currentRepo.owner || !currentRepo.repo) return;
    const regex = /^\\\`\\\`\\\`[\\w]*\\n([\\s\\S]*?)\\\`\\\`\\\`/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const lines = match[1].split('\\n');
        if (lines.length === 0) continue;
        const first = lines[0].trim();

        // Auto-Save
        const saveMatch = first.match(/(?:\\/\\/|#|<!--)\\s*filename:\\s*([^\\s-]+)(?:\\s*-->)?/i);
        if (saveMatch && saveMatch[1]) {
            const filename = saveMatch[1].trim(); const code = lines.slice(1).join('\\n');
            addMessage('system', \`<i class="fa-solid fa-spinner fa-spin"></i> Saving <b>\${filename}</b>...\`);
            try {
                let sha = null; try { const r = await fetch('/api/github/file', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename }) }); if(r.ok) sha = (await r.json()).sha; } catch(e){}
                const res = await fetch('/api/github/file', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename, content: code, message: 'Auto-generated', sha }) });
                if(!res.ok) throw new Error((await res.json()).error); addMessage('system', \`<i class="fa-solid fa-check text-green-400"></i> Saved <b>\${filename}</b>\`); loadRepository(currentRepo.owner, currentRepo.repo);
            } catch(e) { addMessage('system', \`<span class="text-red-400">Failed to save \${filename}: \${e.message}</span>\`); }
        }

        // Auto-Delete
        const delMatch = first.match(/(?:\\/\\/|#|<!--)\\s*delete-file:\\s*([^\\s-]+)(?:\\s*-->)?/i);
        if (delMatch && delMatch[1]) {
            const filename = delMatch[1].trim();
            addMessage('system', \`<i class="fa-solid fa-spinner fa-spin"></i> Deleting <b>\${filename}</b>...\`);
            try {
                const res = await fetch('/api/github/file', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path: filename }) });
                if(!res.ok) throw new Error((await res.json()).error); addMessage('system', \`<i class="fa-solid fa-trash text-red-400"></i> Deleted <b>\${filename}</b>\`); loadRepository(currentRepo.owner, currentRepo.repo);
            } catch(e) { addMessage('system', \`<span class="text-red-400">Failed delete \${filename}: \${e.message}</span>\`); }
        }
    }
}

// History
async function loadHistoryList() {
    historyList.innerHTML = '<div class="text-gray-500 text-center text-xs mt-4">Loading...</div>';
    try {
        const res = await fetch('/api/history/list');
        const data = await res.json();
        historyList.innerHTML = '';
        if (data.chats.length === 0) { historyList.innerHTML = '<div class="text-gray-600 text-center text-xs mt-4">No history</div>'; return; }
        data.chats.forEach(chat => {
             const div = document.createElement('div');
             div.className = 'group flex items-center justify-between p-2 rounded hover:bg-gray-800 cursor-pointer text-sm text-gray-300 transition';
             div.innerHTML = \`<span><i class="fa-regular fa-message mr-2 text-gray-500"></i>\${chat.id}</span>
                              <button onclick="deleteChat(event, '\${chat.id}')" class="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition px-2"><i class="fa-solid fa-trash"></i></button>\`;
             div.addEventListener('click', () => loadChatSession(chat.id));
             historyList.appendChild(div);
        });
    } catch (e) { historyList.innerHTML = \`<div class="text-red-400 text-xs">Error: \${e.message}</div>\`; }
}
function startNewChat() { chatContainer.innerHTML = ''; chatHistory = []; currentSessionId = Date.now().toString(); localStorage.setItem('lastSessionId', currentSessionId); addMessage('system', 'New chat started.'); if (window.innerWidth < 768) toggleSidebar(false); }
newChatBtn.addEventListener('click', startNewChat);
async function saveCurrentChat() {
    try { await fetch(\`/api/history/\${currentSessionId}\`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ messages: chatHistory }) }); } catch (e) {}
}

function addMessage(role, content) {
    chatHistory.push({ role, content }); addMessageToUI(role, content);
    if (role === 'model') autoSaveFiles(content);
    if (role !== 'system') saveCurrentChat();
}
function addMessageToUI(role, content) {
    const div = document.createElement('div');
    if (role === 'user') {
        div.className = 'flex items-end justify-end space-x-2 space-x-reverse mb-4 animate-fade-in-up';
        div.innerHTML = \`<div class="bg-blue-600 text-white rounded-2xl rounded-br-none p-3 md:p-4 max-w-[85%] shadow-md">\${content}</div><div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-user text-white text-xs"></i></div>\`;
    } else if (role === 'system') {
        div.className = 'flex items-start justify-start space-x-3 mb-4 animate-fade-in-up';
        div.innerHTML = \`<div class="w-8 h-8 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50 shrink-0"><i class="fa-solid fa-info text-yellow-500 text-xs"></i></div><div class="bg-yellow-900/10 border border-yellow-600/20 text-yellow-200 rounded-2xl p-3 max-w-[85%] text-sm">\${content}</div>\`;
    } else {
        div.className = 'flex items-start justify-start space-x-3 mb-4 animate-fade-in-up';
        const bubble = document.createElement('div'); bubble.className = 'glass text-gray-100 shadow-xl rounded-tl-none rounded-2xl p-3 md:p-4 max-w-[85%] overflow-x-auto text-sm md:text-base';
        bubble.innerHTML = marked.parse(content); bubble.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
        div.innerHTML = \`<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0"><i class="fa-solid fa-robot text-white text-xs"></i></div>\`;
        div.appendChild(bubble);
    }
    chatContainer.appendChild(div); scrollToBottom();
}
function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }
sendBtn.addEventListener('click', sendMessage);
promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
async function sendMessage() {
    const msg = promptInput.value.trim(); if (!msg) return; addMessage('user', msg); promptInput.value = '';
    const loader = document.createElement('div'); loader.id = 'loading-msg'; loader.className = 'flex items-start space-x-3 opacity-70 mb-4 animate-pulse'; loader.innerHTML = \`<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0"><i class="fa-solid fa-robot text-white text-xs"></i></div><div class="glass rounded-2xl rounded-tl-none p-3 text-sm"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Thinking...</div>\`; chatContainer.appendChild(loader); scrollToBottom();
    try {
        const context = Array.from(selectedFiles.entries()).map(([path, content]) => ({ path, content }));
        const res = await fetch('/api/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ message: msg, contextFiles: context, repo: currentRepo, fileTree: currentRepoFiles.map(f=>f.path) }) });
        chatContainer.removeChild(loader);
        const data = await res.json();
        if (!res.ok) addMessage('system', \`Error: \${data.error || 'Unknown'}\`); else addMessage('model', data.result || "No response");
    } catch (e) { if(document.getElementById('loading-msg')) chatContainer.removeChild(loader); addMessage('system', \`Network Error: \${e.message}\`); }
}

// Init
(async () => {
    await loadConfig();
    const lastRepo = localStorage.getItem('lastRepo');
    if (lastRepo) { try { const { owner, repo } = JSON.parse(lastRepo); if (owner && repo) { currentRepo = { owner, repo }; repoInput.value = \`\${owner}/\${repo}\`; await loadRepository(owner, repo); } } catch (e) {} }
    const lastSessionId = localStorage.getItem('lastSessionId'); if (lastSessionId) { await loadChatSession(lastSessionId); }
})();`;

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, { 'Content-Type': 'application/javascript' }));

export default app;
