const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Models shown in the dropdown. Check https://console.groq.com/docs/models for changes.
const MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
];

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "chatuser",
  password: process.env.DB_PASSWORD || "chatpass",
  database: process.env.DB_NAME || "chatdb",
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  // Retry so the app waits for the database to come up
  for (let i = 1; i <= 20; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id, updated_at DESC);
      `);
      console.log("Database ready");
      return;
    } catch (err) {
      console.log(`DB not ready (attempt ${i}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("Could not connect to database");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Used by the load balancer health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/models", (_req, res) => res.json({ models: MODELS, default: DEFAULT_MODEL }));

app.get("/api/conversations", async (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId) return res.json([]);
  try {
    const { rows } = await pool.query(
      "SELECT id, title FROM conversations WHERE client_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [clientId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

app.get("/api/history/:sessionId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT role, content FROM messages WHERE session_id = $1 ORDER BY id ASC",
      [req.params.sessionId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

async function deleteConversation(id) {
  await pool.query("DELETE FROM messages WHERE session_id = $1", [id]);
  await pool.query("DELETE FROM conversations WHERE id = $1", [id]);
}

app.delete("/api/conversations/:id", async (req, res) => {
  try {
    await deleteConversation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// Kept for compatibility with the older frontend
app.delete("/api/history/:sessionId", async (req, res) => {
  try {
    await deleteConversation(req.params.sessionId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear history" });
  }
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, clientId, message, model } = req.body || {};
  if (!sessionId || !message) {
    return res.status(400).json({ error: "sessionId and message are required" });
  }
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server" });
  }
  const chosenModel = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;

  let userMsgId;
  try {
    const title = message.replace(/\s+/g, " ").trim().slice(0, 40) || "New chat";
    await pool.query(
      `INSERT INTO conversations (id, client_id, title) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [sessionId, clientId || "anonymous", title]
    );

    const ins = await pool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id",
      [sessionId, message]
    );
    userMsgId = ins.rows[0].id;

    // Last 20 messages as context
    const { rows } = await pool.query(
      `SELECT role, content FROM (
         SELECT id, role, content FROM messages WHERE session_id = $1 ORDER BY id DESC LIMIT 20
       ) t ORDER BY id ASC`,
      [sessionId]
    );

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: chosenModel,
        messages: [
          {
            role: "system",
            content:
              "You are Converra, a helpful AI assistant. Use Markdown for formatting and fenced code blocks for code.",
          },
          ...rows,
        ],
      }),
    });

    if (!groqRes.ok) {
      const text = await groqRes.text();
      console.error("Groq error:", groqRes.status, chosenModel, text);
      await pool.query("DELETE FROM messages WHERE id = $1", [userMsgId]);
      return res
        .status(502)
        .json({ error: `Groq API error (${groqRes.status}) for model ${chosenModel}` });
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content || "(no response)";

    await pool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'assistant', $2)",
      [sessionId, reply]
    );
    res.json({ reply });
  } catch (err) {
    console.error(err);
    if (userMsgId) await pool.query("DELETE FROM messages WHERE id = $1", [userMsgId]).catch(() => {});
    res.status(500).json({ error: "Something went wrong" });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`Backend listening on ${PORT}`)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
