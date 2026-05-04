import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const VERSION = "minimal-ai-shell-2026-05-04-03";

function mustHaveKey() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }
}

function cleanJsonText(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeLesson(data, grammarPoint) {
  const title = String(data?.title || grammarPoint || "AI日语老师").trim();

  const blackboard = Array.isArray(data?.blackboard)
    ? data.blackboard
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const segments = Array.isArray(data?.segments)
    ? data.segments
        .map((s) => ({ text: String(s?.text || "").trim() }))
        .filter((s) => s.text)
        .slice(0, 20)
    : [];

  return {
    title,
    blackboard,
    segments,
  };
}

function pcmToWavBase64(pcmBase64, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const pcm = Buffer.from(pcmBase64, "base64");
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString("base64");
}

app.get("/version", (req, res) => {
  res.json({ version: VERSION });
});

app.post("/api/lesson", async (req, res) => {
  try {
    mustHaveKey();

    const {
      grammarPoint = "",
      studentInput = "",
      mode = "lesson",
      history = [],
    } = req.body || {};

    const safeGrammar = String(grammarPoint || "").trim();
    const safeInput = String(studentInput || "").trim();

    if (!safeGrammar) {
      return res.status(400).json({
        error: "grammarPoint is required",
      });
    }

    const systemPrompt = `
你是一个非常自然、聪明、会讲中文的 AI 日语老师。

当前语法点是：「${safeGrammar}」。

规则：
1. 只讲这个语法，禁止换语法
2. 黑板内容必须是有价值的总结，禁止废话
3. 黑板必须包含：
   - 核心感觉
   - 中文意思
   - 接续
   - 使用场景
   - 至少1个例句
4. 当讲到例句时，必须同步写入 blackboard
5. segments 是老师真实说的话，要像真人
6. 学生造句必须批改并解释
7. 输出只能是 JSON

格式：
{
  "title": "...",
  "blackboard": ["..."],
  "segments": [{"text":"..."}]
}
`;

    const userPrompt = {
      grammarPoint: safeGrammar,
      mode,
      studentInput: safeInput,
      history: Array.isArray(history) ? history.slice(-10) : [],
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${systemPrompt}\n\n${JSON.stringify(userPrompt)}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.8,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const raw = await response.json();
    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    const parsed = JSON.parse(cleanJsonText(text));
    const lesson = normalizeLesson(parsed, safeGrammar);

    res.json({ ok: true, lesson, version: VERSION });
  } catch (e) {
    res.status(500).json({
      error: "lesson failed",
      message: e.message,
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    mustHaveKey();

    const { text = "" } = req.body || {};
    const safeText = String(text).trim();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: safeText }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
          },
        }),
      }
    );

    const raw = await response.json();

    const audioPart = raw?.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData
    );

    if (!audioPart) {
      return res.status(500).json({ error: "no audio" });
    }

    const wavBase64 = pcmToWavBase64(audioPart.inlineData.data);

    res.json({
      ok: true,
      mimeType: "audio/wav",
      audioBase64: wavBase64,
    });
  } catch (e) {
    res.status(500).json({
      error: "tts failed",
      message: e.message,
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running:", VERSION);
});