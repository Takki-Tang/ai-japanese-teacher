import { useState, useRef } from "react";
import "./App.css";

function App() {
  const [mode, setMode] = useState("lesson");
  const [grammar, setGrammar] = useState("〜わけではない");
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
  const [recording, setRecording] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [statusText, setStatusText] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const audioListRef = useRef([]);
  const stopFlagRef = useRef(false);
  const playSessionRef = useRef(0);

  const hardStopAllAudio = () => {
    playSessionRef.current += 1;
    stopFlagRef.current = true;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const stopVoice = () => {
    hardStopAllAudio();
    setPaused(true);
    setStatusText("讲解已暂停。");
  };

  const speakWithBrowserFallback = (text, sessionId) => {
    return new Promise((resolve) => {
      if (sessionId !== playSessionRef.current) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-CN";
      utter.rate = 1.08;
      utter.pitch = 1;

      utter.onend = resolve;
      utter.onerror = resolve;

      window.speechSynthesis.speak(utter);
    });
  };

  const createAudioForSegment = async (segment) => {
    const text = `${segment.heading}。${segment.text}`;

    const res = await fetch("https://ai-japanese-teacher-production.up.railway.app/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const data = await res.json();

    if (!data.audio) {
      throw new Error("no audio");
    }

    return new Audio(`data:audio/wav;base64,${data.audio}`);
  };

  const playAudio = (audio, sessionId) => {
    return new Promise((resolve, reject) => {
      if (sessionId !== playSessionRef.current) {
        resolve();
        return;
      }

      audioRef.current = audio;
      audio.playbackRate = 1.15;
      audio.onended = resolve;
      audio.onerror = reject;
      audio.play().catch(reject);
    });
  };

  const playSegmentsFrom = async (list, startIndex = 0, reuseAudio = false) => {
    hardStopAllAudio();

    const sessionId = playSessionRef.current;
    stopFlagRef.current = false;
    setSpeaking(true);
    setPaused(false);

    let audioList = audioListRef.current;
    let useAiVoice = true;

    try {
      if (!reuseAudio || audioList.length !== list.length) {
        setStatusText("老师正在准备语音……");

        try {
          audioList = await Promise.all(
            list.map((segment) => createAudioForSegment(segment))
          );
          audioListRef.current = audioList;
        } catch (error) {
          console.error("AI voice failed, fallback to browser voice:", error);
          useAiVoice = false;
          audioListRef.current = [];
        }

        if (sessionId !== playSessionRef.current) return;
      }

      setStatusText("");

      for (let i = startIndex; i < list.length; i++) {
        if (stopFlagRef.current) break;
        if (sessionId !== playSessionRef.current) break;

        setCurrentSegmentIndex(i);
        setShownSubtitleCount(i + 1);

        const segment = list[i];
        const text = `${segment.heading}。${segment.text}`;

        if (useAiVoice && audioList[i]) {
          const audio = audioList[i];
          audio.currentTime = 0;
          await playAudio(audio, sessionId);
        } else {
          await speakWithBrowserFallback(text, sessionId);
        }
      }
    } finally {
      if (sessionId === playSessionRef.current) {
        setSpeaking(false);
      }
    }
  };

  const continueVoice = async () => {
    if (speaking || loading || recording) return;
    await playSegmentsFrom(segments, currentSegmentIndex, true);
  };

  const callTeacher = async (studentText, customHistory = history, customMode = mode) => {
    if (loading || recording) return;

    hardStopAllAudio();
    audioListRef.current = [];
    setPaused(false);
    setLoading(true);
    setStatusText(customMode === "chat" ? "老师正在想怎么跟你聊……" : "老师思考中……");

    try {
      const res = await fetch("https://ai-japanese-teacher-production.up.railway.app/api/classroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grammarPoint: grammar,
          level: "N3",
          history: customHistory,
          studentInput: studentText || "お願いします",
          mode: customMode,
        }),
      });

      const data = await res.json();

      const newSegments = Array.isArray(data.segments)
        ? data.segments
        : [{ heading: "老师讲解", text: data.subtitle || "" }];

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

      await playSegmentsFrom(newSegments, 0, false);
    } catch (error) {
      console.error(error);
      setSegments([
        {
          heading: "错误",
          text: "AI请求失败。请确认后端 server 是否正在运行。",
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
    audioListRef.current = [];
    setPaused(false);
    setHistory(freshHistory);
    setBlackboard([]);
    setTitle("");
    setSegments([{ heading: "准备中", text: "老师准备中……" }]);
    setCurrentSegmentIndex(0);
    setShownSubtitleCount(1);
    setRecognizedText("");
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
    audioListRef.current = [];
    setPaused(false);
    setStatusText("");

    if (nextMode === "chat") {
      setBlackboard([
        "☕ 课间聊聊：日本文化 / 旅游 / 思维方式",
        "💡 可以问：日本人为什么这样说？",
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
          text: "好，我们回到刚才的语法课。你可以点击「下一步」继续，或者直接问我刚才没听懂的地方。",
        },
      ]);
      setCurrentSegmentIndex(0);
      setShownSubtitleCount(1);
    }
  };

  const startRecording = async () => {
    if (loading || recording || speaking) return;

    try {
      hardStopAllAudio();
      audioListRef.current = [];
      setPaused(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setRecording(false);

        const audioBlob = new Blob(chunksRef.current, {
          type: "audio/webm",
        });

        stream.getTracks().forEach((track) => track.stop());

        const formData = new FormData();
        formData.append("audio", audioBlob, "voice.webm");

        setLoading(true);
        setStatusText("正在让 AI 听你的语音……");

        try {
          const res = await fetch("https://ai-japanese-teacher-production.up.railway.app/api/audio", {
            method: "POST",
            body: formData,
          });

          const data = await res.json();
          const text = data.text || "";

          setRecognizedText(text);

          if (!text.trim()) {
            setSegments([
              { heading: "语音识别", text: "没有识别到内容，请再说一次。" },
            ]);
            setLoading(false);
            setStatusText("");
            return;
          }

          setLoading(false);
          setStatusText("");
          await callTeacher(text, history, mode);
        } catch (error) {
          console.error(error);
          setSegments([
            { heading: "错误", text: "语音上传或 AI 识别失败。" },
          ]);
          setLoading(false);
          setStatusText("");
        }
      };

      mediaRecorder.start();
      setRecording(true);
      setSegments([
        { heading: "录音中", text: "请开始说话。说完后点击「停止录音」。" },
      ]);
      setCurrentSegmentIndex(0);
      setShownSubtitleCount(1);
    } catch (error) {
      console.error(error);
      setSegments([
        {
          heading: "麦克风错误",
          text: "无法使用麦克风。请确认浏览器已经允许麦克风权限。",
        },
      ]);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const visibleSubtitles = segments.slice(
    Math.max(0, shownSubtitleCount - 4),
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
          <button onClick={startClass} disabled={loading || recording}>
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
              const realIndex = Math.max(0, shownSubtitleCount - 4) + index;
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

          {recognizedText && (
            <div className="recognized">识别内容：{recognizedText}</div>
          )}
        </section>
      </main>

      <footer className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === "chat"
              ? "问点日本文化、旅游、职场、生活习惯..."
              : "打字用（可选）"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              sendMessage();
            }
          }}
        />

        <button onClick={sendMessage} disabled={loading || recording}>
          发送
        </button>

        {!recording ? (
          <button onClick={startRecording} disabled={loading || speaking}>
            语音
          </button>
        ) : (
          <button onClick={stopRecording} className="stop-button">
            停止录音
          </button>
        )}

        {!paused ? (
          <button
            onClick={stopVoice}
            className="stop-button"
            disabled={!speaking}
          >
            停止讲解
          </button>
        ) : (
          <button onClick={continueVoice} disabled={loading || recording}>
            继续讲解
          </button>
        )}

        <button onClick={nextStep} disabled={loading || recording}>
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