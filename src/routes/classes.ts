import express from "express";
import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "../db/index.js";
import { classes, departments, enrollments, subjects } from "../db/schema/app.js";
import type { Schedule } from "../db/schema/app.js";
import { user } from "../db/schema/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

const parseId = (value: unknown) => {
  const id = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
};

type ParsedClassInput = {
  name: string;
  description: string | null;
  subjectId: number;
  capacity: number;
  status: "active" | "inactive" | "archived";
  bannerUrl: string | null;
  bannerCldPubId: string | null;
  schedules: Schedule[];
};

const parseClassInput = (body: Record<string, unknown>): { error: string; value?: never } | { value: ParsedClassInput; error?: never } => {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const subjectId = Number(body.subjectId);
  const capacity = Number(body.capacity);
  const status = body.status;
  const bannerUrl = typeof body.bannerUrl === "string" ? body.bannerUrl.trim() : null;
  const bannerCldPubId = typeof body.bannerCldPubId === "string" ? body.bannerCldPubId.trim() : null;
  const schedules = Array.isArray(body.schedules) ? body.schedules : [];

  if (!name || name.length > 255) return { error: "Class name is required and must be 255 characters or fewer." };
  if (description.length > 10000) return { error: "Description is too long." };
  if (!Number.isInteger(subjectId) || subjectId < 1) return { error: "A valid subject is required." };
  if (!Number.isInteger(capacity) || capacity < 1) return { error: "Capacity must be a positive whole number." };
  if (status !== "active" && status !== "inactive" && status !== "archived") return { error: "Invalid class status." };

  const normalizedSchedules: Schedule[] = [];
  for (const entry of schedules) {
    if (!entry || typeof entry !== "object") return { error: "Each schedule must include a day and start/end times." };
    const schedule = entry as Record<string, unknown>;
    const day = schedule.day;
    const startTime = schedule.startTime;
    const endTime = schedule.endTime;
    if (typeof day !== "string" || !["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].includes(day)) {
      return { error: "Schedule day is invalid." };
    }
    if (typeof startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
        typeof endTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime) {
      return { error: "Schedule times must be valid and the end time must follow the start time." };
    }
    normalizedSchedules.push({ day, startTime, endTime });
  }

  return {
    value: {
      name,
      description: description || null,
      subjectId,
      capacity,
      status: status as "active" | "inactive" | "archived",
      bannerUrl: bannerUrl || null,
      bannerCldPubId: bannerCldPubId || null,
      schedules: normalizedSchedules,
    },
  };
};

// Get all classes with optional search, filtering and pagination
router.get("/", async (req, res) => {
  try {
    const { search, subject, teacher, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
    const limitPerPage = Math.min(
      Math.max(1, parseInt(String(limit), 10) || 10),
      100,
    ); // Max 100 records per page

    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    // If search query exists, filter by class name OR invite code
    if (search) {
      filterConditions.push(
        or(
          ilike(classes.name, `%${search}%`),
          ilike(classes.inviteCode, `%${search}%`),
        ),
      );
    }

    // If subject filter exists, match subject name
    if (subject) {
      const subjectPattern = `%${String(subject).replace(/[%_]/g, "\\$&")}%`;
      filterConditions.push(ilike(subjects.name, subjectPattern));
    }

    // If teacher filter exists, match teacher name
    if (teacher) {
      const teacherPattern = `%${String(teacher).replace(/[%_]/g, "\\$&")}%`;
      filterConditions.push(ilike(user.name, teacherPattern));
    }

    if (req.user?.role === "teacher") {
      filterConditions.push(eq(classes.teacherId, req.user.id));
    } else if (req.user?.role === "student") {
      filterConditions.push(eq(classes.status, "active"));
    }

    // Combine all filters using AND if any exist
    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const { inviteCode: _inviteCode, ...classColumns } = getTableColumns(classes);
    const inviteCodeColumn =
      req.user?.role === "student" ? {} : { inviteCode: classes.inviteCode };

    const classesList = await db
      .select({
        ...classColumns,
        ...inviteCodeColumn,
        subject: { ...getTableColumns(subjects) },
        teacher: { ...getTableColumns(user) },
        enrollmentCount: sql<number>`(
          select count(*)::int from ${enrollments}
          where ${enrollments.classId} = ${classes.id}
        )`,
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(whereClause)
      .orderBy(desc(classes.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: classesList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (e) {
    console.error(`GET /classes error: ${e}`);
    res.status(500).json({ error: "Failed to get classes" });
  }
});

// Get class details with teacher, subject, and department
router.get("/:id", async (req, res) => {
  const classId = parseId(req.params.id);

  if (!classId)
    return res.status(400).json({ error: "No Class found." });

  const { inviteCode: _inviteCode, ...classColumns } = getTableColumns(classes);
  const inviteCodeColumn =
    req.user?.role === "student" ? {} : { inviteCode: classes.inviteCode };

  const [classDetails] = await db
    .select({
      ...classColumns,
      ...inviteCodeColumn,
      subject: {
        ...getTableColumns(subjects),
      },
      department: {
        ...getTableColumns(departments),
      },
      teacher: {
        ...getTableColumns(user),
      },
      ...(req.user?.role === "student" ? {} : { inviteCode: classes.inviteCode }),
      enrollmentCount: sql<number>`(
        select count(*)::int from ${enrollments}
        where ${enrollments.classId} = ${classes.id}
      )`,
    })
    .from(classes)
    .leftJoin(subjects, eq(classes.subjectId, subjects.id))
    .leftJoin(user, eq(classes.teacherId, user.id))
    .leftJoin(departments, eq(subjects.departmentId, departments.id))
    .where(and(
      eq(classes.id, classId),
      req.user?.role === "teacher" ? eq(classes.teacherId, req.user.id) : undefined,
      req.user?.role === "student" ? eq(classes.status, "active") : undefined,
    ));

  if (!classDetails) return res.status(404).json({ error: "No Class found." });

  res.status(200).json({ data: classDetails });
});

router.post("/", requireRole("admin", "teacher"), async (req, res) => {
  const parsed = parseClassInput(req.body ?? {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const teacherId = req.user?.role === "teacher" ? req.user.id : req.body.teacherId;
    if (req.user?.role === "admin" && !teacherId) {
      return res.status(400).json({ error: "teacherId is required" });
    }
    const [teacher] = await db.select({ id: user.id }).from(user)
      .where(and(eq(user.id, teacherId), eq(user.role, "teacher")));
    if (!teacher) return res.status(400).json({ error: "The selected teacher does not exist." });

    let inviteCode = randomBytes(6).toString("hex").toUpperCase();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [collision] = await db.select({ id: classes.id }).from(classes)
        .where(eq(classes.inviteCode, inviteCode)).limit(1);
      if (!collision) break;
      inviteCode = randomBytes(6).toString("hex").toUpperCase();
    }

    const [createdClass] = await db
      .insert(classes)
      .values({
        ...parsed.value!,
        teacherId,
        inviteCode,
      })
      .returning({ id: classes.id });

    if (!createdClass) throw Error;

    res.status(201).json({ data: createdClass });
  } catch (e) {
    console.error(`POST /classes error ${e}`);
    console.error("POST /classes error:", e);
    res.status(409).json({ error: "Could not create class. Check the selected subject and invite-code uniqueness." });
  }
});

router.patch("/:id", requireRole("admin", "teacher"), async (req, res) => {
  const classId = parseId(req.params.id);
  if (!classId) return res.status(400).json({ error: "Invalid class ID" });

  try {
    const [existing] = await db.select().from(classes).where(and(
      eq(classes.id, classId),
      req.user?.role === "teacher" ? eq(classes.teacherId, req.user.id) : undefined,
    ));
    if (!existing) return res.status(404).json({ error: "Class not found" });

    const parsed = parseClassInput({ ...existing, ...(req.body ?? {}) });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const [subject] = await db.select({ id: subjects.id }).from(subjects)
      .where(eq(subjects.id, parsed.value!.subjectId));
    if (!subject) return res.status(400).json({ error: "The selected subject does not exist." });

    const teacherId = req.user?.role === "teacher" ? req.user.id : req.body.teacherId ?? existing.teacherId;
    const [teacher] = await db.select({ id: user.id }).from(user)
      .where(and(eq(user.id, teacherId), eq(user.role, "teacher")));
    if (!teacher) return res.status(400).json({ error: "The selected teacher does not exist." });

    const [countResult] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(enrollments).where(eq(enrollments.classId, classId));
    const enrollmentCount = countResult?.count ?? 0;
    if (parsed.value!.capacity < enrollmentCount) {
      return res.status(409).json({ error: `Capacity cannot be lower than the ${enrollmentCount} students already enrolled.` });
    }

    const [updated] = await db.update(classes).set({
      ...parsed.value!,
      teacherId,
    }).where(eq(classes.id, classId)).returning({ id: classes.id });

    res.json({ data: updated });
  } catch (error) {
    console.error("PATCH /classes/:id error:", error);
    res.status(409).json({ error: "Could not update class. Check its subject, teacher, and capacity." });
  }
});

router.delete("/:id", requireRole("admin", "teacher"), async (req, res) => {
  const classId = parseId(req.params.id);
  if (!classId) return res.status(400).json({ error: "Invalid class ID" });

  try {
    const [existing] = await db.select({ id: classes.id }).from(classes).where(and(
      eq(classes.id, classId),
      req.user?.role === "teacher" ? eq(classes.teacherId, req.user.id) : undefined,
    ));
    if (!existing) return res.status(404).json({ error: "Class not found" });

    await db.delete(classes).where(eq(classes.id, classId));
    res.status(204).send();
  } catch (error) {
    console.error("DELETE /classes/:id error:", error);
    res.status(500).json({ error: "Failed to delete class" });
  }
});

export default router;
