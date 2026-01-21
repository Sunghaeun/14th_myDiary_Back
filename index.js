// index.js
// Render 배포용 간단 백엔드 (Express)
// - PORT는 Render가 process.env.PORT로 주입함
// - DB 없이 메모리(in-memory)로 동작: 서버 재시작 시 데이터 초기화됨

const express = require("express");
const cors = require("cors");
const axios = require("axios"); // ✅ 추가

const app = express();
app.use(cors());
app.use(express.json());

// --------------------
// In-memory "DB"
// --------------------
let nextMemberId = 1;

// email -> { memberId, name, email, password }
const membersByEmail = new Map();

// email -> isLogined(0/1)
const loginState = new Map();

// date(YYYY-MM-DD) -> { todo: [], contents: string, thanks: string }
const diaryByDate = new Map();

// --------------------
// Helpers
// --------------------
function isValidString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeDate(date) {
  if (!isValidString(date)) return null;
  const s = date.trim();
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
  return ok ? s : null;
}

function normalizeTodo(todo) {
  if (Array.isArray(todo)) {
    return todo
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => x.length > 0);
  }
  if (typeof todo === "string") {
    return todo
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [];
}

function getHaveArrays() {
  const haveContents = [];
  const haveTodos = [];

  for (const [date, entry] of diaryByDate.entries()) {
    if (isValidString(entry.contents)) haveContents.push(date);
    if (Array.isArray(entry.todo) && entry.todo.length > 0) haveTodos.push(date);
  }

  haveContents.sort();
  haveTodos.sort();

  return { haveContents, haveTodos };
}

// --------------------
// Routes
// --------------------
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

// 회원가입
app.post("/SignUp", (req, res) => {
  const { email, name, password } = req.body || {};

  if (!isValidString(email) || !isValidString(name) || !isValidString(password)) {
    return res.status(400).json({ error: "email, name, password are required" });
  }

  const key = email.trim().toLowerCase();
  if (membersByEmail.has(key)) {
    return res.status(409).json({ error: "email already exists" });
  }

  const member = {
    memberId: nextMemberId++,
    name: name.trim(),
    email: key,
    password: String(password),
  };

  membersByEmail.set(key, member);
  loginState.set(key, 0);

  return res.json({
    memberId: member.memberId,
    name: member.name,
    email: member.email,
  });
});

// 일반 로그인
app.post("/Login", (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidString(email) || !isValidString(password)) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const key = email.trim().toLowerCase();
  const member = membersByEmail.get(key);

  if (!member || String(member.password) !== String(password)) {
    return res.status(401).json({ error: "invalid credentials", isLogined: 0 });
  }

  loginState.set(key, 1);

  return res.json({
    message: `반갑습니다, ${member.name} 님!`,
    isLogined: 1,
  });
});

// --------------------
// ✅ 구글 로그인 (code 방식)
// POST /Login/google
// body: { code }
// --------------------
// ✅ 구글 로그인 (code 방식) - JSON body로 token 교환
// POST /auth/google
// body: { code }
app.post("/auth/google", async (req, res) => {
  console.log("HIT /auth/google", req.body);

  const { code } = req.body || {};
  if (!isValidString(code)) {
    return res.status(400).json({ message: "code 없음" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!isValidString(clientId) || !isValidString(clientSecret) || !isValidString(redirectUri)) {
    return res.status(500).json({
      message: "Google env vars missing",
      detail: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI 확인 필요",
    });
  }

  try {
    // 1) code -> access_token 교환 (JSON 형식)
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        code: String(code).trim(),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri, // ⭐️ 반드시 프론트에서 code 만들 때 쓴 redirect_uri와 동일
        grant_type: "authorization_code",
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    const { access_token } = tokenRes.data || {};
    if (!access_token) {
      return res.status(401).json({
        message: "no access_token from google",
        detail: tokenRes.data,
      });
    }

    // 2) userinfo 가져오기
    const userRes = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { email, name } = userRes.data || {};
    if (!email) {
      return res.status(401).json({ message: "email not found from userinfo" });
    }

    const key = String(email).toLowerCase();
    const displayName = isValidString(name) ? name : "Google User";

    // 3) 회원 없으면 자동 회원가입
    if (!membersByEmail.has(key)) {
      const member = {
        memberId: nextMemberId++,
        name: displayName,
        email: key,
        password: null,
      };
      membersByEmail.set(key, member);
      loginState.set(key, 0);
    } else {
      // 기존 회원인데 이름 비어있으면 갱신(선택)
      const m = membersByEmail.get(key);
      if (m && !isValidString(m.name)) m.name = displayName;
    }

    // 4) 로그인 처리
    loginState.set(key, 1);
    const member = membersByEmail.get(key);

    return res.json({
      message: `반갑습니다, ${member.name} 님!`,
      isLogined: 1,
      memberId: member.memberId,
      email: member.email,
    });
  } catch (err) {
    console.error("Google OAuth 실패:", err.response?.data || err.message);
    return res.status(500).json({
      message: "Google OAuth 실패",
      detail: err.response?.data || err.message,
    });
  }
});


// 로그아웃
app.post("/Home", (req, res) => {
  const { email } = req.body || {};
  if (isValidString(email)) {
    const key = email.trim().toLowerCase();
    if (loginState.has(key)) loginState.set(key, 0);
  }
  return res.json({ isLogined: 0 });
});

// 달력에 할일/일기 존재 여부 표시
app.get("/Home", (req, res) => {
  const { haveContents, haveTodos } = getHaveArrays();
  return res.json({ haveContents, haveTodos });
});

// 다이어리 추가
app.post("/diary/:date", (req, res) => {
  const date = normalizeDate(req.params.date);
  if (!date) return res.status(400).json({ error: "invalid date format (YYYY-MM-DD)" });

  const { todo, contents, thanks } = req.body || {};
  const todoArr = normalizeTodo(todo);

  const entry = {
    todo: todoArr,
    contents: isValidString(contents) ? contents.trim() : "",
    thanks: isValidString(thanks) ? thanks.trim() : "",
  };

  diaryByDate.set(date, entry);

  return res.json({
    haveContents: isValidString(entry.contents),
    haveTodos: Array.isArray(entry.todo) && entry.todo.length > 0,
  });
});

// 다이어리 불러오기
app.get("/diary/:date", (req, res) => {
  const date = normalizeDate(req.params.date);
  if (!date) return res.status(400).json({ error: "invalid date format (YYYY-MM-DD)" });

  const entry = diaryByDate.get(date) || { todo: [], contents: "", thanks: "" };
  return res.json(entry);
});

// 다이어리 수정
app.put("/diary/:date", (req, res) => {
  const date = normalizeDate(req.params.date);
  if (!date) return res.status(400).json({ error: "invalid date format (YYYY-MM-DD)" });

  const prev = diaryByDate.get(date) || { todo: [], contents: "", thanks: "" };
  const { todo, contents, thanks } = req.body || {};

  const updated = {
    todo: todo === undefined ? prev.todo : normalizeTodo(todo),
    contents: contents === undefined ? prev.contents : (isValidString(contents) ? contents.trim() : ""),
    thanks: thanks === undefined ? prev.thanks : (isValidString(thanks) ? thanks.trim() : ""),
  };

  diaryByDate.set(date, updated);

  return res.json({
    haveContents: isValidString(updated.contents),
    haveTodos: Array.isArray(updated.todo) && updated.todo.length > 0,
  });
});

// --------------------
// Server start (Render용)
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});
