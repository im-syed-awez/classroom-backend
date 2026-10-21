import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { user } from "../db/schema/auth.js";
import { requireRole } from "../middleware/auth.js";

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

export default router;
