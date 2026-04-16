import http from "node:http";

const args = process.argv.slice(2);

const readArg = (name, fallbackValue) => {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return fallbackValue;
  }

  return args[index + 1];
};

const host = readArg("--address", "127.0.0.1");
const port = Number(readArg("--port", "8082"));

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end("mock luigid ok");
});

const shutdown = () => {
  console.error("mock luigid shutting down");
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(port, host, () => {
  console.log(`mock luigid listening on ${host}:${port}`);
  console.error("mock luigid stderr ready");
});
