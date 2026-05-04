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

const TEXT_MODEL = "gemini-2.0-flash";

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
          maxOutputTokens: 1200,
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

规则：
- 中文为主，轻松自然。
- 可以聊日本文化、日本人思维、旅游、职场、生活习惯。
- 不要出题。
- 不要强行回到语法。
- 可以顺带讲一点日语小知识。
- segments 的 text 必须有完整正文。

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
      "text": "这里写完整回答。"
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
- 不要只返回标题。
- 每个 segments 的 text 必须有完整正文，不能为空。
- 要像真人老师，有核心感觉，有例句，有层次。
- 黑板必须有 5 条以上重点，带 emoji。

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
  res.send("AI Japanese Teacher API is running. VERSION 2026-05-03-VERIFY");
});

app.get("/version", (req, res) => {
  res.json({
    version: "2026-05-03-VERIFY",
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    keyLength: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0
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

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        title: "老师讲解",
        blackboard: [
          "🧠 核心：先理解语法感觉",
          "💡 重点：不要死背中文翻译"
        ],
        segments: [
          {
            heading: "老师",
            text: rawText || "老师刚刚没有组织好语言，我们重新来一次。"
          }
        ],
        nextAction: "continue"
      };
    }

    if (!Array.isArray(data.segments) || data.segments.length === 0) {
      data.segments = [
        {
          heading: "老师",
          text: "我们重新来。这个语法先从核心感觉理解，不要死背中文翻译。"
        }
      ];
    }

    data.segments = data.segments.map((item) => ({
      heading: item.heading || "老师",
      text:
        item.text && item.text.trim()
          ? item.text
          : "老师刚刚没有说完整，我们换一种方式重新讲。"
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
  res.status(503).json({
    error: "AI TTS disabled temporarily, browser fallback will speak instead."
  });
});

app.post("/api/audio", upload.single("audio"), async (req, res) => {
  res.status(503).json({
    error: "Audio transcription disabled temporarily."
  });
});

app.listen(PORT, () => {
  console.log(`AI Japanese Teacher server running on port ${PORT}`);
  console.log(`Gemini key exists: ${Boolean(GEMINI_API_KEY)}`);
});