import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { demoUsers } from "./db/schema/index.js";

async function runCrudDemo() {
  console.log("Performing CRUD operations...");

  const [newUser] = await db
    .insert(demoUsers)
    .values({
      name: "Admin User",
      email: `admin-${Date.now()}@example.com`,
    })
    .returning();

  if (!newUser) throw new Error("Failed to create demo user");
  console.log("CREATE:", newUser);

  const [foundUser] = await db
    .select()
    .from(demoUsers)
    .where(eq(demoUsers.id, newUser.id));
  console.log("READ:", foundUser);

  const [updatedUser] = await db
    .update(demoUsers)
    .set({ name: "Super Admin" })
    .where(eq(demoUsers.id, newUser.id))
    .returning();

  if (!updatedUser) throw new Error("Failed to update demo user");
  console.log("UPDATE:", updatedUser);

  const [deletedUser] = await db
    .delete(demoUsers)
    .where(eq(demoUsers.id, newUser.id))
    .returning();

  if (!deletedUser) throw new Error("Failed to delete demo user");
  console.log("DELETE: demo user deleted");
  console.log("CRUD demo completed successfully.");
}

runCrudDemo().catch((error: unknown) => {
  console.error("CRUD demo failed:", error);
  process.exitCode = 1;
});