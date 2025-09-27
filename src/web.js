import http from 'http';

export function startKeepAliveServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running\n');
  });

  const port = process.env.PORT || 10000;
  server.listen(port, () => {
    console.log(`✅ [SERVER] Keep-alive server running on port ${port}`);
  });
}