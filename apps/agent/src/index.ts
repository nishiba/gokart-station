import { z } from "zod";
import { buildApp } from "./app";

const portSchema = z.coerce.number().int().min(1).max(65535).default(4000);

const start = async () => {
  const app = await buildApp();
  const host = process.env.HOST ?? "127.0.0.1";
  const port = portSchema.parse(process.env.PORT);

  try {
    await app.listen({
      host,
      port,
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};

void start();
