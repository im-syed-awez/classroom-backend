import express from "express";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { classes, departments, enrollments, subjects } from "../db/schema/app.js";
import { user } from "../db/schema/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/dashboard", requireRole("admin"), async (_req, res) => {
  try {
    const [usersByRole, totals, enrollmentsByMonth, classesByDepartment, capacityRows, recentEnrollments, recentClasses, recentSubjects, recentUsers] = await Promise.all([
      db.select({ name: user.role, value: sql<number>`count(*)`.mapWith(Number) }).from(user).groupBy(user.role),
      Promise.all([
        db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(user),
        db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(departments),
        db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(subjects),
        db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(classes),
        db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(enrollments),
      ]),
      db.select({ month: sql<string>`to_char(date_trunc('month', ${enrollments.createdAt}), 'YYYY-MM')`, count: sql<number>`count(*)`.mapWith(Number) })
        .from(enrollments).where(gte(enrollments.createdAt, sql`now() - interval '6 months'`))
        .groupBy(sql`date_trunc('month', ${enrollments.createdAt})`).orderBy(sql`date_trunc('month', ${enrollments.createdAt})`),
      db.select({ name: departments.name, value: sql<number>`count(${classes.id})`.mapWith(Number) })
        .from(departments).leftJoin(subjects, eq(subjects.departmentId, departments.id))
        .leftJoin(classes, eq(classes.subjectId, subjects.id)).groupBy(departments.id, departments.name).orderBy(departments.name),
      db.select({ capacity: classes.capacity, enrolled: sql<number>`count(${enrollments.id})`.mapWith(Number) })
        .from(classes).leftJoin(enrollments, eq(enrollments.classId, classes.id)).groupBy(classes.id, classes.capacity),
      db.select({ id: enrollments.id, name: user.name, className: classes.name, createdAt: enrollments.createdAt })
        .from(enrollments).innerJoin(user, eq(enrollments.studentId, user.id)).innerJoin(classes, eq(enrollments.classId, classes.id)).orderBy(desc(enrollments.createdAt)).limit(8),
      db.select({ id: classes.id, name: classes.name, createdAt: classes.createdAt }).from(classes).orderBy(desc(classes.createdAt)).limit(8),
      db.select({ id: subjects.id, name: subjects.name, createdAt: subjects.createdAt }).from(subjects).orderBy(desc(subjects.createdAt)).limit(8),
      db.select({ id: user.id, name: user.name, createdAt: user.createdAt }).from(user).orderBy(desc(user.createdAt)).limit(8),
    ]);

    const capacityStatus = { available: 0, nearlyFull: 0, full: 0 };
    for (const row of capacityRows) {
      const ratio = row.capacity > 0 ? row.enrolled / row.capacity : 1;
      if (ratio >= 1) capacityStatus.full += 1;
      else if (ratio >= 0.9) capacityStatus.nearlyFull += 1;
      else capacityStatus.available += 1;
    }

    const activity = [
      ...recentEnrollments.map((entry) => ({ id: `enrollment-${entry.id}`, type: "enrollment", label: `${entry.name} enrolled in ${entry.className}`, createdAt: entry.createdAt })),
      ...recentClasses.map((entry) => ({ id: `class-${entry.id}`, type: "class", label: `Class created: ${entry.name}`, createdAt: entry.createdAt })),
      ...recentSubjects.map((entry) => ({ id: `subject-${entry.id}`, type: "subject", label: `Subject created: ${entry.name}`, createdAt: entry.createdAt })),
      ...recentUsers.map((entry) => ({ id: `user-${entry.id}`, type: "user", label: `User registered: ${entry.name}`, createdAt: entry.createdAt })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12);

    res.json({ data: {
      totals: { users: totals[0][0]?.value ?? 0, departments: totals[1][0]?.value ?? 0, subjects: totals[2][0]?.value ?? 0, classes: totals[3][0]?.value ?? 0, enrollments: totals[4][0]?.value ?? 0 },
      usersByRole,
      enrollmentsByMonth,
      classesByDepartment,
      capacityStatus,
      activity,
    } });
  } catch (error) {
    console.error("GET /analytics/dashboard error:", error);
    res.status(500).json({ error: "Failed to load dashboard analytics" });
  }
});

router.get("/search", async (req, res) => {
  const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (term.length < 2) return res.json({ data: { classes: [], subjects: [], departments: [], users: [] } });
  const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
  try {
    const classScope = req.user?.role === "teacher"
      ? and(eq(classes.teacherId, req.user.id), ilike(classes.name, pattern))
      : req.user?.role === "student"
        ? and(eq(classes.status, "active"), ilike(classes.name, pattern))
        : ilike(classes.name, pattern);
    const [classResults, subjectResults, departmentResults, userResults] = await Promise.all([
      db.select({ id: classes.id, name: classes.name, status: classes.status })
        .from(classes).where(classScope).limit(5),
      db.select({ id: subjects.id, name: subjects.name, code: subjects.code })
        .from(subjects).where(or(ilike(subjects.name, pattern), ilike(subjects.code, pattern))).limit(5),
      db.select({ id: departments.id, name: departments.name, code: departments.code })
        .from(departments).where(or(ilike(departments.name, pattern), ilike(departments.code, pattern))).limit(5),
      req.user?.role === "admin"
        ? db.select({ id: user.id, name: user.name, email: user.email, role: user.role })
          .from(user).where(or(ilike(user.name, pattern), ilike(user.email, pattern))).limit(5)
        : Promise.resolve([]),
    ]);
    res.json({ data: { classes: classResults, subjects: subjectResults, departments: departmentResults, users: userResults } });
  } catch (error) {
    console.error("GET /analytics/search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;