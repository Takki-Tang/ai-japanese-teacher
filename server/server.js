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

function buildPrompt({ grammarPoint, level, history, studentInput, mode }) {
  if (mode === "chat") {
    return `
你是一个面向中文母语者的日语老师。现在是课间聊天时间。

规则：
- 中文为主，自然聊天。
- 可以聊日本文化、日本人思维、旅游、职场、生活习惯。
- 不要出题。
- 不要强行回到语法。
- 可以顺带讲一点日语小知识。
- 每个 segment 的 text 不能为空。

返回严格 JSON：

{
  "title": "课间聊聊",
  "blackboard": [
    "☕ 今日话题：……",
    "💡 小知识：……",
    "🗣️ 日语表达：……"
  ],
  "segments": [
    {
      "heading": "老师",
      "text": "这里必须写完整回答，不要空。"
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

最重要规则：
- 必须用中文讲解。
- 日语只用于语法点、例句、学生答案修正。
- 绝对不要整段日语授课。
- 每个 segment 的 text 必须有完整正文，不能为空。
- 不要只返回“老师讲解”这种标题。
- 要像真人老师，有核心感觉，有例句，有层次。

如果学生刚开始：
1. 讲核心感觉
2. 讲什么时候用
3. 讲接续
4. 给例句
5. 出一道练习题

返回严格 JSON：

{
  "title": "本轮标题",
  "blackboard": [
    "🧠 核心感觉：……",
    "👉 接续：……",
    "🗣️ 例句：……",
    "🎯 使用场景：……",
    "📝 练习：……"
  ],
  "segments": [
    {
      "heading": "核心感觉",
      "text": "这里写老师要说的完整正文。"
    },
    {
      "heading": "例句",
      "text": "这里写完整例句和解释。"
    }
  ],
  "nextAction": "continue"
}

对话历史：
${JSON.stringify(history || [])}

学生输入：
${studentInput || "お願いします"}
`;
}

app.get("/", (req, res) => {
  res.send("AI Japanese Teacher API is running.");
});

app.post("/api/classroom", async (req, res) => {
  try {
    const { grammarPoint, level, history, studentInput, mode } = req.body;

    const prompt = buildPrompt({
      grammarPoint,
      level: level || "N3",
      history: history || [],
      studentInput: studentInput || "お願いします",
      mode: mode || "lesson",
    });

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.7,
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingLevel: "minimal",
        },
      },
    });

    let data;

    try {
      data = JSON.parse(response.text || "{}");
    } catch {
      data = {
        title: "老师讲解",
        blackboard: ["🧠 重点：AI返回格式异常，请再试一次"],
        segments: [
          {
            heading: "老师",
            text: response.text || "老师刚刚没有组织好语言，我们重新来一次。",
          },
        ],
        nextAction: "continue",
      };
    }

    if (!Array.isArray(data.segments) || data.segments.length === 0) {
      data.segments = [
        {
          heading: "老师",
          text: "我们重新来。这个语法可以先从核心感觉理解，不要死背中文翻译。",
        },
      ];
    }

    data.segments = data.segments.map((s) => ({
      heading: s.heading || "老师",
      text:
        s.text && s.text.trim()
          ? s.text
          : "这里老师刚刚没有说完整，我们换一种方式重新讲。",
    }));

    if (!Array.isArray(data.blackboard) || data.blackboard.length === 0) {
      data.blackboard = ["🧠 核心感觉：先理解语法的使用场景"];
    }

    res.json(data);
  } catch (error) {
    console.error("classroom error:", error);
    res.status(500).json({ error: "AI classroom request failed" });
  }
});

app.post("/api/audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required" });
    }

    const base64Audio = req.file.buffer.toString("base64");

    const response = await ai.models.generateContent({
      model: AUDIO_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: req.file.mimetype || "audio/webm",
                data: base64Audio,
              },
            },
            {
              text: "请把这段语音准确转写成文字。可能是中文、日语或中日混合。只输出转写文字。",
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 200,
        thinkingConfig: {
          thinkingLevel: "minimal",
        },
      },
    });

    res.json({ text: response.text || "" });
  } catch (error) {
    console.error("audio error:", error);
    res.status(500).json({ error: "audio request failed" });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          parts: [
            {
              text: `请用中文日语老师的自然语气朗读下面内容。中文部分用自然中文，日语例句用标准日语发音。不要朗读标题，只自然说正文。语速略快，有节奏。\n\n${text}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Kore",
            },
          },
        },
      },
    });

    const pcmBase64 =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!pcmBase64) {
      return res.status(500).json({ error: "no audio returned" });
    }

    res.json({
      audio: pcmToWavBase64(pcmBase64),
      mimeType: "audio/wav",
    });
  } catch (error) {
    console.error("tts error:", error);
    res.status(500).json({ error: "tts request failed" });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`AI Japanese Teacher server running on port ${PORT}`);
});