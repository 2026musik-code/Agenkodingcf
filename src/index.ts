import { Hono } from 'hono';
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

// --- Chat History Endpoints ---

app.get('/api/history/list', async (c) => {
    try {
        // List objects with prefix 'chats/'
        const list = await c.env.vpsai.list({ prefix: 'chats/' });
        const chats = [];
        for (const obj of list.objects) {
            // Fetch content to get title/preview (optional, but good for UI)
            // For now, just return ID and timestamp from metadata or filename
            const id = obj.key.replace('chats/', '').replace('.json', '');
            chats.push({
                id,
                updated_at: obj.uploaded
            });
        }
        // Sort by updated_at desc
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

const getGithubHeaders = (token: string) => ({
    'User-Agent': 'Cloudflare-Worker-Agent',
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`
});

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

// Get Tree (Modified to handle empty repos)
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
        // FIX: Handle 409 (Conflict) which often means the repo is empty or branch missing
        if (response.status === 409 || response.status === 404) {
             // Return empty tree for empty repos so user can create files
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
    const { message, contextFiles, repo, fileTree } = await c.req.json();
    const config: any = await getConfig(c.env);
    const proxyUrl = config.proxyUrl;

    let prompt = "You are an expert AI Coding Agent. Analyze the following code context and answer the user's request.\n\n";

    if (repo && repo.owner && repo.repo) {
        prompt += `Current Repository: ${repo.owner}/${repo.repo}\n`;
    }

    if (fileTree && Array.isArray(fileTree) && fileTree.length > 0) {
        prompt += "--- REPOSITORY STRUCTURE ---\n";
        const treeStr = fileTree.join('\n');
        if (treeStr.length > 2000) {
            prompt += treeStr.substring(0, 2000) + "\n...(truncated)...";
        } else {
            prompt += treeStr;
        }
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


// --- Frontend Serving ---

const htmlContent = "<!DOCTYPE html>\n<html lang=\"en\" class=\"dark\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">\n    <title>AI Agent Coding</title>\n    <script src=\"https://cdn.tailwindcss.com\"></script>\n    <link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css\">\n    <link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css\">\n    <script src=\"https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js\"></script>\n    <script src=\"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js\"></script>\n    <style>\n        /* Custom scrollbar */\n        ::-webkit-scrollbar { width: 4px; height: 4px; }\n        ::-webkit-scrollbar-track { background: transparent; }\n        ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }\n        ::-webkit-scrollbar-thumb:hover { background: #6b7280; }\n        .glass {\n            background: rgba(31, 41, 55, 0.7);\n            backdrop-filter: blur(10px);\n            -webkit-backdrop-filter: blur(10px);\n            border: 1px solid rgba(255, 255, 255, 0.05);\n        }\n        /* Mobile Specifics */\n        .mobile-safe-bottom { padding-bottom: env(safe-area-inset-bottom); }\n        .mobile-safe-top { padding-top: env(safe-area-inset-top); }\n        .page-transition { transition: transform 0.3s ease-in-out; }\n    </style>\n    <script>\n        tailwind.config = {\n            darkMode: 'class',\n            theme: {\n                extend: {\n                    colors: {\n                        primary: '#3b82f6',\n                        secondary: '#10b981',\n                        dark: '#0f172a',\n                        darker: '#020617',\n                    }\n                }\n            }\n        }\n    </script>\n</head>\n<body class=\"bg-darker text-gray-200 font-sans h-[100dvh] flex flex-col md:flex-row overflow-hidden select-none touch-manipulation\">\n\n    <!-- Mobile Header -->\n    <header class=\"md:hidden flex items-center justify-between p-4 glass border-b border-gray-800 z-50 mobile-safe-top shrink-0\">\n        <button id=\"mobileMenuBtn\" class=\"text-gray-300 hover:text-white p-2\">\n            <i class=\"fa-solid fa-bars text-xl\"></i>\n        </button>\n        <h1 class=\"text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400\">\n            AI Agent\n        </h1>\n        <button id=\"mobileSettingsBtn\" class=\"text-gray-300 hover:text-white p-2\">\n            <i class=\"fa-solid fa-gear text-xl\"></i>\n        </button>\n    </header>\n\n    <!-- Sidebar (Desktop & Mobile Drawer) -->\n    <aside id=\"sidebar\" class=\"fixed inset-y-0 left-0 w-80 bg-dark/95 backdrop-blur-xl border-r border-gray-800 flex flex-col z-40 transform -translate-x-full md:translate-x-0 transition-transform duration-300 md:static md:bg-dark md:glass\">\n        \n        <!-- Desktop Header -->\n        <div class=\"hidden md:flex p-4 border-b border-gray-800 justify-between items-center\">\n            <h1 class=\"text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400\">\n                <i class=\"fa-solid fa-robot mr-2\"></i>AI Agent\n            </h1>\n            <button id=\"desktopSettingsBtn\" class=\"text-gray-400 hover:text-white transition\">\n                <i class=\"fa-solid fa-gear\"></i>\n            </button>\n        </div>\n\n        <!-- Mobile Close Button -->\n        <div class=\"md:hidden p-4 flex justify-end mobile-safe-top\">\n            <button id=\"closeSidebarBtn\" class=\"text-gray-400 p-2\">\n                <i class=\"fa-solid fa-xmark text-xl\"></i>\n            </button>\n        </div>\n\n        <!-- Tab Navigation -->\n        <div class=\"flex border-b border-gray-800 bg-gray-900/20\">\n            <button id=\"tabRepoBtn\" class=\"flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium transition\">\n                <i class=\"fa-brands fa-github mr-2\"></i>Repo\n            </button>\n            <button id=\"tabHistoryBtn\" class=\"flex-1 py-3 text-sm text-gray-400 hover:text-white transition\">\n                <i class=\"fa-solid fa-clock-rotate-left mr-2\"></i>History\n            </button>\n        </div>\n\n        <!-- Repo Tab Content -->\n        <div id=\"tabRepoContent\" class=\"flex-1 flex flex-col h-full overflow-hidden\">\n            <!-- Repo Management -->\n            <div class=\"p-4 space-y-3 shrink-0\">\n                <!-- Connection Mode Tabs -->\n                <div class=\"flex space-x-2 bg-gray-900/50 p-1 rounded-lg\">\n                    <button id=\"modeManualBtn\" class=\"flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition\">Manual</button>\n                    <button id=\"modeListBtn\" class=\"flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition\">My Repos</button>\n                </div>\n\n                <!-- Manual Input -->\n                <div id=\"manualRepoInputGroup\" class=\"flex space-x-2\">\n                    <input type=\"text\" id=\"repoInput\" placeholder=\"owner/repo\" class=\"w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition\">\n                    <button id=\"loadRepoBtn\" class=\"bg-primary hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm transition shadow-lg\">\n                        <i class=\"fa-solid fa-download\"></i>\n                    </button>\n                </div>\n\n                <!-- Repo List Dropdown (Hidden initially) -->\n                <div id=\"repoListGroup\" class=\"hidden space-y-2\">\n                    <select id=\"repoSelect\" class=\"w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition\">\n                        <option value=\"\">Select a repository...</option>\n                    </select>\n                    <div class=\"flex space-x-2\">\n                        <button id=\"refreshReposBtn\" class=\"flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-2 rounded-lg text-xs transition\">\n                            <i class=\"fa-solid fa-sync\"></i> Refresh\n                        </button>\n                        <button id=\"createRepoBtn\" class=\"flex-1 bg-green-600 hover:bg-green-500 text-white px-2 py-2 rounded-lg text-xs transition\">\n                            <i class=\"fa-solid fa-plus\"></i> New\n                        </button>\n                    </div>\n                </div>\n            </div>\n\n            <!-- File Tree -->\n            <div class=\"flex-1 overflow-y-auto p-2 scrollbar-thin\" id=\"fileTree\">\n                <div class=\"flex flex-col items-center justify-center h-full text-gray-500 text-sm space-y-2\">\n                    <i class=\"fa-brands fa-github text-4xl opacity-20\"></i>\n                    <p>Load a repo to start</p>\n                </div>\n            </div>\n        </div>\n\n        <!-- History Tab Content (Hidden) -->\n        <div id=\"tabHistoryContent\" class=\"hidden flex-1 flex-col h-full overflow-hidden\">\n             <div class=\"p-4 shrink-0\">\n                <button id=\"newChatBtn\" class=\"w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm shadow-md transition flex items-center justify-center\">\n                    <i class=\"fa-solid fa-plus mr-2\"></i> New Chat\n                </button>\n             </div>\n             <div id=\"historyList\" class=\"flex-1 overflow-y-auto p-2 scrollbar-thin space-y-1\">\n                 <!-- History items will go here -->\n             </div>\n        </div>\n\n        <!-- Context Summary -->\n        <div class=\"p-4 border-t border-gray-800 bg-gray-900/30 text-xs text-gray-400 flex justify-between items-center mobile-safe-bottom\">\n            <span>Selected: <span id=\"selectedCount\" class=\"text-white font-bold\">0</span></span>\n            <button id=\"clearContextBtn\" class=\"text-red-400 hover:text-red-300 transition px-2 py-1 rounded hover:bg-red-500/10\">Clear All</button>\n        </div>\n    </aside>\n\n    <!-- Overlay for Mobile Sidebar -->\n    <div id=\"sidebarOverlay\" class=\"fixed inset-0 bg-black/60 backdrop-blur-sm z-30 hidden md:hidden transition-opacity opacity-0\"></div>\n\n    <!-- Main Content Area -->\n    <main class=\"flex-1 flex flex-col relative bg-darker w-full h-full overflow-hidden\">\n        \n        <!-- File Actions Toolbar (Hidden unless file selected) -->\n        <div id=\"fileToolbar\" class=\"hidden absolute top-4 right-4 z-20 flex space-x-2\">\n            <button id=\"saveFileBtn\" class=\"bg-blue-600/90 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs shadow-lg backdrop-blur-sm flex items-center transition\">\n                <i class=\"fa-solid fa-floppy-disk mr-2\"></i> Save Changes\n            </button>\n        </div>\n\n        <!-- Chat History -->\n        <div id=\"chatContainer\" class=\"flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth\">\n            <!-- Welcome Message -->\n            <div class=\"flex items-start space-x-3 md:space-x-4 animate-fade-in-up\">\n                <div class=\"w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0\">\n                    <i class=\"fa-solid fa-robot text-white text-sm md:text-base\"></i>\n                </div>\n                <div class=\"glass rounded-2xl rounded-tl-none p-3 md:p-4 max-w-[85%] md:max-w-3xl shadow-xl text-sm md:text-base\">\n                    <p>Hello! I am your AI Coding Agent. <br>Login in Settings to manage your GitHub repositories.</p>\n                </div>\n            </div>\n        </div>\n\n        <!-- Input Area (Static at bottom) -->\n        <div class=\"w-full p-2 md:p-6 bg-darker mobile-safe-bottom z-20 shrink-0 border-t border-gray-800/50\">\n            <div class=\"max-w-4xl mx-auto relative glass rounded-2xl shadow-2xl border border-gray-700/50 backdrop-blur-md\">\n                <textarea id=\"promptInput\" rows=\"1\" placeholder=\"Ask AI to generate code...\" class=\"w-full bg-transparent border-none text-white p-3 md:p-4 focus:ring-0 resize-none placeholder-gray-500 text-sm md:text-base max-h-32 overflow-y-auto leading-relaxed\"></textarea>\n                <div class=\"flex justify-between items-center px-3 pb-2 md:px-4 md:pb-3 border-t border-gray-700/30 pt-2\">\n                    <div class=\"text-[10px] md:text-xs text-gray-500 flex items-center\">\n                        <i class=\"fa-brands fa-markdown mr-1\"></i> <span class=\"hidden md:inline\">Markdown supported</span>\n                    </div>\n                    <button id=\"sendBtn\" class=\"bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white px-4 py-1.5 md:px-6 md:py-2 rounded-xl font-semibold shadow-lg shadow-blue-500/20 transition transform active:scale-95 flex items-center text-sm md:text-base\">\n                        <span>Send</span> <i class=\"fa-solid fa-paper-plane ml-2\"></i>\n                    </button>\n                </div>\n            </div>\n        </div>\n    </main>\n\n    <!-- Settings Modal -->\n    <div id=\"settingsModal\" class=\"fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] hidden flex items-center justify-center p-4\">\n        <div class=\"bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl transform transition-all scale-95 opacity-0\" id=\"settingsContent\">\n            <div class=\"flex justify-between items-center mb-6\">\n                <h2 class=\"text-xl font-bold text-white\">Settings</h2>\n                <button id=\"closeSettingsBtn\" class=\"text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800 transition\">\n                    <i class=\"fa-solid fa-xmark text-lg\"></i>\n                </button>\n            </div>\n            \n            <div class=\"space-y-5\">\n                <div>\n                    <label class=\"block text-sm font-medium text-gray-400 mb-1.5\">GitHub Username</label>\n                    <input type=\"text\" id=\"githubUsernameInput\" class=\"w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition\" placeholder=\"e.g. ferdev\">\n                </div>\n                <div>\n                    <label class=\"block text-sm font-medium text-gray-400 mb-1.5\">GitHub Token</label>\n                    <input type=\"password\" id=\"githubTokenInput\" class=\"w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition\" placeholder=\"ghp_...\">\n                    <p class=\"text-xs text-gray-600 mt-1.5\">Required for accessing private repos and writing changes.</p>\n                </div>\n                <div>\n                    <label class=\"block text-sm font-medium text-gray-400 mb-1.5\">Custom Proxy URL</label>\n                    <input type=\"text\" id=\"proxyUrlInput\" class=\"w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition\" placeholder=\"Optional\">\n                </div>\n            </div>\n\n            <div class=\"mt-8 flex justify-end\">\n                <button id=\"saveSettingsBtn\" class=\"w-full md:w-auto bg-primary hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg transition shadow-lg font-medium\">\n                    Save Configuration\n                </button>\n            </div>\n        </div>\n    </div>\n\n    <!-- Create Repo Modal -->\n    <div id=\"createRepoModal\" class=\"fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] hidden flex items-center justify-center p-4\">\n        <div class=\"bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl\">\n            <h2 class=\"text-xl font-bold text-white mb-4\">Create Repository</h2>\n            <div class=\"space-y-4\">\n                <input type=\"text\" id=\"newRepoName\" placeholder=\"Repository Name\" class=\"w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white\">\n                <input type=\"text\" id=\"newRepoDesc\" placeholder=\"Description\" class=\"w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white\">\n                <div class=\"flex items-center\">\n                    <input type=\"checkbox\" id=\"newRepoPrivate\" class=\"mr-2\">\n                    <label for=\"newRepoPrivate\" class=\"text-gray-300 text-sm\">Private Repository</label>\n                </div>\n            </div>\n            <div class=\"mt-6 flex justify-end space-x-3\">\n                <button id=\"cancelCreateRepoBtn\" class=\"text-gray-400 hover:text-white px-4 py-2\">Cancel</button>\n                <button id=\"confirmCreateRepoBtn\" class=\"bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg\">Create</button>\n            </div>\n        </div>\n    </div>\n\n    <script src=\"/ui.js\"></script>\n</body>\n</html>\n";
const jsContent = "// State\nlet selectedFiles = new Map();\nlet currentRepo = { owner: '', repo: '' };\nlet currentRepoFiles = [];\nlet currentFile = { path: '', sha: '' };\nlet currentSessionId = Date.now().toString();\n    localStorage.setItem('lastSessionId', currentSessionId); // Simple ID generation\nlet chatHistory = []; // Local mirror of messages\n\n// DOM Elements\nconst settingsModal = document.getElementById('settingsModal');\nconst settingsContent = document.getElementById('settingsContent');\nconst settingsBtn = document.getElementById('settingsBtn');\nconst mobileSettingsBtn = document.getElementById('mobileSettingsBtn');\nconst desktopSettingsBtn = document.getElementById('desktopSettingsBtn');\nconst closeSettingsBtn = document.getElementById('closeSettingsBtn');\nconst saveSettingsBtn = document.getElementById('saveSettingsBtn');\nconst githubUsernameInput = document.getElementById('githubUsernameInput');\nconst githubTokenInput = document.getElementById('githubTokenInput');\nconst proxyUrlInput = document.getElementById('proxyUrlInput');\n\nconst repoInput = document.getElementById('repoInput');\nconst loadRepoBtn = document.getElementById('loadRepoBtn');\nconst fileTree = document.getElementById('fileTree');\nconst selectedCount = document.getElementById('selectedCount');\nconst clearContextBtn = document.getElementById('clearContextBtn');\n\nconst chatContainer = document.getElementById('chatContainer');\nconst promptInput = document.getElementById('promptInput');\nconst sendBtn = document.getElementById('sendBtn');\n\nconst mobileMenuBtn = document.getElementById('mobileMenuBtn');\nconst closeSidebarBtn = document.getElementById('closeSidebarBtn');\nconst sidebar = document.getElementById('sidebar');\nconst sidebarOverlay = document.getElementById('sidebarOverlay');\n\nconst modeManualBtn = document.getElementById('modeManualBtn');\nconst modeListBtn = document.getElementById('modeListBtn');\nconst manualRepoInputGroup = document.getElementById('manualRepoInputGroup');\nconst repoListGroup = document.getElementById('repoListGroup');\nconst repoSelect = document.getElementById('repoSelect');\nconst refreshReposBtn = document.getElementById('refreshReposBtn');\nconst createRepoBtn = document.getElementById('createRepoBtn');\nconst createRepoModal = document.getElementById('createRepoModal');\nconst confirmCreateRepoBtn = document.getElementById('confirmCreateRepoBtn');\nconst cancelCreateRepoBtn = document.getElementById('cancelCreateRepoBtn');\nconst newRepoName = document.getElementById('newRepoName');\nconst newRepoDesc = document.getElementById('newRepoDesc');\nconst newRepoPrivate = document.getElementById('newRepoPrivate');\nconst fileToolbar = document.getElementById('fileToolbar');\nconst saveFileBtn = document.getElementById('saveFileBtn');\n\n// Tabs\nconst tabRepoBtn = document.getElementById('tabRepoBtn');\nconst tabHistoryBtn = document.getElementById('tabHistoryBtn');\nconst tabRepoContent = document.getElementById('tabRepoContent');\nconst tabHistoryContent = document.getElementById('tabHistoryContent');\nconst historyList = document.getElementById('historyList');\nconst newChatBtn = document.getElementById('newChatBtn');\n\n// --- Markdown Renderer with \"Save to Repo\" Button ---\nconst renderer = new marked.Renderer();\nconst originalCodeRenderer = renderer.code;\n\nrenderer.code = function(code, language) {\n    // Generate a unique ID for this block\n    const blockId = 'code-' + Math.random().toString(36).substr(2, 9);\n    \n    // Highlight code\n    let highlighted = code;\n    if (language && hljs.getLanguage(language)) {\n        highlighted = hljs.highlight(code, { language: language }).value;\n    } else {\n        highlighted = hljs.highlightAuto(code).value;\n    }\n\n    // Return the HTML with a relative wrapper and a button\n    return `\n        <div class=\"relative group my-4\">\n            <div class=\"absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition duration-200 z-10 flex space-x-2\">\n                 <button onclick=\"copyCode('${blockId}')\" class=\"bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded shadow-md border border-gray-600 flex items-center\" title=\"Copy to Clipboard\">\n                    <i class=\"fa-regular fa-copy mr-1\"></i> Copy\n                </button>\n                <button onclick=\"saveCodeToRepo('${blockId}')\" class=\"bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-md border border-blue-500 flex items-center\" title=\"Save to Repository\">\n                    <i class=\"fa-brands fa-github mr-1\"></i> Save\n                </button>\n            </div>\n            <pre><code id=\"${blockId}\" class=\"hljs language-${language || 'plaintext'} p-4 rounded-lg block overflow-x-auto text-sm bg-[#282c34]\">${highlighted}</code></pre>\n            <textarea id=\"${blockId}-raw\" class=\"hidden\">${code}</textarea>\n        </div>\n    `;\n};\n\nmarked.use({ renderer });\n\n// Global functions for code block buttons\nwindow.copyCode = function(id) {\n    const raw = document.getElementById(id + '-raw').value;\n    navigator.clipboard.writeText(raw).then(() => {\n        addMessage('system', 'Code copied to clipboard!');\n    });\n};\n\nwindow.saveCodeToRepo = async function(id) {\n    const raw = document.getElementById(id + '-raw').value;\n    const filename = prompt(\"Enter the path to save this file in your repository (e.g., src/index.js):\");\n    \n    if (!filename) return;\n\n    if (!currentRepo.owner || !currentRepo.repo) {\n        alert(\"Please select a repository first!\");\n        return;\n    }\n\n    try {\n        const res = await fetch('/api/github/file', {\n            method: 'PUT',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({\n                owner: currentRepo.owner,\n                repo: currentRepo.repo,\n                path: filename,\n                content: raw,\n                message: `Create/Update ${filename} from AI Chat`\n            })\n        });\n\n        if (!res.ok) throw new Error((await res.json()).error);\n        \n        addMessage('system', `Successfully saved <b>${filename}</b> to ${currentRepo.owner}/${currentRepo.repo}`);\n        // Optionally refresh file tree if needed\n        loadRepository(currentRepo.owner, currentRepo.repo);\n\n    } catch (e) {\n        alert(`Error saving file: ${e.message}`);\n    }\n};\n\n// --- Mobile Sidebar ---\nfunction toggleSidebar(show) {\n    if (show) {\n        sidebar.classList.remove('-translate-x-full');\n        sidebarOverlay.classList.remove('hidden');\n        setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10);\n        // Refresh history when opening sidebar if needed\n        if (!tabHistoryContent.classList.contains('hidden')) {\n            loadHistoryList();\n        }\n    } else {\n        sidebar.classList.add('-translate-x-full');\n        sidebarOverlay.classList.add('opacity-0');\n        setTimeout(() => sidebarOverlay.classList.add('hidden'), 300);\n    }\n}\nmobileMenuBtn?.addEventListener('click', () => toggleSidebar(true));\ncloseSidebarBtn?.addEventListener('click', () => toggleSidebar(false));\nsidebarOverlay?.addEventListener('click', () => toggleSidebar(false));\n\n// --- Tabs Logic ---\ntabRepoBtn.addEventListener('click', () => {\n    tabRepoBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium transition';\n    tabHistoryBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white transition';\n    tabRepoContent.classList.remove('hidden');\n    tabHistoryContent.classList.add('hidden');\n});\n\ntabHistoryBtn.addEventListener('click', () => {\n    tabHistoryBtn.className = 'flex-1 py-3 text-sm text-blue-400 border-b-2 border-blue-500 font-medium transition';\n    tabRepoBtn.className = 'flex-1 py-3 text-sm text-gray-400 hover:text-white transition';\n    tabHistoryContent.classList.remove('hidden');\n    tabRepoContent.classList.add('hidden');\n    loadHistoryList();\n});\n\n// --- History Logic ---\n\nasync function loadHistoryList() {\n    historyList.innerHTML = '<div class=\"text-center text-gray-500 mt-4 text-xs\"><i class=\"fa-solid fa-spinner fa-spin\"></i> Loading...</div>';\n    try {\n        const res = await fetch('/api/history/list');\n        const data = await res.json();\n        \n        historyList.innerHTML = '';\n        if (!data.chats || data.chats.length === 0) {\n            historyList.innerHTML = '<div class=\"text-center text-gray-500 mt-4 text-xs\">No history found.</div>';\n            return;\n        }\n\n        data.chats.forEach(chat => {\n            const btn = document.createElement('button');\n            const date = new Date(chat.updated_at).toLocaleDateString();\n            // Highlight current\n            const isCurrent = chat.id === currentSessionId;\n            const bgClass = isCurrent ? 'bg-blue-600/20 border-l-2 border-blue-500 text-blue-200' : 'hover:bg-gray-800/50 text-gray-300';\n            \n            btn.className = `w-full text-left px-3 py-2.5 rounded-lg text-xs transition mb-1 ${bgClass} truncate flex justify-between group`;\n            btn.innerHTML = `\n                <span class=\"truncate flex-1\">Chat ${chat.id.substring(0, 8)}...</span>\n                <span class=\"text-gray-600 text-[10px] ml-2\">${date}</span>\n                <i class=\"fa-solid fa-trash text-gray-600 hover:text-red-400 ml-2 opacity-0 group-hover:opacity-100 transition\" onclick=\"deleteChat(event, '${chat.id}')\"></i>\n            `;\n            btn.onclick = (e) => {\n                 // Prevent triggering if trash clicked (handled by event bubbling check or separate handler, \n                 // but innerHTML onclick is easier here given constraints)\n                 if (e.target.classList.contains('fa-trash')) return;\n                 loadChatSession(chat.id);\n            };\n            historyList.appendChild(btn);\n        });\n\n    } catch (e) {\n        historyList.innerHTML = `<div class=\"text-center text-red-400 mt-4 text-xs\">Error loading history</div>`;\n    }\n}\n\n// Ensure these functions are globally available for inline onclick handlers\nwindow.loadChatSession = async function(id) {\n    chatContainer.innerHTML = ''; // Clear UI\n    chatHistory = []; // Clear local state\n    currentSessionId = id;\n    localStorage.setItem('lastSessionId', id);\n    \n    // Add loading indicator\n    const loader = document.createElement('div');\n    loader.className = 'text-center text-gray-500 mt-10';\n    loader.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin\"></i> Loading chat...';\n    chatContainer.appendChild(loader);\n\n    try {\n        const res = await fetch(`/api/history/${id}`);\n        if (!res.ok) throw new Error('Failed to load');\n        const data = await res.json();\n        \n        chatContainer.removeChild(loader);\n        \n        if (data.messages && Array.isArray(data.messages)) {\n            chatHistory = data.messages;\n            chatHistory.forEach(msg => addMessageToUI(msg.role, msg.content));\n        } else {\n             addMessage('system', 'Chat history empty or invalid.');\n        }\n        \n        // On mobile, close sidebar\n        if (window.innerWidth < 768) toggleSidebar(false);\n\n    } catch (e) {\n        chatContainer.innerHTML = ''; \n        addMessage('system', `Error loading chat: ${e.message}`);\n    }\n}\n\nwindow.deleteChat = async function(e, id) {\n    e.stopPropagation();\n    if (!confirm('Delete this chat?')) return;\n    \n    try {\n        await fetch(`/api/history/${id}`, { method: 'DELETE' });\n        loadHistoryList(); // Refresh list\n        if (id === currentSessionId) {\n            startNewChat();\n        }\n    } catch (e) {\n        alert('Failed to delete');\n    }\n};\n\nfunction startNewChat() {\n    currentSessionId = Date.now().toString();\n    localStorage.setItem('lastSessionId', currentSessionId);\n    chatHistory = [];\n    chatContainer.innerHTML = '';\n    \n    // Add Welcome Message\n    const welcomeHTML = `\n            <div class=\"flex items-start space-x-3 md:space-x-4 animate-fade-in-up\">\n                <div class=\"w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0\">\n                    <i class=\"fa-solid fa-robot text-white text-sm md:text-base\"></i>\n                </div>\n                <div class=\"glass rounded-2xl rounded-tl-none p-3 md:p-4 max-w-[85%] md:max-w-3xl shadow-xl text-sm md:text-base\">\n                    <p>Hello! I am your AI Coding Agent. <br>Login in Settings to manage your GitHub repositories.</p>\n                </div>\n            </div>`;\n    chatContainer.innerHTML = welcomeHTML;\n    \n    if (window.innerWidth < 768) toggleSidebar(false);\n}\n\nnewChatBtn.addEventListener('click', startNewChat);\n\nasync function saveCurrentChat() {\n    if (chatHistory.length === 0) return;\n    try {\n        await fetch(`/api/history/${currentSessionId}`, {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ messages: chatHistory, updated_at: new Date().toISOString() })\n        });\n    } catch (e) {\n        console.error('Auto-save failed', e);\n    }\n}\n\n\n// --- Settings ---\nfunction toggleSettings(show) {\n    if (show) {\n        settingsModal.classList.remove('hidden');\n        setTimeout(() => {\n            settingsContent.classList.remove('scale-95', 'opacity-0');\n            settingsContent.classList.add('scale-100', 'opacity-100');\n        }, 10);\n    } else {\n        settingsContent.classList.remove('scale-100', 'opacity-100');\n        settingsContent.classList.add('scale-95', 'opacity-0');\n        setTimeout(() => {\n            settingsModal.classList.add('hidden');\n        }, 300);\n    }\n}\nsettingsBtn?.addEventListener('click', () => toggleSettings(true));\ndesktopSettingsBtn?.addEventListener('click', () => toggleSettings(true));\nmobileSettingsBtn?.addEventListener('click', () => toggleSettings(true));\ncloseSettingsBtn?.addEventListener('click', () => toggleSettings(false));\n\nasync function loadConfig() {\n    try {\n        const res = await fetch('/api/config');\n        const data = await res.json();\n        if (data.githubUsername) githubUsernameInput.value = data.githubUsername;\n        if (data.githubToken) githubTokenInput.value = data.githubToken;\n        if (data.proxyUrl) proxyUrlInput.value = data.proxyUrl;\n    } catch (e) {\n        console.error('Failed to load config', e);\n    }\n}\n\nsaveSettingsBtn.addEventListener('click', async () => {\n    const githubUsername = githubUsernameInput.value;\n    const githubToken = githubTokenInput.value;\n    const proxyUrl = proxyUrlInput.value;\n    \n    const originalText = saveSettingsBtn.textContent;\n    saveSettingsBtn.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin\"></i> Saving...';\n    saveSettingsBtn.disabled = true;\n\n    try {\n        await fetch('/api/config', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ githubUsername, githubToken, proxyUrl })\n        });\n        toggleSettings(false);\n        addMessage('system', 'Configuration saved successfully.');\n        if (!modeListBtn.className.includes('text-gray-400')) {\n            fetchMyRepos();\n        }\n    } catch (e) {\n        alert('Failed to save configuration');\n    } finally {\n        saveSettingsBtn.textContent = originalText;\n        saveSettingsBtn.disabled = false;\n    }\n});\n\n// --- GitHub Logic ---\nmodeManualBtn.addEventListener('click', () => {\n    modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition';\n    modeListBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition';\n    manualRepoInputGroup.classList.remove('hidden');\n    repoListGroup.classList.add('hidden');\n});\n\nmodeListBtn.addEventListener('click', () => {\n    modeListBtn.className = 'flex-1 py-1 text-xs rounded-md bg-gray-700 text-white shadow-sm transition';\n    modeManualBtn.className = 'flex-1 py-1 text-xs rounded-md text-gray-400 hover:text-white transition';\n    manualRepoInputGroup.classList.add('hidden');\n    repoListGroup.classList.remove('hidden');\n    fetchMyRepos();\n});\n\nasync function fetchMyRepos() {\n    repoSelect.innerHTML = '<option>Loading...</option>';\n    try {\n        const res = await fetch('/api/github/list');\n        if (!res.ok) throw new Error('Failed to fetch repos');\n        const data = await res.json();\n        \n        repoSelect.innerHTML = '<option value=\"\">Select a repository...</option>';\n        data.repos.forEach(repo => {\n            const opt = document.createElement('option');\n            opt.value = repo.full_name;\n            opt.textContent = `${repo.full_name} ${repo.private ? '(\ud83d\udd12)' : ''}`;\n            repoSelect.appendChild(opt);\n        });\n    } catch (e) {\n        repoSelect.innerHTML = `<option>Error: ${e.message}</option>`;\n    }\n}\n\nrefreshReposBtn.addEventListener('click', fetchMyRepos);\n\nrepoSelect.addEventListener('change', () => {\n    const val = repoSelect.value;\n    if (val) {\n        const [owner, repo] = val.split('/');\n        currentRepo = { owner, repo };\n        localStorage.setItem('lastRepo', JSON.stringify(currentRepo));\n        loadRepository(owner, repo);\n    }\n});\n\nloadRepoBtn.addEventListener('click', () => {\n    const input = repoInput.value.trim();\n    if (!input) return;\n    const [owner, repo] = input.split('/');\n    if (!owner || !repo) {\n        alert('Invalid format');\n        return;\n    }\n    loadRepository(owner, repo);\n});\n\nasync function loadRepository(owner, repo) {\n    fileTree.innerHTML = '<div class=\"flex h-full items-center justify-center text-gray-400\"><i class=\"fa-solid fa-circle-notch fa-spin text-2xl mr-3\"></i> Loading...</div>';\n\n    try {\n        const res = await fetch('/api/github/tree', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ owner, repo })\n        });\n        \n        if (!res.ok) throw new Error((await res.json()).error);\n        \n        const data = await res.json();\n        currentRepo = { owner, repo };\n        localStorage.setItem('lastRepo', JSON.stringify(currentRepo));\n        currentRepoFiles = data.tree || [];\n        renderFileTree(data.tree);\n        addMessage('system', `Loaded repository: ${owner}/${repo}`);\n        if (window.innerWidth < 768) toggleSidebar(false);\n\n    } catch (e) {\n        fileTree.innerHTML = `<div class=\"p-4 text-red-400 text-center text-sm\">Error: ${e.message}</div>`;\n    }\n}\n\nfunction renderFileTree(tree) {\n    fileTree.innerHTML = '';\n    if (!tree || tree.length === 0) {\n        fileTree.innerHTML = '<div class=\"text-center text-gray-500 mt-4 text-sm\">Empty repository.</div>';\n        return;\n    }\n    const sorted = tree.sort((a, b) => {\n        if (a.type === b.type) return a.path.localeCompare(b.path);\n        return a.type === 'tree' ? -1 : 1;\n    });\n\n    const list = document.createElement('ul');\n    list.className = 'space-y-1 text-sm p-2';\n    \n    sorted.forEach(item => {\n        const li = document.createElement('li');\n        li.className = 'cursor-pointer hover:bg-gray-800/50 rounded-lg px-3 py-2 truncate transition flex items-center select-none active:bg-gray-700';\n        \n        const icon = item.type === 'tree' ? '<i class=\"fa-regular fa-folder text-blue-400 mr-2.5\"></i>' : '<i class=\"fa-regular fa-file text-gray-400 mr-2.5\"></i>';\n        li.innerHTML = `${icon}<span class=\"truncate\">${item.path}</span>`;\n        \n        if (item.type === 'blob') {\n            li.addEventListener('click', () => selectFile(item.path, li));\n        }\n        \n        list.appendChild(li);\n    });\n    fileTree.appendChild(list);\n}\n\nasync function selectFile(path, element) {\n    const allLis = fileTree.querySelectorAll('li');\n    allLis.forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500'));\n    element.classList.add('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500');\n    \n    try {\n        const res = await fetch('/api/github/file', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ owner: currentRepo.owner, repo: currentRepo.repo, path })\n        });\n        if (!res.ok) throw new Error('Failed to fetch file');\n        const data = await res.json();\n        \n        selectedFiles.set(path, data.content);\n        currentFile = { path, sha: data.sha };\n        updateContextCount();\n        fileToolbar.classList.remove('hidden');\n        addMessage('system', `Selected: ${path}`);\n\n    } catch (e) {\n        alert(e.message);\n    }\n}\n\nfunction updateContextCount() {\n    selectedCount.textContent = selectedFiles.size;\n}\n\nclearContextBtn.addEventListener('click', () => {\n    selectedFiles.clear();\n    currentFile = { path: '', sha: '' };\n    fileToolbar.classList.add('hidden');\n    updateContextCount();\n    const lis = fileTree.querySelectorAll('li');\n    lis.forEach(li => li.classList.remove('bg-blue-600/20', 'text-blue-200', 'border-l-2', 'border-blue-500'));\n});\n\nsaveFileBtn.addEventListener('click', async () => {\n    if (!currentFile.path) return;\n    const content = prompt(\"Confirm content to save:\", selectedFiles.get(currentFile.path));\n    if (content === null) return;\n\n    saveFileBtn.innerHTML = '<i class=\"fa-solid fa-spinner fa-spin\"></i> Saving...';\n    try {\n        const res = await fetch('/api/github/file', {\n            method: 'PUT',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({\n                owner: currentRepo.owner,\n                repo: currentRepo.repo,\n                path: currentFile.path,\n                content: content,\n                sha: currentFile.sha,\n                message: `Update ${currentFile.path} via AI Agent`\n            })\n        });\n        \n        if (!res.ok) throw new Error((await res.json()).error);\n        \n        const data = await res.json();\n        selectedFiles.set(currentFile.path, content);\n        addMessage('system', `Saved: ${currentFile.path}`);\n        \n    } catch (e) {\n        alert(`Error: ${e.message}`);\n    } finally {\n        saveFileBtn.innerHTML = '<i class=\"fa-solid fa-floppy-disk mr-2\"></i> Save Changes';\n    }\n});\n\ncreateRepoBtn.addEventListener('click', () => createRepoModal.classList.remove('hidden'));\ncancelCreateRepoBtn.addEventListener('click', () => createRepoModal.classList.add('hidden'));\n\nconfirmCreateRepoBtn.addEventListener('click', async () => {\n    const name = newRepoName.value.trim();\n    if (!name) return alert('Name required');\n    \n    confirmCreateRepoBtn.disabled = true;\n    confirmCreateRepoBtn.textContent = 'Creating...';\n    \n    try {\n        const res = await fetch('/api/github/create', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({\n                name,\n                description: newRepoDesc.value,\n                private: newRepoPrivate.checked\n            })\n        });\n        \n        if (!res.ok) throw new Error((await res.json()).error);\n        const data = await res.json();\n        \n        createRepoModal.classList.add('hidden');\n        addMessage('system', `Repo created: ${data.repo}`);\n        fetchMyRepos();\n        \n    } catch (e) {\n        alert(`Error: ${e.message}`);\n    } finally {\n        confirmCreateRepoBtn.disabled = false;\n        confirmCreateRepoBtn.textContent = 'Create';\n    }\n});\n\n// --- Chat Logic (UI Improved) ---\n\nfunction addMessage(role, content) {\n    // Update State\n    chatHistory.push({ role, content });\n    addMessageToUI(role, content);\n    if (role !== 'system') {\n        saveCurrentChat();\n    }\n}\n\nfunction addMessageToUI(role, content) {\n    const div = document.createElement('div');\n    // Align user right, others left\n    if (role === 'user') {\n        div.className = 'flex items-end justify-end space-x-2 space-x-reverse mb-4 animate-fade-in-up';\n    } else {\n        div.className = 'flex items-start justify-start space-x-3 md:space-x-4 mb-4 animate-fade-in-up';\n    }\n    \n    let icon = '';\n    let bgClass = '';\n    let textClass = 'text-sm md:text-base leading-relaxed';\n    \n    if (role === 'user') {\n        icon = '<div class=\"w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shrink-0 order-last ml-2\"><i class=\"fa-solid fa-user text-white text-xs\"></i></div>';\n        bgClass = 'bg-blue-600 text-white rounded-br-none';\n    } else if (role === 'system') {\n         icon = '<div class=\"w-8 h-8 rounded-full bg-yellow-600/20 flex items-center justify-center border border-yellow-600/50 shrink-0\"><i class=\"fa-solid fa-info text-yellow-500 text-xs\"></i></div>';\n         bgClass = 'bg-yellow-900/10 border border-yellow-600/20 text-yellow-200';\n    } else {\n        icon = '<div class=\"w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shrink-0\"><i class=\"fa-solid fa-robot text-white text-xs\"></i></div>';\n        bgClass = 'glass text-gray-100 shadow-xl rounded-tl-none';\n    }\n\n    const bubble = document.createElement('div');\n    bubble.className = `${bgClass} rounded-2xl p-3 md:p-4 max-w-[85%] md:max-w-3xl overflow-x-auto ${textClass} shadow-md`;\n    \n    if (role === 'model' || role === 'system') {\n        bubble.innerHTML = marked.parse(content);\n        bubble.querySelectorAll('pre code').forEach((block) => {\n            hljs.highlightElement(block);\n        });\n    } else {\n        bubble.textContent = content;\n    }\n\n    if (role === 'user') {\n        // Icon is appended in innerHTML logic for right alignment\n        div.innerHTML = bubble.outerHTML + icon; \n    } else {\n        div.innerHTML = icon;\n        div.appendChild(bubble);\n    }\n    \n    chatContainer.appendChild(div);\n    scrollToBottom();\n}\n\nfunction scrollToBottom() {\n    chatContainer.scrollTop = chatContainer.scrollHeight;\n}\n\nsendBtn.addEventListener('click', sendMessage);\npromptInput.addEventListener('keydown', (e) => {\n    if (e.key === 'Enter' && !e.shiftKey) {\n        e.preventDefault();\n        sendMessage();\n    }\n});\n\nasync function sendMessage() {\n    const message = promptInput.value.trim();\n    if (!message) return;\n\n    addMessage('user', message);\n    promptInput.value = '';\n\n    const loadingDiv = document.createElement('div');\n    loadingDiv.id = 'loading-msg';\n    loadingDiv.className = 'flex items-start space-x-3 md:space-x-4 opacity-70 mb-4 animate-pulse';\n    loadingDiv.innerHTML = `\n        <div class=\"w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0\">\n            <i class=\"fa-solid fa-robot text-white text-xs\"></i>\n        </div>\n        <div class=\"glass rounded-2xl rounded-tl-none p-3 md:p-4 text-sm md:text-base\">\n            <i class=\"fa-solid fa-circle-notch fa-spin mr-2\"></i> Thinking...\n        </div>\n    `;\n    chatContainer.appendChild(loadingDiv);\n    scrollToBottom();\n\n    try {\n        const context = Array.from(selectedFiles.entries()).map(([path, content]) => ({ path, content }));\n        const fileTree = currentRepoFiles.map(f => f.path);\n        \n        const res = await fetch('/api/chat', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ \n                message, \n                contextFiles: context,\n                repo: currentRepo,\n                fileTree: fileTree\n            })\n        });\n\n        const data = await res.json();\n        chatContainer.removeChild(loadingDiv);\n\n        if (!res.ok) {\n            addMessage('system', `Error: ${data.error || 'Unknown error'}`);\n        } else {\n            let reply = data.result || \"No response\";\n            addMessage('model', reply);\n        }\n\n    } catch (e) {\n        if (document.getElementById('loading-msg')) chatContainer.removeChild(loadingDiv);\n        addMessage('system', `Network Error: ${e.message}`);\n    }\n}\n\n// Initial Load\n(async () => {\n    await loadConfig();\n    \n    // Restore Repository\n    const lastRepo = localStorage.getItem('lastRepo');\n    if (lastRepo) {\n        try {\n            const { owner, repo } = JSON.parse(lastRepo);\n            if (owner && repo) {\n                currentRepo = { owner, repo };\n                repoInput.value = `${owner}/${repo}`;\n                await loadRepository(owner, repo);\n            }\n        } catch (e) {\n            console.error('Failed to restore repo', e);\n        }\n    }\n\n    // Restore Chat Session\n    const lastSessionId = localStorage.getItem('lastSessionId');\n    if (lastSessionId) {\n        await loadChatSession(lastSessionId);\n    } else {\n        // Only start new chat if no history to load\n    }\n})();\n";

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, { 'Content-Type': 'application/javascript' }));

export default app;
