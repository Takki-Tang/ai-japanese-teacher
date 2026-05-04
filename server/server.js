const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const VERSION = "minimal-ai-shell-2026-05-04-01";

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
        .slice(0, 8)
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

app.get("/", (req, res) => {
  res.json({ ok: true, version: VERSION });
});

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

这个系统只是壳子，所有教学逻辑由你决定。
当前语法点是：「${safeGrammar}」。

绝对规则：
1. 用户输入什么语法，你就只讲这个语法。
2. 禁止擅自换成别的语法。
3. 禁止输出 Markdown。
4. 禁止输出 JSON 以外的内容。
5. 黑板只写有用重点，不要写“先理解大方向”“看前面接什么词”这种废话。
6. 右侧 segments 是老师真正说出口的话，必须自然，像真人老师讲课。
7. 如果学生造句，你必须批改：
   - 是否自然
   - 哪里不自然
   - 更自然表达
   - 中文解释
   - 再给一个类似练习
8. 如果学生提问，你自然回答问题，然后回到当前语法点。
9. 课堂要轻松、清楚、自然，不要机械。

返回 JSON 格式必须是：
{
  "title": "当前语法标题",
  "blackboard": [
    "核心感觉：...",
    "中文意思：...",
    "接续：...",
    "使用场景：...",
    "例句：..."
  ],
  "segments": [
    {"text": "老师旁白第1句"},
    {"text": "老师旁白第2句"}
  ]
}
`;

    const userPrompt = {
      currentGrammarPoint: safeGrammar,
      currentMode: mode,
      studentInput: safeInput,
      conversationHistory: Array.isArray(history) ? history.slice(-12) : [],
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${systemPrompt}\n\n输入信息：\n${JSON.stringify(
                    userPrompt,
                    null,
                    2
                  )}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.8,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                blackboard: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
                segments: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      text: { type: "STRING" },
                    },
                    required: ["text"],
                  },
                },
              },
              required: ["title", "blackboard", "segments"],
            },
          },
        }),
      }
    );

    const raw = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Gemini lesson request failed",
        detail: raw,
      });
    }

    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(cleanJsonText(text));
    const lesson = normalizeLesson(parsed, safeGrammar);

    res.json({
      ok: true,
      lesson,
      version: VERSION,
    });
  } catch (error) {
    res.status(500).json({
      error: "lesson failed",
      message: error.message,
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    mustHaveKey();

    const { text = "" } = req.body || {};
    const safeText = String(text || "").trim();

    if (!safeText) {
      return res.status(400).json({
        error: "text is required",
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "请用自然、温柔、清楚的日语老师语气朗读下面内容。语速稍慢，但不要机械。\n\n" +
                    safeText,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Kore",
                },
              },
            },
          },
        }),
      }
    );

    const raw = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Gemini TTS request failed",
        detail: raw,
      });
    }

    const inlineData =
      raw?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
        ?.inlineData || null;

    if (!inlineData?.data) {
      return res.status(502).json({
        error: "No audio returned from Gemini TTS",
      });
    }

    const wavBase64 = pcmToWavBase64(inlineData.data);

    res.json({
      ok: true,
      mimeType: "audio/wav",
      audioBase64: wavBase64,
    });
  } catch (error) {
    res.status(500).json({
      error: "tts failed",
      message: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Japanese Teacher server running on port ${PORT}`);
  console.log(`version: ${VERSION}`);
});