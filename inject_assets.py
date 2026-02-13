import json

def main():
    with open('src/index.ts', 'r') as f:
        ts_code = f.read()

    with open('src/ui.html', 'r') as f:
        html_code = f.read()

    with open('src/ui.js', 'r') as f:
        js_code = f.read()

    # Remove the placeholder export default app; at the end if I want to wrap it,
    # but I can just append the routes and export at the end.
    # My src/index.ts already has export default app;
    # I should remove it and append the new routes and then export.

    ts_code = ts_code.replace('export default app;', '')

    # logic to append
    new_code = f"""{ts_code}

// --- Frontend Serving ---

const htmlContent = {json.dumps(html_code)};
const jsContent = {json.dumps(js_code)};

app.get('/', (c) => c.html(htmlContent));
app.get('/ui.js', (c) => c.text(jsContent, 200, {{ 'Content-Type': 'application/javascript' }}));

export default app;
"""

    with open('src/index.ts', 'w') as f:
        f.write(new_code)

    print("Successfully injected frontend assets into src/index.ts")

if __name__ == "__main__":
    main()
