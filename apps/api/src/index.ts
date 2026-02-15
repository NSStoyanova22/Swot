import Fastify from "fastify";
import cors from "@fastify/cors";
import "dotenv/config";
import { prisma } from "./db.js";
import { routes } from "./routes.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, name: "Swot API" }));

const USER_ID = "swot-user";

app.get("/me", async () => {
  return prisma.user.findUnique({
    where: { id: USER_ID },
    include: { settings: true, targets: true },
  });
});

await app.register(routes);

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
