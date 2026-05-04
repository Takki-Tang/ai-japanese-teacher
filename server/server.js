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

function cleanForTTS(text) {
  return String(text || "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[{}\[\]"`]/g, "")
    .replace(/blackboard|segments|heading|title|nextAction|text/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrompt({ grammarPoint, level, history, studentInput, mode }) {
  if (mode === "chat") {
    return `
你是一个面向中文母语者的日语老师。现在是课间聊天。

只返回 JSON，不要 Markdown，不要代码块，不要解释 JSON。

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
      "text": "老师真正要说的话。"
    }
  ],
  "nextAction": "chat"
}

要求：
- 中文为主。
- 可以聊日本文化、日本人思维、旅游、职场、生活习惯。
- segments 至少 3 条。
- 每条 text 控制在 1~2 句话。
- 如果出现日语，必须保留完整日语原文，不要只写汉字。

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

只返回 JSON，不要 Markdown，不要代码块，不要解释 JSON。

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
    },
    {
      "heading": "接续",
      "text": "老师真正要说的话。"
    },
    {
      "heading": "例句",
      "text": "老师真正要说的话。"
    },
    {
      "heading": "练习",
      "text": "老师真正要说的话。"
    }
  ],
  "nextAction": "wait_student"
}

绝对规则：
- 老师讲解必须中文为主。
- 日语只用于语法点、例句、学生答案。
- 黑板只放最重要内容：核心感觉、中文意思、接续、使用场景、例句。
- segments 是老师旁白字幕，一条一句。
- 不要把 emoji 放进 segments.text。
- 不要把 JSON、字段名、括号、引号放进 segments.text。
- 日语例句必须完整保留假名，比如「話しません」「食べたいわけではない」，不能只写汉字。
- 如果学生是在造句、回答练习、写日语句子，必须优先批改。
- 批改时必须包含：
  1. 是否自然
  2. 哪里不自然
  3. 更自然的说法
  4. 中文解释
  5. 再给一个类似练习

判断学生输入：
- 如果是「お願いします」或“开始”：正常讲课。
- 如果包含日语句子或像是在造句：批改。
- 如果是中文问题：回答问题。
- 如果是“下一步”：继续推进课堂。

如果是刚开始讲课：
1. 核心感觉
2. 中文意思
3. 接续
4. 例句
5. 练习

如果是学生造句：
1. 先说结论
2. 指出问题
3. 给自然表达
4. 解释差别
5. 给新练习

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
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.45,
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

async function callGeminiTTS(text) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const cleanText = cleanForTTS(text);

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
                text: `
请朗读下面这段老师旁白。

声音要求：
- 像真人中文日语老师。
- 中文部分用自然中文。
- 日语例句必须完整按日语读出来，不要拆开汉字读。
- 例如「話しません」要完整读成日语，不要只读“话”。
- 例如「食べたいわけではありません」要完整读成日语。
- 不要朗读 emoji、字段名、JSON、括号。
- 语速正常偏快。
- 有自然高低起伏。
- 不要机器人腔。
- 不要把标点念出来。

老师旁白：
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
    console.error("TTS API error:", JSON.stringify(data, null, 2));
    throw new Error(data?.error?.message || "TTS error");
  }

  const pcmBase64 =
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!pcmBase64) {
    throw new Error("no audio returned");
  }

  return pcmToWavBase64(pcmBase64);
}

app.get("/", (req, res) => {
  res.send("AI Japanese Teacher API is running. VERSION REBUILD-VOICE-CHECK-2026-05-03");
});

app.get("/version", (req, res) => {
  res.json({
    version: "REBUILD-VOICE-CHECK-2026-05-03",
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
            text: "这个语法的核心不是直接说不，而是柔和地说，并不是说完全这样。"
          },
          {
            heading: "中文意思",
            text: "中文可以理解成，并不是说……，或者不代表……。重点是部分否定，不是全部否定。"
          },
          {
            heading: "接续",
            text: "动词和い形容词接普通形。な形容词和名词常用「というわけではない」。"
          },
          {
            heading: "例句",
            text: "日本料理が嫌いなわけではありません。意思是，并不是讨厌日本料理。"
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
        text: cleanForTTS(item.text || "")
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
    const text = req.body.text || "";

    if (!text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const audio = await callGeminiTTS(text);

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

app.post("/api/audio", upload.single("audio"), async (req, res) => {
  res.status(503).json({
    error: "Audio transcription disabled temporarily."
  });
});

app.listen(PORT, () => {
  console.log(`AI Japanese Teacher server running on port ${PORT}`);
  console.log("REBUILD VOICE CHECK VERSION loaded");
});