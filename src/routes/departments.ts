import express from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { departments, subjects } from "../db/schema/app.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const parseId = (value: unknown) => {
  const id = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
};

const validateDepartment = (body: Record<string, unknown>) => {
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!code || code.length > 50) return { error: "Code is required and must be 50 characters or fewer." };
  if (!name || name.length > 255) return { error: "Name is required and must be 255 characters or fewer." };
  if (description.length > 255) return { error: "Description must be 255 characters or fewer." };
  return { value: { code, name, description: description || null } };
};

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? 1), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? 10), 10) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const where = search
      ? or(ilike(departments.name, `%${search}%`), ilike(departments.code, `%${search}%`))
      : undefined;
    const sortableColumns = { id: departments.id, name: departments.name, code: departments.code, createdAt: departments.createdAt };
    const sortKey = typeof req.query.sortBy === "string" && req.query.sortBy in sortableColumns
      ? req.query.sortBy as keyof typeof sortableColumns
      : "name";
    const orderBy = req.query.sortOrder === "desc"
      ? desc(sortableColumns[sortKey])
      : asc(sortableColumns[sortKey]);
    const [count] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(departments).where(where);
    const data = await db.select().from(departments).where(where).orderBy(orderBy)
      .limit(limit).offset((page - 1) * limit);
    const total = count?.count ?? 0;
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("GET /departments error:", error);
    res.status(500).json({ error: "Failed to get departments" });
  }
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid department ID" });
  try {
    const [data] = await db.select().from(departments).where(eq(departments.id, id));
    if (!data) return res.status(404).json({ error: "Department not found" });
    res.json({ data });
  } catch (error) {
    console.error("GET /departments/:id error:", error);
    res.status(500).json({ error: "Failed to get department" });
  }
});

router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = validateDepartment(req.body ?? {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const [data] = await db.insert(departments).values(parsed.value!).returning();
    res.status(201).json({ data });
  } catch (error) {
    console.error("POST /departments error:", error);
    res.status(500).json({ error: "Could not create department. Check that its code is unique." });
  }
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid department ID" });
  try {
    const [existing] = await db.select().from(departments).where(eq(departments.id, id));
    if (!existing) return res.status(404).json({ error: "Department not found" });
    const parsed = validateDepartment({ ...existing, ...(req.body ?? {}) });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const [data] = await db.update(departments).set(parsed.value!).where(eq(departments.id, id)).returning();
    res.json({ data });
  } catch (error) {
    console.error("PATCH /departments/:id error:", error);
    res.status(500).json({ error: "Could not update department. Check that its code is unique." });
  }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid department ID" });
  try {
    const [existing] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, id));
    if (!existing) return res.status(404).json({ error: "Department not found" });
    const [linkedSubject] = await db.select({ id: subjects.id }).from(subjects)
      .where(eq(subjects.departmentId, id)).limit(1);
    if (linkedSubject) return res.status(409).json({ error: "Cannot delete a department while it has subjects. Move or delete its subjects first." });
    await db.delete(departments).where(eq(departments.id, id));
    res.status(204).send();
  } catch (error) {
    console.error("DELETE /departments/:id error:", error);
    res.status(500).json({ error: "Failed to delete department" });
  }
});

export default router;