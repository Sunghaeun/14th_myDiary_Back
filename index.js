// index.js
// Render 배포용 간단 백엔드 (Express)
// - PORT는 Render가 process.env.PORT로 주입함
// - DB 없이 메모리(in-memory)로 동작: 서버 재시작 시 데이터 초기화됨

const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// --------------------
// In-memory "DB"
// --------------------
let nextMemberId = 1;

// email -> { memberId, name, email, password }
const membersByEmail = new Map();

// 간단 로그인 상태(세션/토큰 없이 구현)
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
  // 아주 단순 체크 (YYYY-MM-DD 형태만 허용)
  if (!isValidString(date)) return null;
  const s = date.trim();
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s);
  return ok ? s : null;
}

function normalizeTodo(todo) {
  // 입력이 배열이면 그대로(문자열만), 문자열이면 , 기준으로 배열화
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

  // 날짜 정렬
  haveContents.sort();
  haveTodos.sort();

  return { haveContents, haveTodos };
}

// --------------------
// Routes
// --------------------
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Server is running",
  });
});

// 회원가입
// POST /SignUp
// body: { email, name, password }
// res: { memberId, name, email }
app.post("/SignUp", (req, res) => {
  const { email, name, password } = req.body || {};

  if (!isValidString(email) || !isValidString(name) || !isValidString(password)) {
    return res.status(400).json({
      error: "email, name, password are required",
    });
  }

  const key = email.trim().toLowerCase();
  if (membersByEmail.has(key)) {
    return res.status(409).json({
      error: "email already exists",
    });
  }

  const member = {
    memberId: nextMemberId++,
    name: name.trim(),
    email: key,
    password: String(password), // 데모용: 해싱/암호화 안 함
  };

  membersByEmail.set(key, member);
  loginState.set(key, 0);

  return res.json({
    memberId: member.memberId,
    name: member.name,
    email: member.email,
  });
});

// 로그인
// POST /Login
// body: { email, password }
// res: { message: "...", isLogined: 1 }
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

// 구글 로그인
// POST /Login/google
// body: { idToken }
app.post("/Login/google", async (req, res) => {
  const { idToken } = req.body || {};

  if (!idToken) {
    return res.status(400).json({ error: "idToken is required" });
  }

  try {
    // 1. Google 토큰 검증
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name || "Google User";

    if (!email) {
      return res.status(400).json({ error: "email not found in token" });
    }

    const key = email.toLowerCase();

    // 2. 회원 없으면 자동 회원가입
    if (!membersByEmail.has(key)) {
      const member = {
        memberId: nextMemberId++,
        name,
        email: key,
        password: null, // 구글 로그인은 비밀번호 없음
      };
      membersByEmail.set(key, member);
      loginState.set(key, 0);
    }

    // 3. 로그인 처리
    loginState.set(key, 1);
    const member = membersByEmail.get(key);

    return res.json({
      message: `반갑습니다, ${member.name} 님!`,
      isLogined: 1,
      memberId: member.memberId,
      email: member.email,
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: "Invalid Google token" });
  }
});

// 로그아웃 (스크린샷에 /Home 라우트로 표시되어 있어서 그대로 구현)
// POST /Home
// body: { email }  (데모용: 어떤 유저를 로그아웃할지)
app.post("/Home", (req, res) => {
  const { email } = req.body || {};
  if (isValidString(email)) {
    const key = email.trim().toLowerCase();
    if (loginState.has(key)) loginState.set(key, 0);
  }
  return res.json({ isLogined: 0 });
});

// 달력에 할일/일기 존재 여부 표시
// GET /Home
// res: { haveContents:[...], haveTodos:[...] }
app.get("/Home", (req, res) => {
  const { haveContents, haveTodos } = getHaveArrays();
  return res.json({ haveContents, haveTodos });
});

// 다이어리 추가
// POST /diary/:date
// body: { todo, contents, thanks }
// res: { haveContents: true/false, haveTodos: true/false }
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
// GET /diary/:date
// res: { todo: [...], contents: "...", thanks: "..." }
app.get("/diary/:date", (req, res) => {
  const date = normalizeDate(req.params.date);
  if (!date) return res.status(400).json({ error: "invalid date format (YYYY-MM-DD)" });

  const entry = diaryByDate.get(date) || { todo: [], contents: "", thanks: "" };
  return res.json(entry);
});

// 다이어리 수정
// PUT /diary/:date
// body: { todo, contents, thanks }
// res: { haveContents: true/false, haveTodos: true/false }
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
