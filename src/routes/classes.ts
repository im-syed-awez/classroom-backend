
import express from "express";
import { db } from "../db/index.js";
import { classes } from "../db/schema/app.js";

const router = express.Router();
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

