export type ExamOption = { id: string; label: string; text: string };
export type ExamQuestion = {
  id: string; questionNumber: number; type: string; text: string;
  options: ExamOption[]; correctAnswer?: string; marks: number; explanation?: string;
};
export type Examination = {
  id: string; title: string; subject: string; targetClass: string; instructions: string;
  date: string; startTime: string; durationMinutes: number; closingTime: string;
  totalMarks: number; passMarks: number; status: string; showResultsImmediately: boolean;
  createdAt?: string; questions: ExamQuestion[];
};
export type OEMSData = {
  school: Record<string, any>;
  students: any[];
  exams: Examination[];
  attempts: any[];
  auditLogs: any[];
};
