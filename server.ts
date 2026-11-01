import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSeedData } from './seed';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'oems-data.json');

app.use(express.json({ limit: '20mb' }));

function readDb(): any {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Could not read database file; using seed data.', e);
  }
  const db = createSeedData();
  writeDb(db);
  return db;
}
function writeDb(db: any) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
let db: any = readDb();
const ok = (body: any = {}) => ({ success: true, ...body });
const fail = (res: express.Response, status: number, error: string, extra: any = {}) =>
  res.status(status).json({ success: false, error, ...extra });
const audit = (actor: string, action: string, targetId: string, details: string) => {
  db.auditLogs ||= [];
  db.auditLogs.unshift({ id: `log-${Date.now()}`, timestamp: new Date().toISOString(), actor, action, targetId, details });
  db.auditLogs = db.auditLogs.slice(0, 500);
  writeDb(db);
};
const decode = (s: string) => decodeURIComponent(s);

app.get('/api/health', (_req, res) => res.json({ success: true, status: 'ok' }));
app.get('/api/bootstrap', (_req, res) => res.json(ok({ data: db })));

app.post('/api/login/admin', (req, res) => {
  const { username, password } = req.body || {};
  if (username === (process.env.ADMIN_USERNAME || 'admin') &&
      password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    audit('admin', 'admin_login', 'admin', 'Administrator authenticated successfully.');
    return res.json(ok({ user: { role: 'admin', username: 'admin', fullName: 'School Administrator' } }));
  }
  return fail(res, 401, 'Invalid administrator credentials.');
});
app.post('/api/login/student', (req, res) => {
  const uname = String(req.body?.username || '').trim().toLowerCase();
  const student = db.students.find((s: any) =>
    (String(s.username).toLowerCase() === uname || String(s.studentId).toLowerCase() === uname) &&
    s.password === req.body?.password);
  if (!student) return fail(res, 401, 'Invalid username or password.');
  if (student.status === 'deactivated') return fail(res, 403, 'Your student account is deactivated.');
  audit(student.fullName, 'student_login', student.id, `Student ${student.studentId} logged in.`);
  return res.json(ok({ user: { role: 'student', username: student.username, fullName: student.fullName, student } }));
});

app.post('/api/school', (req, res) => {
  db.school = { ...db.school, ...req.body };
  audit('Administrator', 'school_updated', 'school', `School info updated: ${db.school.name}`);
  res.json(ok({ school: db.school }));
});

app.post('/api/students', (req, res) => {
  const b = req.body || {};
  const uname = String(b.username || '').trim();
  if (!uname) return fail(res, 400, 'A username is required.');
  if (b.id) {
    const i = db.students.findIndex((s: any) => s.id === b.id);
    if (i < 0) return fail(res, 404, 'Student not found.');
    db.students[i] = { ...db.students[i], ...b, username: uname };
    audit('Administrator', 'student_updated', b.id, `Updated student ${uname}.`);
    return res.json(ok({ student: db.students[i] }));
  }
  if (db.students.some((s: any) => s.username.toLowerCase() === uname.toLowerCase()))
    return fail(res, 400, 'A student with this username already exists.');
  const used = new Set(db.students.map((s: any) => String(s.studentId).toLowerCase()));
  let n = 1001 + db.students.length;
  while (used.has(`stu-${n}`)) n++;
  const student = {
    id: `stu-${Date.now()}`, studentId: b.studentId || `STU-${n}`, fullName: b.fullName || '',
    username: uname, password: b.password || 'student123', classGrade: b.classGrade || 'General',
    email: b.email || '', phone: b.phone || '', gender: b.gender || 'Other',
    status: b.status || 'active', createdAt: new Date().toISOString(), notes: b.notes || '',
  };
  db.students.push(student);
  audit('Administrator', 'student_created', student.id, `Created student ${student.fullName} (${student.studentId}).`);
  res.json(ok({ student }));
});
app.post('/api/students/:id/status', (req, res) => {
  const s = db.students.find((x: any) => x.id === decode(req.params.id));
  if (!s) return fail(res, 404, 'Student not found.');
  s.status = req.body?.status || 'active';
  audit('Administrator', s.status === 'active' ? 'account_activated' : 'account_deactivated', s.id, `Status set to ${s.status}.`);
  res.json(ok({ student: s }));
});
app.post('/api/students/:id/reset-password', (req, res) => {
  const s = db.students.find((x: any) => x.id === decode(req.params.id));
  if (!s) return fail(res, 404, 'Student not found.');
  s.password = req.body?.newPassword || 'student123';
  audit('Administrator', 'password_reset', s.id, `Password reset for ${s.username}.`);
  res.json(ok({ student: s }));
});
app.delete('/api/students/:id', (req, res) => {
  const i = db.students.findIndex((s: any) => s.id === decode(req.params.id));
  if (i < 0) return fail(res, 404, 'Student not found.');
  const [s] = db.students.splice(i, 1);
  audit('Administrator', 'student_deleted', s.id, `Deleted student ${s.fullName}.`);
  res.json(ok());
});

