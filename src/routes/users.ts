import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { session, user } from "../db/schema/auth.js";
import { classes, enrollments } from "../db/schema/app.js";
import { requireRole } from "../middleware/auth.js";
import { auth } from "../lib/auth.js";

const router = express.Router();

router.use(requireRole("admin", "teacher"));

// Get all users with optional search, role filtering, and pagination
router.get("/", async (req, res) => {
    try {
        const { search, role, page = 1, limit = 10 } = req.query;

        const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
        const LimitPerPage = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 100);
        const offset = (currentPage - 1) * LimitPerPage;

        const filterConditions = [];

        if (search) {
            filterConditions.push(
                or(
                    ilike(user.name, `%${String(search)}%`),
                    ilike(user.email, `%${String(search)}%`),
                )
            );
        }
        const requestedRole = req.user?.role === "admin"
            ? role
            : role === "student" ? "student" : "teacher";
        if (requestedRole) {
            filterConditions.push(eq(user.role, String(requestedRole) as "student" | "teacher" | "admin"));
        }

        const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;

        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(user)
            .where(whereClause);
        const totalCount = countResult[0]?.count ?? 0;

        const usersList = requestedRole === "student"
            ? await db.select({ id: user.id, name: user.name, image: user.image })
                .from(user).where(whereClause).orderBy(desc(user.createdAt))
                .limit(LimitPerPage).offset(offset)
            : await db.select({ ...getTableColumns(user) })
                .from(user).where(whereClause).orderBy(desc(user.createdAt))
                .limit(LimitPerPage).offset(offset);

        res.status(200).json({
            data: usersList,
            pagination: {
                page: currentPage,
                limit: LimitPerPage,
                total: totalCount,
                totalPages: Math.ceil(totalCount / LimitPerPage),
            },
        });
    } catch (e) {
        console.error(`Get /users error: ${e}`);
        res.status(500).json({ error: "Failed to get the users" });
    }
});

router.get("/:id", requireRole("admin"), async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) return res.status(400).json({ error: "Invalid user ID" });
    try {
        const [data] = await db.select({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            image: user.image,
            imageCldPubId: user.imageCldPubId,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        }).from(user).where(eq(user.id, id));
        if (!data) return res.status(404).json({ error: "User not found" });
        res.json({ data });
    } catch (error) {
        console.error("GET /users/:id error:", error);
        res.status(500).json({ error: "Failed to get user" });
    }
});

router.post("/", requireRole("admin"), async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const role = req.body?.role;
    const image = typeof req.body?.image === "string" ? req.body.image : null;
    if (name.length < 2 || name.length > 255) return res.status(400).json({ error: "Name must be between 2 and 255 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Temporary password must be between 8 and 128 characters." });
    if (role !== "admin" && role !== "teacher" && role !== "student") return res.status(400).json({ error: "Select a valid user role." });

    try {
        const result = await auth.api.signUpEmail({ body: { name, email, password } });
        if (!result?.user?.id) return res.status(500).json({ error: "Account creation did not return a user." });
        const [created] = await db.update(user).set({ role, image }).where(eq(user.id, result.user.id)).returning({
            id: user.id, name: user.name, email: user.email, role: user.role,
            image: user.image, emailVerified: user.emailVerified,
            createdAt: user.createdAt, updatedAt: user.updatedAt,
        });
        return res.status(201).json({ data: created });
    } catch (error) {
        console.error("POST /users error:", error);
        return res.status(409).json({ error: "Could not create the account. The email may already be registered." });
    }
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) return res.status(400).json({ error: "Invalid user ID" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const role = req.body?.role;
    if (name.length < 2 || name.length > 255) return res.status(400).json({ error: "Name must be between 2 and 255 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (role !== "admin" && role !== "teacher" && role !== "student") return res.status(400).json({ error: "Select a valid user role." });

    try {
        const [existing] = await db.select({ id: user.id, role: user.role, email: user.email }).from(user).where(eq(user.id, id));
        if (!existing) return res.status(404).json({ error: "User not found" });
        if (id === req.user?.id && role !== "admin") return res.status(409).json({ error: "You cannot remove your own administrator role." });
        if (existing.role === "admin" && role !== "admin") {
            const [adminCount] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(user).where(eq(user.role, "admin"));
            if ((adminCount?.count ?? 0) <= 1) return res.status(409).json({ error: "The last administrator cannot be demoted." });
        }

        const [updated] = await db.update(user).set({ name, email, role, emailVerified: email === existing.email }).where(eq(user.id, id)).returning({
            id: user.id, name: user.name, email: user.email, role: user.role,
            image: user.image, emailVerified: user.emailVerified,
            createdAt: user.createdAt, updatedAt: user.updatedAt,
        });
        if (existing.role !== role) await db.delete(session).where(eq(session.userId, id));
        res.json({ data: updated });
    } catch (error) {
        console.error("PATCH /users/:id error:", error);
        res.status(409).json({ error: "Could not update user. Check that the email is unique." });
    }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) return res.status(400).json({ error: "Invalid user ID" });
    try {
        const [existing] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, id));
        if (!existing) return res.status(404).json({ error: "User not found" });
        if (id === req.user?.id) return res.status(409).json({ error: "You cannot delete your own account while signed in." });
        if (existing.role === "admin") {
            const [adminCount] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(user).where(eq(user.role, "admin"));
            if ((adminCount?.count ?? 0) <= 1) return res.status(409).json({ error: "The last administrator cannot be deleted." });
        }
        const [ownedClass] = await db.select({ id: classes.id }).from(classes).where(eq(classes.teacherId, id)).limit(1);
        if (ownedClass) return res.status(409).json({ error: "Cannot delete a teacher who owns classes. Reassign or delete the classes first." });
        const [enrollment] = await db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.studentId, id)).limit(1);
        if (enrollment) return res.status(409).json({ error: "Cannot delete a student who is enrolled. Remove enrollments first." });
        await db.delete(user).where(eq(user.id, id));
        res.status(204).send();
    } catch (error) {
        console.error("DELETE /users/:id error:", error);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

export default router;
