// Serves the exported web app with single-page fallback (every route -> index.html).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8081);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(root, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`web app on http://localhost:${port}`));