app.post('/api/exams', (req, res) => {
  const b = req.body || {};
  if (b.id) {
    const i = db.exams.findIndex((e: any) => e.id === b.id);
    if (i >= 0) {
      db.exams[i] = { ...db.exams[i], ...b };
      audit('Administrator', 'exam_updated', b.id, `Updated examination "${b.title}".`);
      return res.json(ok({ exam: db.exams[i] }));
    }
  }
  const questions = b.questions || [];
  const totalMarks = questions.reduce((sum: number, q: any) => sum + (Number(q.marks) || 0), 0) || b.totalMarks || 100;
  const exam = { ...b, id: b.id || `exam-${Date.now()}`, createdAt: new Date().toISOString(),
    questions, totalMarks, passMarks: b.passMarks || Math.round(totalMarks * 0.5) };
  db.exams.push(exam);
  audit('Administrator', 'exam_created', exam.id, `Created "${exam.title}" with ${questions.length} questions.`);
  res.json(ok({ exam }));
});
app.post('/api/exams/:id/status', (req, res) => {
  const exam = db.exams.find((e: any) => e.id === decode(req.params.id));
  if (!exam) return fail(res, 404, 'Exam not found.');
  exam.status = req.body?.status || exam.status;
  audit('Administrator', 'exam_status_change', exam.id, `Exam status changed to ${exam.status}.`);
  res.json(ok({ exam }));
});
app.delete('/api/exams/:id', (req, res) => {
  const i = db.exams.findIndex((e: any) => e.id === decode(req.params.id));
  if (i < 0) return fail(res, 404, 'Exam not found.');
  const [exam] = db.exams.splice(i, 1);
  audit('Administrator', 'exam_deleted', exam.id, `Deleted "${exam.title}".`);
  res.json(ok());
});

app.post('/api/import-questions-gemini', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(res, 503, 'Set GEMINI_API_KEY on the backend to enable PDF question import.');
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const rawText = String(req.body?.rawText || req.body?.prompt || req.body?.text || '');
    const base64Pdf = String(req.body?.base64Pdf || '').replace(/^data:[^;]+;base64,/, '');
    if (!rawText.trim() && !base64Pdf) return fail(res, 400, 'Please provide either a PDF file or question text.');
    const contents: any[] = [];
    if (base64Pdf) {
      contents.push({ inlineData: { data: base64Pdf, mimeType: 'application/pdf' } });
      contents.push({ text: `Extract all examination questions from this PDF. Subject: ${req.body?.subjectHint || 'General Education'}. Default marks per question: ${Number(req.body?.defaultMarks) || 5}. Return only a valid JSON array. Each item must contain questionNumber, type (multiple_choice, true_false, or short_answer), text, options [{id,label,text}], correctAnswer, marks, and explanation. Preserve answer keys if present.` });
    } else {
      contents.push({ text: `Extract exam questions from the following text. Subject: ${req.body?.subjectHint || 'General Education'}. Default marks per question: ${Number(req.body?.defaultMarks) || 5}. Return only a valid JSON array. Each item must contain questionNumber, type (multiple_choice, true_false, or short_answer), text, options [{id,label,text}], correctAnswer, marks, and explanation. Preserve answer keys if present.\n\n${rawText}` });
    }
    const result = await ai.models.generateContent({
      model,
      contents,
      config: { responseMimeType: 'application/json' },
    });
    const raw = result.text || '[]';
    const questions = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, ''));
    if (!Array.isArray(questions)) return fail(res, 500, 'Gemini returned an unexpected format.');
    const normalized = questions.map((q: any, i: number) => ({ ...q, id: q.id || `q_gen_${Date.now()}_${i + 1}`, questionNumber: i + 1, marks: q.marks || Number(req.body?.defaultMarks) || 5, options: q.options || (q.type === 'true_false' ? [{ id: 'opt_1', label: 'A', text: 'True' }, { id: 'opt_2', label: 'B', text: 'False' }] : []) }));
    audit('Administrator', 'pdf_questions_extracted', 'gemini', `Extracted ${normalized.length} questions via Gemini OCR.`);
    res.json(ok({ questions: normalized }));
  } catch (e: any) {
    fail(res, 500, e?.message || 'Question import failed.');
  }
});

