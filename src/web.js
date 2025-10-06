// src/web.js

import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

// We will pass the asterAPI instance from index.js when starting the server.
export function startKeepAliveServer(asterAPI) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // --- API ENDPOINT FOR K-LINE (CHART) DATA ---
    if (pathname === '/api/klines') {
        try {
            const { symbol, interval, limit } = parsedUrl.query;
            if (!symbol || !interval) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Symbol and interval are required' }));
                return;
            }
            
            const klines = await asterAPI.getKlines(symbol, interval, limit || 500);
            
            res.setHeader('Access-Control-Allow-Origin', '*'); // Allow cross-origin requests
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(klines));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // --- SERVE THE FRONTEND HTML FILE ---
    if (pathname === '/' || pathname === '/index.html') {
        const filePath = path.join(process.cwd(), 'public', 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html. Make sure the public/index.html file exists.');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // --- Original Keep-Alive and 404 Handler ---
    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot is running\n');
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found\n');
    }
  });

  const port = process.env.PORT || 10000;
  server.listen(port, () => {
    console.log(`✅ [SERVER] Frontend and API server running on port ${port}`);
    console.log(`➡️  Access your chart at http://localhost:${port}`);
  });
}