import type { FastifyInstance } from "fastify";
export const registerHealthRoutes = (app: FastifyInstance) => {
  app.get("/api/health", async () => {
    return {
      service: "gokart-station-agent",
      status: "ok" as const,
      at: new Date().toISOString(),
    };
  });
};
