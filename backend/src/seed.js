import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./services/store.js";
import { generateTasks, recalculate } from "./services/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(await fs.readFile(path.join(__dirname, "data/store.json"), "utf8"));
const db = await getDb();

await Promise.all([
  db.collection("users").deleteMany({}),
  db.collection("employees").deleteMany({}),
  db.collection("tasks").deleteMany({}),
  db.collection("notifications").deleteMany({}),
  db.collection("escalations").deleteMany({}),
  db.collection("auditLogs").deleteMany({}),
]);

if (source.users.length) await db.collection("users").insertMany(source.users);
if (source.employees.length) await db.collection("employees").insertMany(source.employees);
if (source.tasks.length) await db.collection("tasks").insertMany(source.tasks);
if (source.notifications.length) await db.collection("notifications").insertMany(source.notifications);
if (source.escalations.length) await db.collection("escalations").insertMany(source.escalations);
if (source.auditLogs.length) await db.collection("auditLogs").insertMany(source.auditLogs);

for (const employee of source.employees) {
  await recalculate(db, employee.id);
}

for (const employee of source.employees) {
  const count = await db.collection("tasks").countDocuments({ employeeId: employee.id });
  if (!count) await db.collection("tasks").insertMany(generateTasks(employee));
}

console.log(`Seeded MongoDB database: ${db.databaseName}`);
process.exit(0);
