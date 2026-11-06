import { pgTable, serial, text, timestamp, integer, numeric, date, uniqueIndex, index } from "drizzle-orm/pg-core";

// A test, assignment or exercise given to students.
export const assessments = pgTable("assessments", {
  id: serial().primaryKey(),
  title: text().notNull(),
  kind: text().notNull(), // "Test" | "Assignment" | "Exercise"
  subject: text().notNull(),
  shsLevel: integer("shs_level"), // null = all levels
  maxScore: numeric("max_score", { precision: 7, scale: 2 }).notNull(),
  givenOn: date("given_on").notNull(),
  notes: text(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One student's result for one assessment. student_id is the student's id in the registration records.
export const scores = pgTable(
  "scores",
  {
    id: serial().primaryKey(),
    assessmentId: integer("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    score: numeric({ precision: 7, scale: 2 }).notNull(),
    remarks: text(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("scores_assessment_student_idx").on(t.assessmentId, t.studentId),
    index("scores_student_idx").on(t.studentId),
  ]
);
