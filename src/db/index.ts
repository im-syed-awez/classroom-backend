import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl.includes("[user]") || databaseUrl.includes("[password]")) {
  throw new Error("Set a valid Neon DATABASE_URL in classroom-backend/.env");
}

const sql = neon(databaseUrl);
export const db = drizzle(sql);