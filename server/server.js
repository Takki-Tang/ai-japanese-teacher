import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const TEXT_MODEL = "gemini-2.5-flash";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

function pcmToWavBase64(pcmBase64, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const pcmBuffer = Buffer.from(pcmBase64, "base64");
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitDepth, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer.toString("base64");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const cleaned = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first < 0 || last <= first) return null;

  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function cleanTtsText(text) {
  return String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[{}\[\]"`]/g, "")
    .replace(/\b(title|blackboard|segments|heading|text|nextAction)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeData(data, grammarPoint) {
  const title = data?.title || `「${grammarPoint}」`;

  const blackboard = Array.isArray(data?.blackboard) && data.blackboard.length > 0
    ? data.blackboard
    : [
        `🧠 核心感觉：请从「${grammarPoint}」的语感理解`,
        "🇨🇳 中文意思：先理解大方向",
        "👉 接续：看前面接什么词",
        "🎯 使用场景：判断什么时候自然",
        "🗣️ 例句：结合句子记忆"
      ];

  let segments = Array.isArray(data?.segments) ? data.segments : [];

  segments = segments
    .map((item) => ({
      heading: String(item?.heading || "老师"),
      text: String(item?.text || "").trim()
    }))
    .filter((item) => item.text.length > 0);

  if (segments.length === 0) {
    segments = [
      {
        heading: "重新说明",
        text: `我们重新讲「${grammarPoint}」。先不要死背中文翻译，要先抓住它在日语里的使用感觉。`
      }
    ];
  }

  return {
    title,
    blackboard,
    segments,
    nextAction: data?.nextAction || "continue"
  };
}

function buildPrompt({ grammarPoint, level, history, studentInput, mode }) {
  return `
你是一个面向中文母语者的日语老师。

当前模式：${mode === "chat" ? "课间聊天" : "语法课堂"}
当前语法：「${grammarPoint}」
JLPT等级：${level}

绝对规则：
1. 只返回 JSON，不要 Markdown，不要代码块。
2. blackboard 是黑板，只放重点。
3. segments 是老师旁白字幕，只写老师真正要说的话。
4. segments.text 不要出现 JSON、字段名、括号、引号、emoji。
5. 讲解必须中文为主。
6. 日语只用于语法点、例句、学生句子。
7. 日语必须完整保留假名，例如「話しません」「食べるべきだ」，不能只写汉字。
8. 如果学生输入是造句或回答练习，必须优先批改，不要继续讲新课。
9. 批改必须包含：是否自然、哪里不自然、更自然说法、中文解释、类似练习。
10. 每个 segments.text 控制在 1~2 句话，像电影字幕一样。

返回格式：
{
  "title": "「${grammarPoint}」",
  "blackboard": [
    "🧠 核心感觉：……",
    "🇨🇳 中文意思：……",
    "👉 接续：……",
    "🎯 使用场景：……",
    "🗣️ 例句：……"
  ],
  "segments": [
    {
      "heading": "核心感觉",
      "text": "老师真正要说的话。"
    }
  ],
  "nextAction": "wait_student"
}

如果是开始讲课：
- 讲这个语法本身，不要讲别的语法。
- 黑板必须围绕「${grammarPoint}」。
- 旁白也必须围绕「${grammarPoint}」。

如果是学生造句：
- 不要重新上课。
- 直接批改学生句子。

学生输入：
${studentInput || "お願いします"}

对话历史：
${JSON.stringify(history || [])}
`;
}

async function callGeminiJson(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 1800,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini text error:", JSON.stringify(data, null, 2));
    throw new Error(data?.error?.message || "Gemini text error");
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiTts(text) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const cleanText = cleanTtsText(text);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `
请朗读下面这段日语老师旁白。

要求：
- 中文部分用自然中文。
- 日语例句必须完整用日语读，不要只读汉字。
- 例如「話しません」必须完整读成日语。
- 例如「食べるべきだ」必须完整读成日语。
- 不读 emoji，不读字段名，不读 JSON，不读括号。
- 像真人老师，有自然停顿和起伏。
- 语速正常偏快。

正文：
${cleanText}
`
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore"
              }
            }
          }
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini TTS error:", JSON.stringify(data, null, 2));
    throw new Error(data?.error?.message || "Gemini TTS error");
  }

  const pcmBase64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!pcmBase64) throw new Error("no audio returned");

  return pcmToWavBase64(pcmBase64);
}

app.get("/", (req, res) => {
  res.send("AI Japanese Teacher API is running. VERSION ONE-TTS-2026-05-04");
});

app.get("/version", (req, res) => {
  res.json({
    version: "ONE-TTS-2026-05-04",
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    keyLength: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0,
    oneTtsMode: true
  });
});

app.post("/api/classroom", async (req, res) => {
  try {
    const { grammarPoint, level, history, studentInput, mode } = req.body;

    const targetGrammar = grammarPoint || "〜べきだ";

    const prompt = buildPrompt({
      grammarPoint: targetGrammar,
      level: level || "N3",
      history: history || [],
      studentInput: studentInput || "お願いします",
      mode: mode || "lesson"
    });

    const raw = await callGeminiJson(prompt);
    const parsed = extractJson(raw);

    const data = normalizeData(parsed, targetGrammar);

    const speechText = data.segments
      .map((s) => s.text)
      .join("\n");

    res.json({
      ...data,
      speechText
    });
  } catch (error) {
    console.error("classroom error:", error.message);
    res.status(500).json({
      error: "AI classroom request failed",
      detail: error.message
    });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const text = req.body.text || "";

    if (!text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const audio = await callGeminiTts(text);

    res.json({
      audio,
      mimeType: "audio/wav"
    });
  } catch (error) {
    console.error("tts error:", error.message);
    res.status(500).json({
      error: "tts request failed",
      detail: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Japanese Teacher server running on port ${PORT}`);
  console.log("ONE TTS VERSION loaded");
});