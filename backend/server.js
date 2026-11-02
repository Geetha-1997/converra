const express = require("express");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Models shown in the dropdown. Check https://console.groq.com/docs/models for changes.
const MODELS = [
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
];

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Used by the load balancer health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/models", (_req, res) => res.json({ models: MODELS, default: DEFAULT_MODEL }));

// Stateless: the browser sends the recent conversation with every request.
app.post("/api/chat", async (req, res) => {
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages are required" });
  }
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server" });
  }
  const chosenModel = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;

  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
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
          ...clean,
        ],
      }),
    });

    if (!groqRes.ok) {
      const text = await groqRes.text();
      console.error("Groq error:", groqRes.status, chosenModel, text);
      return res
        .status(502)
        .json({ error: `Groq API error (${groqRes.status}) for model ${chosenModel}` });
    }

    const data = await groqRes.json();
    res.json({ reply: data.choices?.[0]?.message?.content || "(no response)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
