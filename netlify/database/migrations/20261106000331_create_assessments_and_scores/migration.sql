CREATE TABLE "assessments" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"shs_level" integer,
	"max_score" numeric(7,2) NOT NULL,
	"given_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" serial PRIMARY KEY,
	"assessment_id" integer NOT NULL,
	"student_id" text NOT NULL,
	"score" numeric(7,2) NOT NULL,
	"remarks" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scores_assessment_student_idx" ON "scores" ("assessment_id","student_id");--> statement-breakpoint
CREATE INDEX "scores_student_idx" ON "scores" ("student_id");--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_assessment_id_assessments_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE;