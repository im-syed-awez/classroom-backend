import { and, asc, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import  express  from "express";
import { classes, departments, subjects } from "../db/schema/app.js";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

const parseId = (value: unknown) => {
    const id = typeof value === "string" ? Number(value) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
};

const validateSubject = (body: Record<string, unknown>) => {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const departmentId = Number(body.departmentId);
    if (!name || name.length > 255) return { error: "Name is required and must be 255 characters or fewer." };
    if (!code || code.length > 50) return { error: "Code is required and must be 50 characters or fewer." };
    if (!Number.isInteger(departmentId) || departmentId < 1) return { error: "A valid department is required." };
    if (description.length > 255) return { error: "Description must be 255 characters or fewer." };
    return { value: { name, code, departmentId, description: description || null } };
};

//Get all subjects with optional search, filtering and pagination
router.get('/', async (req, res) => {
    try {
        const { search, department, page = 1, limit = 10, sortBy, sortOrder } =req.query;

        const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
        const LimitPerPage = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 100); // Max 100 records per page

        const offset = (currentPage -1) * LimitPerPage;

        const sortableColumns = {
            id: subjects.id,
            name: subjects.name,
            code: subjects.code,
            createdAt: subjects.createdAt,
            updatedAt: subjects.updatedAt,
        };
        const sortColumn = typeof sortBy === 'string' && Object.prototype.hasOwnProperty.call(sortableColumns, sortBy)
            ? sortableColumns[sortBy as keyof typeof sortableColumns]
            : undefined;
        const orderBy = sortColumn
            ? sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn)
            : desc(subjects.createdAt);

        const filterConditions = [];

        // If search query exists, filter by subject name OR subject code
        // if search fitlerConditions push or match it with the name and code.
        if (search) {
            filterConditions.push(
                or(
                    ilike(subjects.name, `%${String(search)}%`),
                    ilike(subjects.code, `%${String(search)}%`),
                )
            );
        }
        // If department filter exits, match department name
        if (department) {
            const departmentValue = String(department);
            const depPattern = `%${departmentValue.replace(/[%_]/g, '\\$&')}%`;
            const isDepartmentId = /^\d+$/.test(departmentValue);
            const departmentId = Number(departmentValue);
            filterConditions.push(isDepartmentId
                ? or(eq(departments.id, departmentId), ilike(departments.name, depPattern))
                : ilike(departments.name, depPattern));
        }
        // Combine all filters using AND if any exits
        const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;
        
        const countResult = await db
            .select({ count: sql<number>`count(*)`})
            .from(subjects)
        // Specifically what a LeftJoin does is it returns all rows from the left table and matching rows from the right table.
        // So, we wanns take all the data about the subjects, but we also want to get access to departmentId where it matches the id of a specific department.
            .leftJoin(departments, eq(subjects.departmentId, departments.id))
            .where(whereClause)
        const totalCount = countResult[0]?.count ?? 0;  
        // getTableColumns does it gets all the column of that specific table, but it also adds addtional columns that you wanna add.
        const subjectsList = await db.select({
            ...getTableColumns(subjects),
            department: { ...getTableColumns(departments) } 
        }).from(subjects).leftJoin(departments, eq(subjects.departmentId, departments.id))
        .where(whereClause)
        .orderBy(orderBy, asc(subjects.id))
        .limit(LimitPerPage)
        .offset(offset);

        res.status(200).json({
            data: subjectsList,
            pagination: {
                page: currentPage,
                limit: LimitPerPage,
                total: totalCount,
                totalPages: Math.ceil(totalCount / LimitPerPage)
            }

        });
        
    } catch (e) {
        console.error(`Get /subjects error: ${e}`);
        // we will return status(500) that going to bring back a json object with the msg, this way if something goes wrong, we know where it went wrong.
        res.status(500).json({ error: 'Failed to get the subjects' });
        
    }

});

router.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid subject ID" });
    try {
        const [data] = await db.select({
            ...getTableColumns(subjects),
            department: { ...getTableColumns(departments) },
        }).from(subjects)
            .leftJoin(departments, eq(subjects.departmentId, departments.id))
            .where(eq(subjects.id, id));
        if (!data) return res.status(404).json({ error: "Subject not found" });
        res.json({ data });
    } catch (error) {
        console.error("GET /subjects/:id error:", error);
        res.status(500).json({ error: "Failed to get subject" });
    }
});

router.post("/", requireRole("admin"), async (req, res) => {
    const parsed = validateSubject(req.body ?? {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
        const [data] = await db.insert(subjects).values(parsed.value!).returning();
        res.status(201).json({ data });
    } catch (error) {
        console.error("POST /subjects error:", error);
        res.status(500).json({ error: "Could not create subject. Check that its code and department are valid." });
    }
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid subject ID" });
    try {
        const [existing] = await db.select().from(subjects).where(eq(subjects.id, id));
        if (!existing) return res.status(404).json({ error: "Subject not found" });
        const parsed = validateSubject({ ...existing, ...(req.body ?? {}) });
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const [data] = await db.update(subjects).set(parsed.value!).where(eq(subjects.id, id)).returning();
        res.json({ data });
    } catch (error) {
        console.error("PATCH /subjects/:id error:", error);
        res.status(500).json({ error: "Could not update subject. Check that its code and department are valid." });
    }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid subject ID" });
    try {
        const [existing] = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, id));
        if (!existing) return res.status(404).json({ error: "Subject not found" });
        const [linkedClass] = await db.select({ id: classes.id }).from(classes)
            .where(eq(classes.subjectId, id)).limit(1);
        if (linkedClass) return res.status(409).json({ error: "Cannot delete a subject while classes use it. Reassign or delete those classes first." });
        await db.delete(subjects).where(eq(subjects.id, id));
        res.status(204).send();
    } catch (error) {
        console.error("DELETE /subjects/:id error:", error);
        res.status(500).json({ error: "Failed to delete subject" });
    }
});

export default router;