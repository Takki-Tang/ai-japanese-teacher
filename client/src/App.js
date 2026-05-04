import React, { useMemo, useRef, useState } from "react";

const API_BASE = "https://ai-japanese-teacher-production.up.railway.app";

export default function App() {
  const [grammarPoint, setGrammarPoint] = useState("〜べきだ");
  const [studentInput, setStudentInput] = useState("");
  const [lesson, setLesson] = useState(null);
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState("lesson");
  const [loading, setLoading] = useState(false);
  const [ttsStatus, setTtsStatus] = useState("");
  const [error, setError] = useState("");

  const audioRef = useRef(null);

  const teacherText = useMemo(() => {
    if (!lesson?.segments) return "";
    return lesson.segments.map((s) => s.text).join("\n");
  }, [lesson]);

  async function callLesson(nextMode) {
    setLoading(true);
    setError("");
    setTtsStatus("");
    setMode(nextMode);

    try {
      const res = await fetch(`${API_BASE}/api/lesson`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grammarPoint,
          studentInput: nextMode === "lesson" ? "" : studentInput,
          mode: nextMode,
          history,
        }),
      });

      const data = await res.json();

      const nextLesson = data.lesson;
      setLesson(nextLesson);

      setHistory([
        ...history,
        { role: "student", text: studentInput },
        { role: "teacher", text: teacherText },
      ]);

      setStudentInput("");

      await playTTS(nextLesson);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function playTTS(lesson) {
    const text = lesson?.segments
      ?.slice(0, 3) // ⭐ 只读前3句
      .map((s) => s.text)
      .join("\n");

    if (!text) return;

    setTtsStatus("AI语音生成中...");

    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!data.audioBase64) throw new Error();

      const audio = new Audio(
        `data:${data.mimeType};base64,${data.audioBase64}`
      );

      audioRef.current = audio;
      await audio.play();

      setTtsStatus("");
    } catch {
      setTtsStatus("AI语音暂时不可用（正常情况，已只显示字幕）");
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>AI日语老师</h1>

      <input
        value={grammarPoint}
        onChange={(e) => setGrammarPoint(e.target.value)}
      />

      <button onClick={() => callLesson("lesson")}>开始</button>

      <div style={{ display: "grid", gridTemplateColumns: "520px 1fr", gap: 20 }}>
        <div style={{ background: "#173f2f", color: "#fff", padding: 20 }}>
          <h2>{lesson?.title}</h2>
          {lesson?.blackboard?.map((b, i) => (
            <div key={i}>{b}</div>
          ))}
        </div>

        <div>
          {lesson?.segments?.map((s, i) => (
            <div key={i}>{s.text}</div>
          ))}

          <textarea
            value={studentInput}
            onChange={(e) => setStudentInput(e.target.value)}
          />

          <button onClick={() => callLesson("chat")}>提交</button>
        </div>
      </div>

      <div>{ttsStatus}</div>
    </div>
  );
}