
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;

if (!MONGO_URI || !DB_NAME) {
  console.error('Missing MONGO_URI or DB_NAME in .env file!');
  process.exit(1);
}

let db;
const client = new MongoClient(MONGO_URI);

// Function to connect to the database
async function connectToDatabase() {
  if (db) return db;
  try {
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ [DB] Successfully connected to MongoDB.');
    return db;
  } catch (error) {
    console.error('❌ [DB] Could not connect to MongoDB:', error);
    process.exit(1);
  }
}

// Function to save or update a user's session
export async function saveUserSession(userId, sessionData) {
  const database = await connectToDatabase();
  const users = database.collection('users');

  // Use 'updateOne' with 'upsert: true' to either update an existing user or create a new one
  await users.updateOne(
    { _id: userId },
    { $set: sessionData },
    { upsert: true }
  );
  console.log(`💾 [DB] Saved session for user: ${userId}`);
}

// Function to load a user's session
export async function loadUserSession(userId) {
  const database = await connectToDatabase();
  const users = database.collection('users');
  const session = await users.findOne({ _id: userId });
  if (session) {
    console.log(`🔍 [DB] Loaded session for user: ${userId}`);
  }
  return session;
}