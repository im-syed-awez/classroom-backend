import "dotenv/config";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl.includes("[user]") || databaseUrl.includes("[password]")) {
  throw new Error("Set a valid Neon DATABASE_URL in classroom-backend/.env");
}

// Better Auth uses database transactions during signup. The neon-http driver
// does not support transactions, so use Neon’s Pool-backed driver instead.
const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle({ client: pool });