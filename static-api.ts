/* OEMS static API layer
 * ---------------------------------------------------------------------------
 * GitHub Pages can only serve static files, so the Express backend (server.ts)
 * cannot run there. This module re-implements every /api/* route in the browser
 * (data is kept in localStorage) by intercepting window.fetch. The React app
 * does not need to change.
 *
 * It is only active in the "pages" build (`vite build --mode pages`).
 * Normal `npm run dev` / `npm run build` keep using the real server.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSeedData } from './seed';

declare const __STATIC_API__: boolean;

const STORAGE_KEY = 'oems_data_v1';
const GEMINI_KEY_STORAGE = 'oems_gemini_api_key';
const GEMINI_MODEL_STORAGE = 'oems_gemini_model';

type Result = { status: number; body: any };
const ok = (body: any = {}): Result => ({ status: 200, body: { success: true, ...body } });
const fail = (status: number, error: string, extra: any = {}): Result => ({
  status,
  body: { success: false, error, ...extra },
});

// ---------------------------------------------------------------- storage --
function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn('[OEMS] Could not write to localStorage:', err);
  }
}
function safeRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function loadData(): any {
  try {
    const raw = safeGet(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.students) && Array.isArray(parsed.exams)) {
        parsed.attempts = parsed.attempts || [];
        parsed.auditLogs = parsed.auditLogs || [];
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[OEMS] Stored data was unreadable, restoring demo data.', err);
  }
  const seed = createSeedData();
  safeSet(STORAGE_KEY, JSON.stringify(seed));
  return seed;
}

let db: any = null;
function getDb(): any {
  if (!db) db = loadData();
  return db;
}
function saveData() {
  safeSet(STORAGE_KEY, JSON.stringify(getDb()));
}

function recordAudit(actor: string, action: string, targetId: string, details: string) {
  const d = getDb();
  d.auditLogs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    targetId,
    details,
  });
  if (d.auditLogs.length > 500) d.auditLogs = d.auditLogs.slice(0, 500);
  saveData();
}

// ----------------------------------------------------------------- routes --
type Handler = (m: RegExpMatchArray, body: any) => Result | Promise<Result>;
const routes: Array<[string, RegExp, Handler]> = [];
const route = (method: string, pattern: RegExp, handler: Handler) => routes.push([method, pattern, handler]);

route('GET', /^\/bootstrap$/, () => ok({ data: getDb() }));

route('POST', /^\/school$/, (_m, body) => {
  const d = getDb();
  d.school = { ...d.school, ...body };
  recordAudit('Administrator', 'school_updated', 'school', `School info updated: ${d.school.name}`);
  return ok({ school: d.school });
});

route('POST', /^\/login\/admin$/, (_m, body) => {
  const { username, password } = body;
  if (username === 'admin' && (password === 'admin123' || password === 'admin')) {
    recordAudit('admin', 'admin_login', 'admin', 'Administrator authenticated successfully.');
    return ok({ user: { role: 'admin', username: 'admin', fullName: 'School Administrator' } });
  }
  return fail(401, 'Invalid administrator credentials. (Default: admin / admin123)');
});

route('POST', /^\/login\/student$/, (_m, body) => {
  const d = getDb();
  const uname = String(body.username || '').trim().toLowerCase();
  const student = d.students.find(
    (s: any) => (s.username.toLowerCase() === uname || s.studentId.toLowerCase() === uname) && s.password === body.password
  );
  if (!student) return fail(401, 'Invalid username or password.');
  if (student.status === 'deactivated') {
    return fail(403, 'Your student account is currently deactivated. Please contact the examination administrator.');
  }
  recordAudit(student.fullName, 'student_login', student.id, `Student ${student.studentId} logged in.`);
  return ok({ user: { role: 'student', username: student.username, fullName: student.fullName, student } });
});

function nextStudentId(d: any): string {
  let n = 1000 + d.students.length + 1;
  const used = new Set(d.students.map((s: any) => String(s.studentId).toLowerCase()));
  while (used.has(`stu-${n}`)) n++;
  return `STU-${n}`;
}

route('POST', /^\/students$/, (_m, body) => {
  const d = getDb();
  const { id, studentId, fullName, username, password, classGrade, email, phone, gender, status, notes } = body;

  if (id) {
    const index = d.students.findIndex((s: any) => s.id === id);
    if (index === -1) return fail(404, 'Student not found');
    const cur = d.students[index];
    d.students[index] = {
      ...cur,
      studentId: studentId || cur.studentId,
      fullName: fullName || cur.fullName,
      username: username || cur.username,
      password: password || cur.password,
      classGrade: classGrade || cur.classGrade,
      email: email ?? cur.email,
      phone: phone ?? cur.phone,
      gender: gender ?? cur.gender,
      status: status ?? cur.status,
      notes: notes ?? cur.notes,
    };
    recordAudit('Administrator', 'student_updated', id, `Updated student record for ${d.students[index].fullName} (${d.students[index].studentId})`);
    return ok({ student: d.students[index] });
  }

  const uname = String(username || '').trim();
  if (!uname) return fail(400, 'A username is required.');
  if (d.students.some((s: any) => s.username.toLowerCase() === uname.toLowerCase())) {
    return fail(400, 'A student with this username already exists.');
  }
  const newStudent = {
    id: `stu-${Date.now()}`,
    studentId: studentId || nextStudentId(d),
    fullName,
    username: uname,
    password: password || 'student123',
    classGrade: classGrade || 'General',
    email: email || '',
    phone: phone || '',
    gender: gender || 'Other',
    status: status || 'active',
    createdAt: new Date().toISOString(),
    notes: notes || '',
  };
  d.students.push(newStudent);
  recordAudit('Administrator', 'student_created', newStudent.id, `Created student ${newStudent.fullName} (${newStudent.studentId})`);
  return ok({ student: newStudent });
});

route('POST', /^\/students\/([^/]+)\/status$/, (m, body) => {
  const student = getDb().students.find((s: any) => s.id === decodeURIComponent(m[1]));
  if (!student) return fail(404, 'Student not found');
  student.status = body.status;
  recordAudit('Administrator', body.status === 'active' ? 'account_activated' : 'account_deactivated', student.id, `Student account status set to ${body.status}.`);
  return ok({ student });
});

route('POST', /^\/students\/([^/]+)\/reset-password$/, (m, body) => {
  const student = getDb().students.find((s: any) => s.id === decodeURIComponent(m[1]));
  if (!student) return fail(404, 'Student not found');
  student.password = body.newPassword || 'password123';
  recordAudit('Administrator', 'password_reset', student.id, `Password reset for student ${student.username}.`);
  return ok({ student });
});

route('DELETE', /^\/students\/([^/]+)$/, (m) => {
  const d = getDb();
  const id = decodeURIComponent(m[1]);
  const student = d.students.find((s: any) => s.id === id);
  if (!student) return fail(404, 'Student not found');
  d.students = d.students.filter((s: any) => s.id !== id);
  recordAudit('Administrator', 'student_deleted', id, `Deleted student ${student.fullName} (${student.studentId}).`);
  return ok();
});

route('POST', /^\/exams$/, (_m, body) => {
  const d = getDb();
  const examData = body;
  if (examData.id && d.exams.some((e: any) => e.id === examData.id)) {
    const idx = d.exams.findIndex((e: any) => e.id === examData.id);
    d.exams[idx] = { ...d.exams[idx], ...examData };
    recordAudit('Administrator', 'exam_updated', examData.id, `Updated examination "${examData.title}". Total marks: ${examData.totalMarks}`);
    return ok({ exam: d.exams[idx] });
  }
  const questions = examData.questions || [];
  const totalMarks = questions.reduce((acc: number, q: any) => acc + (q.marks || 0), 0) || examData.totalMarks || 100;
  const newExam = {
    ...examData,
    id: examData.id || `exam-${Date.now()}`,
    createdAt: new Date().toISOString(),
    questions,
    totalMarks,
    passMarks: examData.passMarks || Math.round((examData.totalMarks || 100) * 0.5),
  };
  d.exams.push(newExam);
  recordAudit('Administrator', 'exam_created', newExam.id, `Created examination "${newExam.title}" with ${newExam.questions.length} questions.`);
  return ok({ exam: newExam });
});

route('POST', /^\/exams\/([^/]+)\/status$/, (m, body) => {
  const exam = getDb().exams.find((e: any) => e.id === decodeURIComponent(m[1]));
  if (!exam) return fail(404, 'Exam not found');
  exam.status = body.status;
  recordAudit('Administrator', 'exam_status_change', exam.id, `Exam "${exam.title}" status changed to ${body.status}.`);
  return ok({ exam });
});

route('DELETE', /^\/exams\/([^/]+)$/, (m) => {
  const d = getDb();
  const id = decodeURIComponent(m[1]);
  const exam = d.exams.find((e: any) => e.id === id);
  if (!exam) return fail(404, 'Exam not found');
  d.exams = d.exams.filter((e: any) => e.id !== id);
  recordAudit('Administrator', 'exam_deleted', id, `Deleted examination "${exam.title}".`);
  return ok();
});

route('POST', /^\/import-questions-gemini$/, (_m, body) => importQuestions(body));

route('POST', /^\/exams\/([^/]+)\/start$/, (m, body) => {
  const d = getDb();
  const id = decodeURIComponent(m[1]);
  const exam = d.exams.find((e: any) => e.id === id);
  if (!exam) return fail(404, 'Examination not found.');
  if (exam.status === 'cancelled') return fail(400, 'This examination has been cancelled.');

  const student = d.students.find((s: any) => s.id === body.studentId);
  if (!student) return fail(404, 'Student not found.');
  if (student.status === 'deactivated') return fail(403, 'Your student account is deactivated.');

  const existing = d.attempts.find(
    (a: any) => a.examId === id && a.studentId === body.studentId && (a.status === 'submitted' || a.status === 'graded')
  );
  if (existing) {
    return fail(
      403,
      'You have already submitted this examination. Each student is allowed only one submission. Contact your administrator if a reset is required.',
      { alreadySubmitted: true, attempt: existing }
    );
  }

  let active = d.attempts.find((a: any) => a.examId === id && a.studentId === body.studentId && a.status === 'in_progress');
  if (!active) {
    const prev = d.attempts.filter((a: any) => a.examId === id && a.studentId === body.studentId).length;
    active = {
      id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      examId: id,
      studentId: student.id,
      studentUsername: student.username,
      studentName: student.fullName,
      classGrade: student.classGrade,
      attemptNumber: prev + 1,
      startedAt: new Date().toISOString(),
      submittedAt: '',
      answers: {},
      score: 0,
      totalMarks: exam.totalMarks,
      percentage: 0,
      passed: false,
      status: 'in_progress',
      timeSpentSeconds: 0,
      ipAddress: 'browser',
    };
    d.attempts.push(active);
    recordAudit(student.fullName, 'attempt_started', active.id, `Started examination "${exam.title}" (Attempt #${active.attemptNumber})`);
  }

  const sanitizedQuestions = exam.questions.map((q: any) => {
    const { correctAnswer: _c, explanation: _e, ...safe } = q;
    return safe;
  });
  return ok({ exam: { ...exam, questions: sanitizedQuestions }, attempt: active });
});

route('POST', /^\/exams\/([^/]+)\/save-progress$/, (m, body) => {
  const attempt = getDb().attempts.find((a: any) => a.id === body.attemptId && a.examId === decodeURIComponent(m[1]));
  if (!attempt) return fail(404, 'Attempt not found');
  if (attempt.status !== 'in_progress') return fail(400, 'Cannot save progress on a completed examination.');
  attempt.answers = { ...attempt.answers, ...body.answers };
  if (body.timeSpentSeconds) attempt.timeSpentSeconds = body.timeSpentSeconds;
  saveData();
  return ok({ savedAnswers: attempt.answers });
});

route('POST', /^\/exams\/([^/]+)\/submit$/, (m, body) => {
  const d = getDb();
  const id = decodeURIComponent(m[1]);
  const exam = d.exams.find((e: any) => e.id === id);
  if (!exam) return fail(404, 'Exam not found');
  const attempt = d.attempts.find((a: any) => a.id === body.attemptId && a.examId === id);
  if (!attempt) return fail(404, 'Attempt not found');
  if (attempt.status === 'submitted' || attempt.status === 'graded') {
    return ok({ attempt, message: 'Already submitted.' });
  }

  const finalAnswers: Record<string, string> = { ...attempt.answers, ...body.answers };
  let score = 0;
  let totalPossible = 0;
  exam.questions.forEach((q: any) => {
    totalPossible += q.marks;
    const ans = finalAnswers[q.id];
    if (ans && String(ans).trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase()) {
      score += q.marks;
    }
  });
  const percentage = totalPossible > 0 ? Math.round((score / totalPossible) * 100) : 0;
  const passed = score >= (exam.passMarks || totalPossible * 0.5);

  attempt.answers = finalAnswers;
  attempt.score = score;
  attempt.totalMarks = totalPossible;
  attempt.percentage = percentage;
  attempt.passed = passed;
  attempt.status = 'submitted';
  attempt.submittedAt = new Date().toISOString();
  if (body.timeSpentSeconds) attempt.timeSpentSeconds = body.timeSpentSeconds;

  recordAudit(
    attempt.studentName,
    'attempt_submitted',
    attempt.id,
    `Submitted "${exam.title}". Score: ${score}/${totalPossible} (${percentage}% - ${passed ? 'PASSED' : 'FAILED'}). Account examination access locked.`
  );

  return ok({
    attempt,
    exam: exam.showResultsImmediately ? exam : { id: exam.id, title: exam.title, showResultsImmediately: false },
    score,
    totalPossible,
    percentage,
    passed,
  });
});

route('POST', /^\/results\/([^/]+)\/reset$/, (m, body) => {
  const d = getDb();
  const old = d.attempts.find((a: any) => a.id === decodeURIComponent(m[1]));
  if (!old) return fail(404, 'Attempt not found.');
  old.status = 'reset_archived';
  old.feedback = `Attempt reset by Administrator. Reason: ${body.reason || 'Authorized retake'}.`;
  const exam = d.exams.find((e: any) => e.id === old.examId);
  recordAudit(
    'Administrator',
    'attempt_reset',
    old.id,
    `Reset examination attempt #${old.attemptNumber} for student ${old.studentName} on exam "${exam?.title || old.examId}". Previous score: ${old.score}/${old.totalMarks}. Reason: ${body.reason || 'Retake authorized'}`
  );
  return ok({
    message:
      'Examination attempt has been successfully reset. The previous attempt has been archived in history, and the student can now access the examination again.',
    archivedAttempt: old,
  });
});

route('POST', /^\/reset-demo-data$/, () => {
  db = createSeedData();
  saveData();
  recordAudit('Administrator', 'system_reset', 'all', 'Restored system default demo data.');
  return ok({ data: db });
});

// ------------------------------------------------- Gemini question import --
const nativeFetch: typeof fetch | null = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;

function getGeminiKey(): string {
  let key = (safeGet(GEMINI_KEY_STORAGE) || '').trim();
  if (!key && typeof window !== 'undefined') {
    key =
      (window.prompt(
        'PDF import uses Google Gemini.\nEnter your Gemini API key (it is stored only in this browser, never uploaded to GitHub):'
      ) || '').trim();
    if (key) safeSet(GEMINI_KEY_STORAGE, key);
  }
  if (!key) throw new Error('A Gemini API key is required for PDF import. Paste the question text instead, or provide a key.');
  return key;
}

async function callGemini(systemPrompt: string, parts: any[]): Promise<string> {
  if (!nativeFetch) throw new Error('Network is not available.');
  const key = getGeminiKey();
  const candidates = [safeGet(GEMINI_MODEL_STORAGE), 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(
    (m, i, arr): m is string => !!m && arr.indexOf(m) === i
  );

  const schema = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        questionNumber: { type: 'INTEGER' },
        type: { type: 'STRING' },
        text: { type: 'STRING' },
        options: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { id: { type: 'STRING' }, label: { type: 'STRING' }, text: { type: 'STRING' } },
            required: ['id', 'label', 'text'],
          },
        },
        correctAnswer: { type: 'STRING' },
        marks: { type: 'INTEGER' },
        explanation: { type: 'STRING' },
      },
      required: ['questionNumber', 'type', 'text', 'correctAnswer', 'marks'],
    },
  };

  let lastError: Error = new Error('Gemini request failed.');
  for (const model of candidates) {
    const res = await nativeFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
      if (text) {
        safeSet(GEMINI_MODEL_STORAGE, model);
        return text;
      }
      lastError = new Error('Gemini returned an empty response.');
      continue;
    }

    const errBody = await res.json().catch(() => ({}));
    const msg: string = errBody?.error?.message || `Gemini request failed (${res.status}).`;
    lastError = new Error(msg);
    if (res.status === 404) continue; // model name not available -> try the next one
    if ([400, 401, 403].includes(res.status) && /api key|permission|credential/i.test(msg)) {
      safeRemove(GEMINI_KEY_STORAGE); // force a new prompt next time
    }
    throw lastError;
  }
  throw lastError;
}

async function importQuestions(body: any): Promise<Result> {
  const { base64Pdf, rawText, subjectHint, defaultMarks } = body;
  if (!base64Pdf && !rawText) return fail(400, 'Please provide either a PDF file or question text.');
  const marksPerQ = Number(defaultMarks) || 5;

  const systemPrompt = `You are an expert examination processor.
Your job is to extract, OCR, and structure examination questions from the provided document/text into clean, verified exam questions.
Support multiple choice questions (with choices labeled A, B, C, D...), True/False questions, and short answer questions.

For each question, provide:
1. "questionNumber": sequential integer (1, 2, 3...)
2. "type": "multiple_choice", "true_false", or "short_answer"
3. "text": clear, clean question prompt string (fix OCR typos or scanning artifacts)
4. "options": array of objects { "id": "opt_1", "label": "A", "text": "Choice text" }. For True/False, provide option A as "True" and B as "False".
5. "correctAnswer": The correct option label (e.g., "A", "B", "C", "D") or for True/False ("A" for True or "B" for False). If the document explicitly marks or lists answers at the end, use that. Otherwise, deduce the correct factual answer.
6. "marks": integer points for this question (default ${marksPerQ} points)
7. "explanation": 1-2 sentence concise explanation of why the answer is correct.

Ensure the output is strictly valid JSON matching the schema array.`;

  const parts: any[] = [];
  if (base64Pdf) {
    const clean = String(base64Pdf).replace(/^data:[^;]+;base64,/, '');
    parts.push({ inlineData: { data: clean, mimeType: 'application/pdf' } });
    parts.push({
      text: `Extract all examination questions from this PDF paper. Subject context: ${subjectHint || 'General Education'}. Follow the JSON response schema.`,
    });
  } else {
    parts.push({
      text: `Here is the examination paper text to extract and parse into structured questions:\n\n${rawText}\n\nSubject context: ${subjectHint || 'General Education'}.`,
    });
  }

  try {
    const text = (await callGemini(systemPrompt, parts)).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Gemini returned an unexpected format.');
    const questions = parsed.map((q: any, idx: number) => ({
      ...q,
      id: `q_gen_${Date.now()}_${idx + 1}`,
      questionNumber: idx + 1,
      marks: q.marks || marksPerQ,
      options:
        q.options ||
        (q.type === 'true_false'
          ? [
              { id: 'opt_1', label: 'A', text: 'True' },
              { id: 'opt_2', label: 'B', text: 'False' },
            ]
          : []),
    }));
    recordAudit('Administrator', 'pdf_questions_extracted', 'gemini', `Extracted ${questions.length} questions via Gemini OCR.`);
    return ok({ questions });
  } catch (err: any) {
    console.error('Gemini question extraction error:', err);
    if (rawText) {
      const fallback = parseTextQuestionsFallback(rawText, marksPerQ);
      if (fallback.length > 0) {
        return ok({ questions: fallback, warning: 'Questions were extracted using heuristic text parsing.' });
      }
    }
    return fail(500, err?.message || 'Failed to extract questions from PDF.');
  }
}

function parseTextQuestionsFallback(rawText: string, defaultMarks: number): any[] {
  const blocks = rawText.split(/\n\s*(?=(?:\d+[.)]|[Qq]uestion\s+\d+[:.]))/g).filter((b) => b.trim().length > 0);
  const questions: any[] = [];

  blocks.forEach((block, idx) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    const questionText = lines[0].replace(/^(?:\d+[.)]|[Qq]uestion\s+\d+[:.])\s*/, '');
    const optionLines = lines.slice(1).filter((l) => /^[A-Da-d][.)]\s+/.test(l));

    let options = optionLines.map((opt, oIdx) => ({
      id: `opt_${oIdx + 1}`,
      label: opt.charAt(0).toUpperCase(),
      text: opt.replace(/^[A-Da-d][.)]\s+/, ''),
    }));

    let type = options.length > 0 ? 'multiple_choice' : 'short_answer';
    if (/true|false/i.test(questionText) && options.length <= 2) {
      type = 'true_false';
      if (options.length === 0) {
        options = [
          { id: 'opt_1', label: 'A', text: 'True' },
          { id: 'opt_2', label: 'B', text: 'False' },
        ];
      }
    }

    questions.push({
      id: `q_fallback_${idx + 1}`,
      questionNumber: idx + 1,
      type,
      text: questionText,
      options,
      correctAnswer: options[0]?.label || 'A',
      marks: defaultMarks,
      explanation: 'Extracted from examination text source.',
    });
  });

  return questions;
}

