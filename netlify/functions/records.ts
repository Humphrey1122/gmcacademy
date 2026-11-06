import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { assessments, scores } from "../../db/schema.js";

// Same public project URL and publishable key the site already uses for sign-in.
const SUPABASE_URL = "https://ohpqhpoyenjpwhsygqlx.supabase.co";
const SUPABASE_KEY = "sb_publishable_YjtptY01owef8zbwLynm1A_v7RFZfsJ";
const KINDS = ["Test", "Assignment", "Exercise"];

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Only signed-in GMC administrators may read or write records.
async function requireAdmin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u.user) throw new HttpError(401, "Your session has expired. Please sign in again.");
  const { data: admin } = await sb.from("gmc_admins").select("user_id").maybeSingle();
  if (!admin) throw new HttpError(403, "This account is not authorised.");
}

function num(v: unknown, label: string, min = 0) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (String(v ?? "").trim() === "" || !Number.isFinite(n) || n < min) throw new HttpError(400, `Enter a valid ${label}.`);
  return Math.round(n * 100) / 100;
}

function parseAssessment(b: any) {
  const title = String(b?.title ?? "").trim();
  const subject = String(b?.subject ?? "").trim();
  const kind = String(b?.kind ?? "");
  const givenOn = String(b?.givenOn ?? "");
  if (!title) throw new HttpError(400, "Enter a title.");
  if (!KINDS.includes(kind)) throw new HttpError(400, "Choose test, assignment or exercise.");
  if (!subject) throw new HttpError(400, "Enter the subject.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(givenOn)) throw new HttpError(400, "Enter the date it was given.");
  const lvl = b?.shsLevel === "" || b?.shsLevel == null ? null : Number(b.shsLevel);
  if (lvl !== null && ![1, 2, 3].includes(lvl)) throw new HttpError(400, "Choose a valid SHS level.");
  const maxScore = num(b?.maxScore, "maximum score");
  if (maxScore <= 0) throw new HttpError(400, "The maximum score must be more than 0.");
  return { title, kind, subject, givenOn, shsLevel: lvl, maxScore: String(maxScore), notes: String(b?.notes ?? "").trim() || null };
}

const summary = {
  id: assessments.id, title: assessments.title, kind: assessments.kind, subject: assessments.subject,
  shsLevel: assessments.shsLevel, maxScore: assessments.maxScore, givenOn: assessments.givenOn, notes: assessments.notes,
  recorded: sql<number>`count(${scores.id})::int`,
  average: sql<string | null>`avg(${scores.score})`,
};

async function handle(req: Request, parts: string[]) {
  const m = req.method;
  const [res, idRaw, sub] = parts;
  const id = idRaw ? Number(idRaw) : NaN;

  if (res === "assessments" && !idRaw) {
    if (m === "GET") {
      return db.select(summary).from(assessments).leftJoin(scores, eq(scores.assessmentId, assessments.id))
        .groupBy(assessments.id).orderBy(desc(assessments.givenOn), desc(assessments.id));
    }
    if (m === "POST") {
      const [row] = await db.insert(assessments).values(parseAssessment(await req.json())).returning();
      return row;
    }
  }

  if (res === "assessments" && Number.isInteger(id)) {
    const [a] = await db.select().from(assessments).where(eq(assessments.id, id));
    if (!a) throw new HttpError(404, "This record no longer exists.");
    if (!sub) {
      if (m === "PUT") {
        const [row] = await db.update(assessments).set(parseAssessment(await req.json())).where(eq(assessments.id, id)).returning();
        return row;
      }
      if (m === "DELETE") { await db.delete(assessments).where(eq(assessments.id, id)); return { ok: true }; }
    }
    if (sub === "scores") {
      if (m === "GET") return db.select().from(scores).where(eq(scores.assessmentId, id));
      if (m === "PUT") {
        const body = await req.json();
        const list: any[] = Array.isArray(body?.scores) ? body.scores : [];
        const max = Number(a.maxScore);
        const clear: string[] = [];
        const save: { assessmentId: number; studentId: string; score: string; remarks: string | null }[] = [];
        for (const s of list) {
          const studentId = String(s?.studentId ?? "");
          if (!studentId) continue;
          if (s.score === null || String(s.score).trim() === "") { clear.push(studentId); continue; }
          const n = num(s.score, "score");
          if (n > max) throw new HttpError(400, `A score of ${n} is more than the maximum of ${max}.`);
          save.push({ assessmentId: id, studentId, score: String(n), remarks: String(s.remarks ?? "").trim() || null });
        }
        if (clear.length) await db.delete(scores).where(and(eq(scores.assessmentId, id), inArray(scores.studentId, clear)));
        if (save.length) {
          await db.insert(scores).values(save).onConflictDoUpdate({
            target: [scores.assessmentId, scores.studentId],
            set: { score: sql`excluded.score`, remarks: sql`excluded.remarks`, updatedAt: sql`now()` },
          });
        }
        return db.select().from(scores).where(eq(scores.assessmentId, id));
      }
    }
  }

  if (res === "students" && idRaw && sub === "scores" && m === "GET") {
    return db.select({
      assessmentId: assessments.id, title: assessments.title, kind: assessments.kind, subject: assessments.subject,
      maxScore: assessments.maxScore, givenOn: assessments.givenOn, score: scores.score, remarks: scores.remarks,
    }).from(scores).innerJoin(assessments, eq(scores.assessmentId, assessments.id))
      .where(eq(scores.studentId, idRaw)).orderBy(desc(assessments.givenOn), asc(assessments.title));
  }

  throw new HttpError(404, "Not found.");
}

export default async (req: Request) => {
  try {
    await requireAdmin(req);
    const parts = new URL(req.url).pathname.replace(/^\/api\/records\/?/, "").split("/").filter(Boolean);
    return Response.json(await handle(req, parts));
  } catch (e: any) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/records/*" };
