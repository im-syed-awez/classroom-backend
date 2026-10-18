import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { classes, subjects } from "../db/schema/app.js";
import { user } from "../db/schema/auth.js";
import { alias } from "drizzle-orm/pg-core";

const router = express.Router();
const teachers = alias(user, "teacher");

// Get all classes with optional search, filtering and pagination
router.get("/", async (req, res) => {
  try {
    const { search, subject, teacher, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
    const LimitPerPage = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 100);
    const offset = (currentPage - 1) * LimitPerPage;

    const filterConditions = [];

    if (search) {
      const searchPattern = `%${String(search)}%`;
      filterConditions.push(
        or(
          ilike(classes.name, searchPattern),
          ilike(classes.inviteCode, searchPattern)
        )
      );
    }
    if (subject) {
      filterConditions.push(ilike(subjects.name, `%${String(subject)}%`));
    }
    if (teacher) {
      filterConditions.push(ilike(teachers.name, `%${String(teacher)}%`));
    }

    const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(teachers, eq(classes.teacherId, teachers.id))
      .where(whereClause);
    const totalCount = countResult[0]?.count ?? 0;

    const classesList = await db
      .select({
        ...getTableColumns(classes),
        subject: { ...getTableColumns(subjects) },
        teacher: { ...getTableColumns(teachers) },
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(teachers, eq(classes.teacherId, teachers.id))
      .where(whereClause)
      .orderBy(desc(classes.createdAt))
      .limit(LimitPerPage)
      .offset(offset);

    res.status(200).json({
      data: classesList,
      pagination: {
        page: currentPage,
        limit: LimitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / LimitPerPage),
      },
    });
  } catch (error) {
    console.error("Get /classes error:", error);
    res.status(500).json({ error: "Failed to get the classes" });
  }
});

// In this we'll create a post req for submitting a class.
router.post("/", async (req, res) => {
  try {
    const [createdClass] = await db
      .insert(classes)
      //we have to provide values in object format{}.
      .values({...req.body,
        inviteCode: Math.random().toString(36).substring(2, 9),
        schedules: []
      })
      .returning({ id: classes.id });

    if (!createdClass) throw Error;

    res.status(201).json({ data: createdClass });
  } catch (error) {
    console.error("POST /classes error:", error);
    res.status(500).json({ error: "Failed to create class" });
  }
});
export default router;

