import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { attachUser } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { partnersRouter } from "./routes/partners.js";
import { usersRouter } from "./routes/users.js";
import { rolesRouter } from "./routes/roles.js";
import { packagesRouter } from "./routes/packages.js";
import { settingsRouter } from "./routes/settings.js";
import { ensureSchema, runSeed } from "./seed.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));

const isProd = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || (isProd ? "" : "mofawter-dev-secret-change-me");
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required in production");
}

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(attachUser);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/partners", partnersRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/packages", packagesRouter);
app.use("/api/settings", settingsRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("unhandled error", err);
  res.status(500).json({ error: "server_error" });
});

const PORT = Number(process.env.PORT || 5000);
const HOST = "0.0.0.0";
const isDev = !isProd;

async function start() {
  await ensureSchema();
  await runSeed();

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const projectRoot = path.resolve(__dirname, "..");
    const vite = await createViteServer({
      configFile: path.resolve(projectRoot, "vite.config.ts"),
      root: path.resolve(projectRoot, "client"),
      server: { middlewareMode: true, hmr: { server: undefined } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "..", "public");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, HOST, () => {
    console.log(`Mofawter Partner Portal running on http://${HOST}:${PORT}`);
  });
}

start().catch((e) => {
  console.error("fatal start error", e);
  process.exit(1);
});
