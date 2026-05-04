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
    const gp = grammarPoint.trim();
    if (!gp) {
      setError("先输入一个语法点，比如：〜べきだ");
      return;
    }

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
          grammarPoint: gp,
          studentInput: nextMode === "lesson" ? "" : studentInput.trim(),
          mode: nextMode,
          history,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || data?.error || "AI课堂生成失败");
      }

      const nextLesson = data.lesson;
      setLesson(nextLesson);

      const newHistory = [
        ...history,
        {
          role: "student",
          text: nextMode === "lesson" ? `请讲解 ${gp}` : studentInput.trim(),
        },
        {
          role: "teacher",
          text: nextLesson.segments.map((s) => s.text).join("\n"),
        },
      ].slice(-12);

      setHistory(newHistory);
      setStudentInput("");

      await playAiTtsOnce(nextLesson);
    } catch (e) {
      setError(e.message || "出错了");
    } finally {
      setLoading(false);
    }
  }

  async function playAiTtsOnce(nextLesson) {
    const text = nextLesson?.segments?.map((s) => s.text).join("\n").trim();

    if (!text) return;

    setTtsStatus("AI语音生成中……");

    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok || !data.audioBase64) {
        throw new Error("TTS quota 或接口限制，已只显示字幕。");
      }

      const audioUrl = `data:${data.mimeType};base64,${data.audioBase64}`;

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      await audio.play();

      setTtsStatus("AI语音播放中");
      audio.onended = () => setTtsStatus("");
    } catch (e) {
      setTtsStatus("AI语音暂时不可用，已只显示字幕，不使用浏览器机器朗读。");
    }
  }

  function resetClass() {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setLesson(null);
    setHistory([]);
    setStudentInput("");
    setError("");
    setTtsStatus("");
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>AI日语老师</h1>
          <p style={styles.sub}>
            系统只做壳子，教学逻辑全部交给 AI。
          </p>
        </div>

        <button style={styles.smallButton} onClick={resetClass}>
          重置课堂
        </button>
      </div>

      <div style={styles.controls}>
        <input
          style={styles.input}
          value={grammarPoint}
          onChange={(e) => setGrammarPoint(e.target.value)}
          placeholder="输入语法点，例如：〜べきだ"
        />

        <button
          style={styles.primaryButton}
          onClick={() => callLesson("lesson")}
          disabled={loading}
        >
          {loading && mode === "lesson" ? "生成中..." : "开始讲课"}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {ttsStatus && <div style={styles.tts}>{ttsStatus}</div>}

      <div style={styles.main}>
        <section style={styles.blackboard}>
          <h2 style={styles.boardTitle}>
            {lesson?.title || "黑板"}
          </h2>

          {lesson?.blackboard?.length ? (
            <ul style={styles.boardList}>
              {lesson.blackboard.map((item, index) => (
                <li key={index} style={styles.boardItem}>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <div style={styles.emptyBoard}>
              输入语法点后，AI 会把真正有用的重点写在这里。
            </div>
          )}
        </section>

        <section style={styles.teacherPanel}>
          <h2 style={styles.teacherTitle}>老师旁白</h2>

          <div style={styles.subtitleBox}>
            {lesson?.segments?.length ? (
              lesson.segments.map((seg, index) => (
                <div key={index} style={styles.bubble}>
                  {seg.text}
                </div>
              ))
            ) : (
              <div style={styles.emptySubtitle}>
                这里会像字幕/聊天消息一样显示老师真正说的话。
              </div>
            )}
          </div>

          <div style={styles.chatBox}>
            <textarea
              style={styles.textarea}
              value={studentInput}
              onChange={(e) => setStudentInput(e.target.value)}
              placeholder="可以提问，也可以造句让老师批改。例如：私は毎日勉強するべきだ。"
            />

            <button
              style={styles.secondaryButton}
              onClick={() => callLesson("chat")}
              disabled={loading || !studentInput.trim()}
            >
              {loading && mode === "chat" ? "批改中..." : "发送给老师"}
            </button>
          </div>
        </section>
      </div>

      <div style={styles.footer}>
        后端：{API_BASE} / Railway 修改后记得点紫色 Deploy
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f1e8",
    padding: "24px",
    boxSizing: "border-box",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif',
    color: "#222",
  },
  header: {
    maxWidth: "1180px",
    margin: "0 auto 18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
  },
  h1: {
    margin: 0,
    fontSize: "32px",
  },
  sub: {
    margin: "6px 0 0",
    color: "#666",
  },
  controls: {
    maxWidth: "1180px",
    margin: "0 auto 18px",
    display: "flex",
    gap: "12px",
  },
  input: {
    flex: 1,
    fontSize: "18px",
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid #ddd",
    outline: "none",
    background: "#fff",
  },
  primaryButton: {
    padding: "0 24px",
    border: "none",
    borderRadius: "14px",
    background: "#222",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
  },
  secondaryButton: {
    width: "150px",
    border: "none",
    borderRadius: "14px",
    background: "#2f6f4e",
    color: "#fff",
    fontSize: "15px",
    cursor: "pointer",
  },
  smallButton: {
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
  },
  main: {
    maxWidth: "1180px",
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "420px 1fr",
    gap: "18px",
  },
  blackboard: {
    minHeight: "620px",
    borderRadius: "22px",
    background: "#173f2f",
    color: "#f7f3df",
    padding: "26px",
    boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
  },
  boardTitle: {
    margin: "0 0 20px",
    fontSize: "26px",
    borderBottom: "1px solid rgba(255,255,255,0.35)",
    paddingBottom: "12px",
  },
  boardList: {
    margin: 0,
    paddingLeft: "20px",
  },
  boardItem: {
    fontSize: "18px",
    lineHeight: 1.75,
    marginBottom: "14px",
  },
  emptyBoard: {
    color: "rgba(255,255,255,0.75)",
    lineHeight: 1.7,
  },
  teacherPanel: {
    minHeight: "620px",
    borderRadius: "22px",
    background: "#fff",
    padding: "22px",
    boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
    display: "flex",
    flexDirection: "column",
  },
  teacherTitle: {
    margin: "0 0 14px",
    fontSize: "24px",
  },
  subtitleBox: {
    flex: 1,
    overflowY: "auto",
    background: "#f7f7f7",
    borderRadius: "18px",
    padding: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "88%",
    background: "#ffffff",
    border: "1px solid #eee",
    borderRadius: "18px",
    padding: "13px 16px",
    fontSize: "17px",
    lineHeight: 1.65,
    boxShadow: "0 4px 14px rgba(0,0,0,0.05)",
    whiteSpace: "pre-wrap",
  },
  emptySubtitle: {
    color: "#777",
    lineHeight: 1.7,
  },
  chatBox: {
    marginTop: "16px",
    display: "flex",
    gap: "12px",
  },
  textarea: {
    flex: 1,
    height: "84px",
    resize: "none",
    borderRadius: "14px",
    border: "1px solid #ddd",
    padding: "12px 14px",
    fontSize: "15px",
    outline: "none",
    fontFamily: "inherit",
  },
  error: {
    maxWidth: "1180px",
    margin: "0 auto 12px",
    background: "#ffe8e8",
    color: "#9b1c1c",
    padding: "12px 14px",
    borderRadius: "12px",
  },
  tts: {
    maxWidth: "1180px",
    margin: "0 auto 12px",
    background: "#eef3ff",
    color: "#24427a",
    padding: "12px 14px",
    borderRadius: "12px",
  },
  footer: {
    maxWidth: "1180px",
    margin: "16px auto 0",
    color: "#777",
    fontSize: "13px",
  },
};