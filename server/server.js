import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";

dotenv.config();

const app = express();
const upload = multer();

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
  if (!text) return null;

  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first >= 0 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callGeminiText(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1800,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini API error:", JSON.stringify(data, null, 2));
    throw new Error(data?.error?.message || "Gemini API error");
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function buildPrompt({ grammarPoint, level, history, studentInput, mode }) {
  if (mode === "chat") {
    return `
你是一个面向中文母语者的日语老师。现在是课间聊天时间。

绝对规则：
- 只返回 JSON。
- 不要 Markdown。
- 不要代码块。
- 不要解释 JSON。
- segments.text 必须是老师真正要说的话。
- 不要把 JSON 内容放进 text 里。

风格：
- 中文为主，像老师聊天。
- 可以聊日本文化、日本人思维、旅游、职场、生活习惯。
- 不要出题。
- 可以顺带讲一点日语小知识。

返回格式：

{
  "title": "课间聊聊",
  "blackboard": [
    "☕ 今日话题：……",
    "💡 小知识：……",
    "🗣️ 日语表达：……"
  ],
  "segments": [
    {
      "heading": "话题",
      "text": "这里写老师自然聊天的完整正文。"
    }
  ],
  "nextAction": "chat"
}

对话历史：
${JSON.stringify(history || [])}

学生输入：
${studentInput || "我们聊聊日本文化吧"}
`;
  }

  return `
你是一个非常擅长用中文教日语的真人老师。
学生是中文母语者，正在学习 JLPT ${level}。

当前语法：
「${grammarPoint}」

绝对规则：
- 只返回 JSON。
- 不要 Markdown。
- 不要代码块。
- 不要解释 JSON。
- 不要把 JSON 当正文输出。
- segments.text 里面只能写老师真正要说的话。
- 必须用中文讲解。
- 日语只用于语法点、例句、学生答案修正。
- 不要整段日语授课。
- 不要只说一句，要完整上完这一小节。
- 每段 text 控制在 80~160 中文字。

教学要求：
- 有核心感觉。
- 有使用场景。
- 有接续。
- 有例句。
- 有练习题。
- 黑板必须 5 条以上，带 emoji。

返回格式：

{
  "title": "「${grammarPoint}」讲解",
  "blackboard": [
    "🧠 核心感觉：……",
    "👉 接续：……",
    "🎯 使用场景：……",
    "🗣️ 例句：……",
    "📝 练习：……"
  ],
  "segments": [
    {
      "heading": "核心感觉",
      "text": "这里写中文讲解正文。"
    },
    {
      "heading": "使用场景",
      "text": "这里写中文讲解正文。"
    },
    {
      "heading": "接续",
      "text": "这里写中文讲解正文。"
    },
    {
      "heading": "例句",
      "text": "这里写多个日语例句和中文解释。"
    },
    {
      "heading": "练习",
      "text": "这里出一道中译日题，并让学生回答。"
    }
  ],
  "nextAction": "wait_student"
}

对话历史：
${JSON.stringify(history || [])}

学生输入：
${studentInput || "お願いします"}
`;
}

app.get("/", (req, res) => {
  res.send("AI Japanese Teacher API is running. VERSION FINAL-TTS-2026-05-03");
});

app.get("/version", (req, res) => {
  res.json({
    version: "FINAL-TTS-2026-05-03",
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    keyLength: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0,
    sdkRemoved: true,
    ttsEnabled: true
  });
});

app.post("/api/classroom", async (req, res) => {
  try {
    const { grammarPoint, level, history, studentInput, mode } = req.body;

    const prompt = buildPrompt({
      grammarPoint: grammarPoint || "〜わけではない",
      level: level || "N3",
      history: history || [],
      studentInput: studentInput || "お願いします",
      mode: mode || "lesson"
    });

    const rawText = await callGeminiText(prompt);
    let data = extractJson(rawText);

    if (!data) {
      data = {
        title: "老师讲解",
        blackboard: [
          "🧠 核心：先理解语法感觉",
          "💡 重点：不要死背中文翻译",
          "🎯 目标：会判断什么时候用"
        ],
        segments: [
          {
            heading: "重新整理",
            text: rawText || "老师刚刚没有组织好语言，我们重新来一次。"
          }
        ],
        nextAction: "continue"
      };
    }

    if (!Array.isArray(data.segments) || data.segments.length === 0) {
      data.segments = [
        {
          heading: "核心感觉",
          text: "我们重新来。这个语法先从核心感觉理解，不要死背中文翻译。"
        }
      ];
    }

    data.segments = data.segments.map((item) => ({
      heading: item.heading || "讲解",
      text:
        item.text && item.text.trim()
          ? item.text
          : "这里老师刚刚没有说完整，我们换一种方式重新讲。"
    }));

    if (!Array.isArray(data.blackboard) || data.blackboard.length === 0) {
      data.blackboard = [
        "🧠 核心感觉：先理解语法的使用场景",
        "👉 接续：看前面接什么词",
        "💡 重点：不要只背中文翻译"
      ];
    }

    res.json(data);
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
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `请像一个有经验、有亲和力、有抑扬顿挫的中文日语老师一样朗读下面内容。

要求：
- 中文讲解自然、有节奏、有高低起伏。
- 不要像机器人。
- 重点处稍微强调。
- 语速略快，但清楚。
- 遇到日语例句时，用标准日语自然发音。
- 不要朗读标题、括号、JSON、符号。
- 只朗读正文内容。

正文：
${text}`
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
      console.error("TTS API error:", JSON.stringify(data, null, 2));
      return res.status(500).json({
        error: "tts request failed",
        detail: data?.error?.message || "TTS error"
      });
    }

    const pcmBase64 =
      data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!pcmBase64) {
      return res.status(500).json({ error: "no audio returned" });
    }

    res.json({
      audio: pcmToWavBase64(pcmBase64),
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

app.post("/api/audio", upload.single("audio"), async (req, res) => {
  res.status(503).json({
    error: "Audio transcription disabled temporarily."
  });
});

app.listen(PORT, () => {
  console.log(`AI Japanese Teacher server running on port ${PORT}`);
  console.log("FINAL TTS VERSION loaded");
  console.log(`Gemini key exists: ${Boolean(GEMINI_API_KEY)}`);
});