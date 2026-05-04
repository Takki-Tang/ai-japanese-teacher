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

function cleanSpeechText(text) {
  return String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[{}\[\]"`]/g, "")
    .replace(/blackboard|segments|heading|text|title|nextAction/gi, "")
    .replace(/[:：,，]/g, "，")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(text) {
  if (!text) return null;

  let cleaned = String(text)
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

function buildPrompt({ grammarPoint, level, history, studentInput, mode }) {
  if (mode === "chat") {
    return `
你是一个面向中文母语者的日语老师，现在是课间聊天。

你必须只返回 JSON。不要 Markdown，不要代码块，不要解释 JSON。

返回格式必须严格是：
{
  "title": "课间聊聊",
  "blackboard": ["☕ 今日话题：...", "💡 小知识：...", "🗣️ 日语表达：..."],
  "segments": [
    { "heading": "话题", "text": "老师真正要说的话。只写正文，不要写JSON，不要写符号说明。" }
  ],
  "nextAction": "chat"
}

要求：
- 中文为主。
- 轻松自然，像老师课间聊天。
- 可以聊日本文化、日本人思维、旅游、职场、生活习惯。
- 每个 text 控制在 1~2 句话。
- segments 至少 3 条，像电影字幕一样一句一句说。
- 不要出题。

学生输入：
${studentInput || "我们聊聊日本文化吧"}

对话历史：
${JSON.stringify(history || [])}
`;
  }

  return `
你是一个非常擅长用中文教日语的真人老师。
学生是中文母语者，正在学习 JLPT ${level}。

当前语法：「${grammarPoint}」

你必须只返回 JSON。不要 Markdown，不要代码块，不要解释 JSON。

返回格式必须严格是：
{
  "title": "「${grammarPoint}」",
  "blackboard": [
    "🧠 核心感觉：...",
    "🇨🇳 中文意思：...",
    "👉 接续：...",
    "🎯 使用场景：...",
    "🗣️ 例句：..."
  ],
  "segments": [
    { "heading": "核心感觉", "text": "老师真正要说的话。只写正文，不要写JSON。" },
    { "heading": "中文意思", "text": "老师真正要说的话。只写正文，不要写JSON。" },
    { "heading": "接续", "text": "老师真正要说的话。只写正文，不要写JSON。" },
    { "heading": "例句", "text": "老师真正要说的话。只写正文，不要写JSON。" },
    { "heading": "练习", "text": "老师真正要说的话。只写正文，不要写JSON。" }
  ],
  "nextAction": "wait_student"
}

课堂规则：
- 中文讲解为主。
- 日语只用于语法点和例句。
- 不要整段日语授课。
- 黑板只放最重要的东西：核心感觉、中文意思、接续、使用场景、例句。
- 不要让黑板像文章，不要太多标点。
- segments 是字幕，一条一句，老师说一句就显示一句。
- 每个 segments.text 控制在 1~2 句话。
- 至少给 5 条 segments。
- 不要把 JSON、字段名、括号、引号放进 text。
- 不要把 emoji 放进 text，emoji 只放黑板。

教学内容：
1. 核心感觉
2. 中文意思
3. 接续方法
4. 例句
5. 练习题

学生输入：
${studentInput || "お願いします"}

对话历史：
${JSON.stringify(history || [])}
`;
}

async function callGeminiJson(prompt) {
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
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.45,
          maxOutputTokens: 1600,
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

app.get("/", (req, res) => {
  res.send("AI Japanese Teacher API is running. VERSION CLEAN-SPEECH-2026-05-03");
});

app.get("/version", (req, res) => {
  res.json({
    version: "CLEAN-SPEECH-2026-05-03",
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    keyLength: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0,
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

    const rawText = await callGeminiJson(prompt);
    let data = extractJson(rawText);

    if (!data) {
      data = {
        title: `「${grammarPoint || "〜わけではない"}」`,
        blackboard: [
          "🧠 核心感觉：不是完全否定",
          "🇨🇳 中文意思：并不是说……",
          "👉 接续：普通形 + わけではない",
          "🎯 使用场景：柔和否定误解",
          "🗣️ 例句：嫌いなわけではない"
        ],
        segments: [
          {
            heading: "核心感觉",
            text: "这个语法的核心不是直接说“不”，而是柔和地说“并不是说完全这样”。"
          },
          {
            heading: "中文意思",
            text: "中文可以理解成“并不是说……”“不代表……”。重点是部分否定，不是全部否定。"
          },
          {
            heading: "接续",
            text: "动词和い形容词接普通形，な形容词和名词常用“というわけではない”。"
          },
          {
            heading: "例句",
            text: "日本料理が嫌いなわけではありません。意思是：并不是讨厌日本料理。"
          },
          {
            heading: "练习",
            text: "来试一句中译日：并不是说我每天都学习。"
          }
        ],
        nextAction: "wait_student"
      };
    }

    data.title = data.title || `「${grammarPoint || "〜わけではない"}」`;

    if (!Array.isArray(data.blackboard) || data.blackboard.length === 0) {
      data.blackboard = [
        "🧠 核心感觉：不是完全否定",
        "🇨🇳 中文意思：并不是说……",
        "👉 接续：普通形 + わけではない",
        "🎯 使用场景：柔和否定",
        "🗣️ 例句：嫌いなわけではない"
      ];
    }

    if (!Array.isArray(data.segments) || data.segments.length === 0) {
      data.segments = [
        {
          heading: "核心感觉",
          text: "这个语法先从核心感觉理解，不要死背中文翻译。"
        }
      ];
    }

    data.segments = data.segments
      .map((item) => ({
        heading: item.heading || "老师",
        text: cleanSpeechText(item.text || "")
      }))
      .filter((item) => item.text.length > 0);

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
    const cleanText = cleanSpeechText(req.body.text || "");

    if (!cleanText) {
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
                  text: `请用一个有辨识度的中文日语老师声音朗读下面正文。

声音要求：
- 自然，有抑扬顿挫。
- 像真人老师，不要像机器人。
- 语速正常偏快。
- 重点处自然强调。
- 中文用标准普通话。
- 日语例句用自然日语发音。
- 不要朗读 emoji、标点、括号、字段名。
- 只朗读正文。

正文：
${cleanText}`
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Autonoe"
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
  console.log("CLEAN SPEECH VERSION loaded");
});