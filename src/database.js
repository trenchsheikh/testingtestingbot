
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;

if (!MONGO_URI || !DB_NAME) {
  console.error('Missing MONGO_URI or DB_NAME in .env file!');
  process.exit(1);
}

let db;
const client = new MongoClient(MONGO_URI, {
  tls: true,
  tlsAllowInvalidCertificates: false,
  tlsAllowInvalidHostnames: false,
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  maxPoolSize: 10,
  retryWrites: true,
  retryReads: true
});

// Function to connect to the database
async function connectToDatabase() {
  if (db) return db;
  let retries = 3;
  while (retries > 0) {
    try {
      await client.connect();
      db = client.db(DB_NAME);
      console.log('✅ [DB] Successfully connected to MongoDB.');
      return db;
    } catch (error) {
      retries--;
      console.error(`❌ [DB] MongoDB connection attempt failed (${3-retries}/3):`, error.message);
      
      if (retries === 0) {
        console.error('❌ [DB] Could not connect to MongoDB after 3 attempts');
        console.error('❌ [DB] Please check your MONGO_URI and network connectivity');
        process.exit(1);
      }
      
      console.log(`⏳ [DB] Retrying connection in 5 seconds... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
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