// ------------------------------------------------------- fetch interception --
async function describeRequest(input: RequestInfo | URL, init?: RequestInit) {
  let url: URL;
  let method = 'GET';
  let bodyRaw: any = undefined;

  if (typeof input === 'string' || input instanceof URL) {
    url = new URL(String(input), window.location.href);
  } else {
    url = new URL(input.url, window.location.href);
    method = input.method || 'GET';
    try {
      bodyRaw = await input.clone().text();
    } catch {
      /* no body */
    }
  }

  if (url.origin !== window.location.origin) return null;
  const idx = url.pathname.indexOf('/api/');
  if (idx === -1) return null;

  let path = url.pathname.slice(idx + 4); // keeps the leading "/"
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  method = (init?.method || method).toUpperCase();
  if (init && init.body !== undefined && init.body !== null) bodyRaw = init.body;

  let body: any = {};
  if (typeof bodyRaw === 'string' && bodyRaw.length > 0) {
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      body = {};
    }
  }
  return { method, path, body };
}

async function handle(method: string, path: string, body: any): Promise<Result> {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const match = path.match(pattern);
    if (match) return await handler(match, body || {});
  }
  return fail(404, `API route not found: ${method} ${path}`);
}

export function installStaticApi() {
  if (typeof window === 'undefined' || !nativeFetch) return;
  if ((window as any).__OEMS_STATIC_API__) return;
  (window as any).__OEMS_STATIC_API__ = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let req: Awaited<ReturnType<typeof describeRequest>> = null;
    try {
      req = await describeRequest(input, init);
    } catch {
      req = null;
    }
    if (!req) return nativeFetch(input as any, init);

    let result: Result;
    try {
      result = await handle(req.method, req.path, req.body);
    } catch (err: any) {
      console.error('[OEMS] Static API error:', err);
      result = fail(500, err?.message || 'Unexpected error.');
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  console.info('[OEMS] Running in static mode: data is stored in this browser (localStorage).');
}

if (typeof __STATIC_API__ !== 'undefined' && __STATIC_API__) {
  installStaticApi();
}
