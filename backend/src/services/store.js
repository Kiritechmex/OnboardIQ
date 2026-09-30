import { MongoClient } from "mongodb";

let client = null;
let db = null;

export async function getDb() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DATABASE || "onboardx");

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("employees").createIndex({ organizationId: 1, createdAt: -1 }),
    db.collection("tasks").createIndex({ employeeId: 1, status: 1 }),
    db.collection("notifications").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("escalations").createIndex({ employeeId: 1, createdAt: -1 }),
    db.collection("auditLogs").createIndex({ createdAt: -1 }),
  ]);

  return db;
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
