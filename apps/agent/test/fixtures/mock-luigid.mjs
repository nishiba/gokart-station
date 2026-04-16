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

const workerList = [
  {
    name: "mock-worker-1",
    num_running: 1,
    num_pending: 2,
  },
];

const taskLists = {
  RUNNING: {
    "PublishReport(rerun_token=mock)": {
      status: "RUNNING",
    },
  },
  BATCH_RUNNING: {},
  PENDING: {
    "PrepareInput(rerun_token=mock)": {
      status: "PENDING",
    },
    "RenderReport(rerun_token=mock)": {
      status: "PENDING",
    },
  },
  FAILED: {
    "BrokenReport(rerun_token=mock)": {
      status: "FAILED",
    },
  },
};

const readRpcPayload = (requestUrl) => {
  const data = requestUrl.searchParams.get("data");
  if (!data) {
    return {};
  }

  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
};

const server = http.createServer((_request, response) => {
  const requestUrl = new URL(_request.url ?? "/", `http://${host}:${port}`);

  if (requestUrl.pathname === "/api/worker_list") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ response: workerList }));
    return;
  }

  if (requestUrl.pathname === "/api/task_list") {
    const payload = readRpcPayload(requestUrl);
    const status = typeof payload.status === "string" ? payload.status : "";
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ response: taskLists[status] ?? {} }));
    return;
  }

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
