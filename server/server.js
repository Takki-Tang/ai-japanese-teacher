import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * 调用 Gemini（不使用 SDK，直接 HTTP）
 */
async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    }
  );

  const data = await res.json();

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/**
 * 课堂接口
 */
app.post("/api/classroom", async (req, res) => {
  try {
    const { grammar, message } = req.body;

    const prompt = `
你是一个非常优秀的日语老师。

教学要求：
- 用中文讲解
- 必须通俗易懂（像真人老师）
- 有层次、有逻辑
- 必须举多个例句（动词 / 名词 / 形容词）
- 可以适当使用日语原句 + 中文解释
- 语气自然，不要机械

语法点：${grammar}
学生输入：${message || "无"}

请开始教学。
`;

    const text = await callGemini(prompt);

    res.json({
      board: `🧠 今日语法：${grammar}\n👉 重点总结请看右侧讲解`,
      speech: text,
    });
  } catch (err) {
    console.error("classroom error:", err);
    res.status(500).json({ error: "AI 出错了" });
  }
});

/**
 * TTS（先简单返回文本，让前端读）
 */
app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;

    res.json({
      audio: null, // 先不用真实音频
      text,
    });
  } catch (err) {
    console.error("tts error:", err);
    res.status(500).json({ error: "TTS 出错" });
  }
});

/**
 * 健康检查
 */
app.get("/", (req, res) => {
  res.send("AI Japanese Teacher API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});