app.post('/api/exams/:id/start', (req, res) => {
  const exam = db.exams.find((e: any) => e.id === decode(req.params.id));
  if (!exam) return fail(res, 404, 'Examination not found.');
  if (exam.status === 'cancelled') return fail(res, 400, 'This examination has been cancelled.');
  const student = db.students.find((s: any) => s.id === req.body?.studentId);
  if (!student) return fail(res, 404, 'Student not found.');
  if (student.status === 'deactivated') return fail(res, 403, 'Your student account is deactivated.');
  const submitted = db.attempts.find((a: any) => a.examId === exam.id && a.studentId === student.id && ['submitted','graded'].includes(a.status));
  if (submitted) return fail(res, 403, 'You have already submitted this examination.', { alreadySubmitted: true, attempt: submitted });
  let attempt = db.attempts.find((a: any) => a.examId === exam.id && a.studentId === student.id && a.status === 'in_progress');
  if (!attempt) {
    const previous = db.attempts.filter((a: any) => a.examId === exam.id && a.studentId === student.id).length;
    attempt = { id: `att-${Date.now()}`, examId: exam.id, studentId: student.id, studentUsername: student.username,
      studentName: student.fullName, classGrade: student.classGrade, attemptNumber: previous + 1,
      startedAt: new Date().toISOString(), submittedAt: '', answers: {}, score: 0, totalMarks: exam.totalMarks,
      percentage: 0, passed: false, status: 'in_progress', timeSpentSeconds: 0, ipAddress: req.ip };
    db.attempts.push(attempt);
  }
  writeDb(db);
  const questions = exam.questions.map(({ correctAnswer, explanation, ...q }: any) => q);
  res.json(ok({ exam: { ...exam, questions }, attempt }));
});
app.post('/api/exams/:id/save-progress', (req, res) => {
  const attempt = db.attempts.find((a: any) => a.id === req.body?.attemptId && a.examId === decode(req.params.id));
  if (!attempt) return fail(res, 404, 'Attempt not found.');
  if (attempt.status !== 'in_progress') return fail(res, 400, 'Cannot save progress on a completed examination.');
  attempt.answers = { ...attempt.answers, ...(req.body?.answers || {}) };
  if (req.body?.timeSpentSeconds != null) attempt.timeSpentSeconds = req.body.timeSpentSeconds;
  writeDb(db);
  res.json(ok({ savedAnswers: attempt.answers }));
});
app.post('/api/exams/:id/submit', (req, res) => {
  const exam = db.exams.find((e: any) => e.id === decode(req.params.id));
  if (!exam) return fail(res, 404, 'Exam not found.');
  const attempt = db.attempts.find((a: any) => a.id === req.body?.attemptId && a.examId === exam.id);
  if (!attempt) return fail(res, 404, 'Attempt not found.');
  if (['submitted','graded'].includes(attempt.status)) return res.json(ok({ attempt, message: 'Already submitted.' }));
  const answers = { ...(attempt.answers || {}), ...(req.body?.answers || {}) };
  let score = 0, total = 0;
  for (const q of exam.questions || []) {
    total += Number(q.marks) || 0;
    if (answers[q.id] && String(answers[q.id]).trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase()) score += Number(q.marks) || 0;
  }
  attempt.answers = answers; attempt.score = score; attempt.totalMarks = total;
  attempt.percentage = total ? Math.round(score / total * 100) : 0;
  attempt.passed = score >= (exam.passMarks || total * 0.5);
  attempt.status = 'submitted'; attempt.submittedAt = new Date().toISOString();
  if (req.body?.timeSpentSeconds != null) attempt.timeSpentSeconds = req.body.timeSpentSeconds;
  audit(attempt.studentName, 'attempt_submitted', attempt.id, `Submitted "${exam.title}". Score: ${score}/${total}.`);
  res.json(ok({ attempt, exam: exam.showResultsImmediately ? exam : { id: exam.id, title: exam.title, showResultsImmediately: false },
    score, totalPossible: total, percentage: attempt.percentage, passed: attempt.passed }));
});
app.post('/api/results/:id/reset', (req, res) => {
  const attempt = db.attempts.find((a: any) => a.id === decode(req.params.id));
  if (!attempt) return fail(res, 404, 'Attempt not found.');
  attempt.status = 'reset_archived';
  attempt.feedback = `Attempt reset by Administrator. Reason: ${req.body?.reason || 'Authorized retake'}.`;
  audit('Administrator', 'attempt_reset', attempt.id, `Reset attempt for ${attempt.studentName}.`);
  res.json(ok({ message: 'Attempt reset; student can retake the examination.', archivedAttempt: attempt }));
});
app.post('/api/reset-demo-data', (_req, res) => {
  db = createSeedData(); writeDb(db);
  audit('Administrator', 'system_reset', 'all', 'Restored system default demo data.');
  res.json(ok({ data: db }));
});

const dist = path.join(__dirname, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.listen(PORT, () => console.log(`OEMS backend listening on http://localhost:${PORT}`));
