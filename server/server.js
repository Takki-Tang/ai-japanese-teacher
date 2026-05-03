import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const TEXT_MODEL = "gemini-3.1-flash-lite-preview";
const AUDIO_MODEL = "gemini-3.1-flash-lite-preview";
const TTS_MODEL = "gemini-3.1-flash-tts-preview";

function pcmToWavBase64(pcmBase64) {
  const pcmBuffer = Buffer.from(pcmBase64, "base64");
  const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(1, 22);
  wavBuffer.writeUInt32LE(24000, 24);
  wavBuffer.writeUInt32LE(48000, 28);
  wavBuffer.writeUInt16LE(2, 32);
  wavBuffer.writeUInt16LE(16, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer.toString("base64");
}

function buildPrompt({ grammarPoint, history, studentInput, mode }) {
  if (mode === "chat") {
    return `
你是一个中国人的日语老师，现在是“课间聊天时间”。

要求：
- 用中文为主聊天
- 轻松自然，像老师聊天
- 可以讲：
  日本文化 / 日本人思维 / 旅游 / 职场 / 日常生活
- 不要出题
- 不要强行回到语法
- 可以顺带讲一点日语小知识

学生问题：
${studentInput}

返回JSON：

{
  "title": "课间聊聊",
  "blackboard": [
    "☕ 今日话题：XXX",
    "💡 小知识：XXX"
  ],
  "segments": [
    {
      "heading": "老师",
      "text": "你的回答"
    }
  ],
  "nextAction": "chat"
}
`;
  }

  return `
你是一个中国人的日语老师。

⚠️必须：
- 中文讲解为主
- 日语只用于例句

当前语法：
${grammarPoint}

学生输入：
${studentInput}

要求：
- 有层次
- 有例句
- 像真人

返回JSON：

{
  "title": "语法讲解",
  "blackboard": ["🧠 核心：...", "👉 接续：..."],
  "segments": [
    { "heading": "核心感觉", "text": "..." },
    { "heading": "例句", "text": "..." }
  ],
  "nextAction": "continue"
}
`;
}

app.post("/api/classroom", async (req, res) => {
  try {
    const { grammarPoint, history, studentInput, mode } = req.body;

    const prompt = buildPrompt({
      grammarPoint,
      history,
      studentInput,
      mode,
    });

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.7,
        responseMimeType: "application/json",
      },
    });

    const data = JSON.parse(response.text);

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "AI error" });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;

    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          parts: [
            {
              text: `请用中文老师语气朗读，中文为主，日语例句正常发音，语速1.15倍：${text}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
      },
    });

    const pcmBase64 =
      response.candidates[0].content.parts[0].inlineData.data;

    res.json({
      audio: pcmToWavBase64(pcmBase64),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "tts error" });
  }
});

app.listen(3001);