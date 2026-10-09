import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import  express  from "express";
import { departments, subjects } from "../db/schema/app.js";
import { db } from "../db/index.js";

const router = express.Router();

//Get all subjects with optional search, filtering and pagination
router.get('/', async (req, res) => {
    try {
        const { search, department, page = 1, limit = 10 } =req.query;

        const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
        const LimitPerPage = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 100); // Max 100 records per page

        const offset = (currentPage -1) * LimitPerPage;

        const filterConditions = [];

        // If search query exists, filter by subject name OR subject code
        // if search fitlerConditions push or match it with the name and code.
        if (search) {
            filterConditions.push(
                or(
                    ilike(subjects.name, `%${search}%`),
                    ilike(subjects.code, `%${search}%`),
                )
            );
        }
        // If department filter exits, match department name
        if (department) {
            const depPattern = `%${String(department).replace(/[%_]/g, '\\$&')}%`;
            filterConditions.push(ilike(departments.name, depPattern));
            
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
        .orderBy(desc(subjects.createdAt))
        .limit(LimitPerPage)
        .offset(offset);

        res.status(200).json({
            data: subjectsList,
            pagination: {
                page: currentPage,
                limit: LimitPerPage,
                total: totalCount,
                totalPage: Math.ceil(totalCount / LimitPerPage)
            }

        });
        
    } catch (e) {
        console.error(`Get /subjects error: ${e}`);
        // we will return status(500) that going to bring back a json object with the msg, this way if something goes wrong, we know where it went wrong.
        res.status(500).json({ error: 'Failed to get the subjects' });
        
    }

})
export default router;