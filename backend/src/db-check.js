import "dotenv/config";
import { getDb, closeDb } from "./services/store.js";

try {
  const db = await getDb();
  const result = await db.command({ ping: 1 });
  console.log(`MongoDB connection OK: ${db.databaseName}`);
  console.log(result);
} catch (error) {
  console.error(`MongoDB connection failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
