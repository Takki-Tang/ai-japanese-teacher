import { useState, useRef } from "react";
import "./App.css";

const API_BASE = "https://ai-japanese-teacher-production.up.railway.app";

function App() {
  const [mode, setMode] = useState("lesson");
  const [grammar, setGrammar] = useState("〜べきだ");
  const [blackboard, setBlackboard] = useState([]);
  const [title, setTitle] = useState("");
  const [segments, setSegments] = useState([
    { heading: "准备", text: "语法点输入后，点击「开始」。" },
  ]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [shownSubtitleCount, setShownSubtitleCount] = useState(1);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [statusText, setStatusText] = useState("");

  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const playSessionRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const hardStopAllAudio = () => {
    playSessionRef.current += 1;
    clearTimer();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setSpeaking(false);
  };

  const stopVoice = () => {
    hardStopAllAudio();
    setPaused(true);
    setStatusText("讲解已暂停。");
  };

  const playWholeAudioWithSubtitles = async (list, speechText) => {
    hardStopAllAudio();

    const sessionId = playSessionRef.current;
    setSpeaking(true);
    setPaused(false);
    setStatusText("老师正在生成语音……");

    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: speechText })
      });

      const data = await res.json();

      if (!res.ok || !data.audio) {
        throw new Error(data.detail || "语音额度暂时用完，请稍后再试。");
      }

      if (sessionId !== playSessionRef.current) return;

      const audio = new Audio(`data:audio/wav;base64,${data.audio}`);
      audioRef.current = audio;
      audio.playbackRate = 1.05;

      audio.onloadedmetadata = () => {
        const total = Math.max(audio.duration || list.length * 4, list.length * 3);
        const step = Math.max(total / list.length, 2.2);

        let index = 0;
        setCurrentSegmentIndex(0);
        setShownSubtitleCount(1);
        setStatusText("");

        clearTimer();
        timerRef.current = setInterval(() => {
          if (sessionId !== playSessionRef.current) {
            clearTimer();
            return;
          }

          index += 1;

          if (index >= list.length) {
            clearTimer();
            return;
          }

          setCurrentSegmentIndex(index);
          setShownSubtitleCount(index + 1);
        }, step * 1000);
      };

      audio.onended = () => {
        clearTimer();
        if (sessionId === playSessionRef.current) {
          setCurrentSegmentIndex(list.length - 1);
          setShownSubtitleCount(list.length);
          setSpeaking(false);
          setStatusText("");
        }
      };

      audio.onerror = () => {
        clearTimer();
        setSpeaking(false);
        setStatusText("语音播放失败，请稍后再试。");
      };

      await audio.play();
    } catch (error) {
      console.error(error);
      setSpeaking(false);
      setStatusText(error.message || "语音生成失败，请稍后再试。");
    }
  };

  const continueVoice = async () => {
    setStatusText("当前版本暂停后请点击“下一步”继续。");
  };

  const callTeacher = async (studentText, customHistory = history, customMode = mode) => {
    if (loading) return;

    hardStopAllAudio();
    setPaused(false);
    setLoading(true);
    setStatusText(customMode === "chat" ? "老师正在想怎么跟你聊……" : "老师思考中……");

    try {
      const res = await fetch(`${API_BASE}/api/classroom`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          grammarPoint: grammar,
          level: "N3",
          history: customHistory,
          studentInput: studentText || "お願いします",
          mode: customMode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "AI请求失败");
      }

      const newSegments = Array.isArray(data.segments) ? data.segments : [];

      setTitle(data.title || "");
      setBlackboard(data.blackboard || []);
      setSegments(newSegments);
      setCurrentSegmentIndex(0);
      setShownSubtitleCount(1);

      const fullTeacherText = newSegments
        .map((item) => `${item.heading}: ${item.text}`)
        .join("\n");

      const newHistory = [
        ...customHistory,
        { role: "student", text: studentText || "お願いします" },
        { role: "teacher", text: fullTeacherText },
      ];

      setHistory(newHistory);
      setInput("");
      setLoading(false);
      setStatusText("");

      await playWholeAudioWithSubtitles(newSegments, data.speechText || fullTeacherText);
    } catch (error) {
      console.error(error);
      setSegments([
        {
          heading: "错误",
          text: error.message || "AI请求失败。",
        },
      ]);
      setLoading(false);
      setStatusText("");
    }
  };

  const startClass = () => {
    const freshHistory = [];
    setMode("lesson");
    hardStopAllAudio();
    setPaused(false);
    setHistory(freshHistory);
    setBlackboard([]);
    setTitle("");
    setSegments([{ heading: "准备中", text: "老师准备中……" }]);
    setCurrentSegmentIndex(0);
    setShownSubtitleCount(1);
    callTeacher("お願いします", freshHistory, "lesson");
  };

  const sendMessage = () => {
    if (!input.trim()) return;
    callTeacher(input.trim(), history, mode);
  };

  const nextStep = () => {
    callTeacher(
      mode === "chat" ? "请继续自然聊下去。" : "请自然继续下一步。",
      history,
      mode
    );
  };

  const toggleChatMode = () => {
    const nextMode = mode === "lesson" ? "chat" : "lesson";
    setMode(nextMode);
    hardStopAllAudio();
    setPaused(false);
    setStatusText("");

    if (nextMode === "chat") {
      setBlackboard([
        "☕ 课间聊聊：日本文化 / 旅游 / 思维方式",
        "💡 可以问：日本人为什么这样说",
        "🗣️ 也可以聊：日常表达、职场、旅行",
      ]);
      setTitle("课间聊聊");
      setSegments([
        {
          heading: "课间模式",
          text: "好，我们先放松一下。你可以问我日本文化、日本人的思维方式、旅游、职场、生活习惯，或者任何你对日本好奇的事情。",
        },
      ]);
      setCurrentSegmentIndex(0);
      setShownSubtitleCount(1);
    } else {
      setTitle("回到课堂");
      setSegments([
        {
          heading: "回到课堂",
          text: "好，我们回到刚才的语法课。你可以点击下一步继续，也可以直接问我刚才没听懂的地方。",
        },
      ]);
      setCurrentSegmentIndex(0);
      setShownSubtitleCount(1);
    }
  };

  const startRecording = () => {
    setStatusText("语音输入暂时关闭，先用打字回答。");
  };

  const visibleSubtitles = segments.slice(
    Math.max(0, shownSubtitleCount - 5),
    shownSubtitleCount
  );

  return (
    <div className="app">
      <header className="header">
        <h1>AI日语老师</h1>

        <div className="grammar-box">
          <input
            value={grammar}
            onChange={(e) => setGrammar(e.target.value)}
            placeholder="输入语法点"
          />
          <button onClick={startClass} disabled={loading}>
            开始
          </button>
        </div>
      </header>

      <main className="classroom">
        <section className="blackboard">
          <div className="board-title">
            {mode === "chat" ? "☕ 课间黑板" : "今日の黒板"}
          </div>

          {blackboard.length === 0 ? (
            <div className="empty">这里显示黑板重点</div>
          ) : (
            <div className="board-list">
              {blackboard.map((item, index) => (
                <div key={index} className="board-card">
                  {item}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="teacher">
          <div className="teacher-top">
            <div>
              <div className="teacher-label">
                {mode === "chat" ? "课间聊天字幕" : "先生の字幕"}
              </div>
              {title && <div className="lesson-title">{title}</div>}
            </div>
            {statusText && <div className="status-pill">{statusText}</div>}
          </div>

          <div className="subtitle-window">
            {visibleSubtitles.map((segment, index) => {
              const realIndex = Math.max(0, shownSubtitleCount - 5) + index;
              const active = realIndex === currentSegmentIndex;

              return (
                <div
                  key={`${segment.heading}-${realIndex}`}
                  className={active ? "subtitle-line active" : "subtitle-line"}
                >
                  <div className="subtitle-heading">{segment.heading}</div>
                  <div className="subtitle-text">{segment.text}</div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === "chat"
              ? "问点日本文化、旅游、职场、生活习惯..."
              : "打字回答或造句"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage();
          }}
        />

        <button onClick={sendMessage} disabled={loading}>
          发送
        </button>

        <button onClick={startRecording} disabled={loading || speaking}>
          语音
        </button>

        {!paused ? (
          <button
            onClick={stopVoice}
            className="stop-button"
            disabled={!speaking}
          >
            停止讲解
          </button>
        ) : (
          <button onClick={continueVoice} disabled={loading}>
            继续讲解
          </button>
        )}

        <button onClick={nextStep} disabled={loading}>
          下一步
        </button>

        <button onClick={toggleChatMode} className="chat-button">
          {mode === "lesson" ? "☕ 课间聊聊" : "📘 回到课堂"}
        </button>
      </footer>
    </div>
  );
}

export default App;