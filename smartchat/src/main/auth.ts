import {
  initAuthCreds,
  BufferJSON,
  AuthenticationState,
  AuthenticationCreds,
  makeCacheableSignalKeyStore,
  proto
} from "@whiskeysockets/baileys";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { join } from "path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import * as sqliteVec from "sqlite-vec";
import type { EmbeddingService } from "./services/search";
import { existsSync, copyFileSync, mkdirSync } from "fs";

// In dev, use the local db. In prod, use the userData dir
const dbPath = (() => {
  if (is.dev) {
    return join(__dirname, '../../prisma/dev.db');
  } else {
    const userDataDir = app.getPath("userData");
    if (!existsSync(userDataDir)) {
      mkdirSync(userDataDir, { recursive: true });
    }
    const dbFile = join(userDataDir, "dev.db");
    if (!existsSync(dbFile)) {
      const templatePath = join(process.resourcesPath, "resources", "template.db");
      console.log(`[Database] Production db not found. Copying template from ${templatePath} to ${dbFile}`);
      try {
        if (existsSync(templatePath)) {
          copyFileSync(templatePath, dbFile);
        } else {
          // Fallback if template is located under app unpacked resources
          const fallbackTemplatePath = join(app.getAppPath(), "resources", "template.db");
          if (existsSync(fallbackTemplatePath)) {
            copyFileSync(fallbackTemplatePath, dbFile);
          } else {
            console.error(`[Database] Template db not found at ${templatePath} or ${fallbackTemplatePath}`);
          }
        }
      } catch (err) {
        console.error("[Database] Failed to copy template database:", err);
      }
    }
    return dbFile;
  }
})();

// In Prisma 7, we pass a config object to the adapter factory.
// The factory will handle the creation of the better-sqlite3 instance.
const baseAdapter = new PrismaBetterSqlite3({
  url: `file:${dbPath}`,
});

/**
 * ADAPTER WRAPPING: 
 * We use a Proxy to intercept the 'connect' calls.
 * This allows us to access the underlying better-sqlite3 instance ('client')
 * and load the sqlite-vec extension directly into it.
 */
const adapter = new Proxy(baseAdapter, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (prop === "connect" || prop === "connectToShadowDb") {
      return async (...args: any[]) => {
        const conn = await (value as Function).apply(target, args);
        if (conn && conn.client) {
          try {
            let loadablePath = sqliteVec.getLoadablePath();
            if (loadablePath.includes('app.asar') && !loadablePath.includes('app.asar.unpacked')) {
              loadablePath = loadablePath.replace('app.asar', 'app.asar.unpacked');
            }
            conn.client.loadExtension(loadablePath);
            console.log("[AdapterPatch] sqlite-vec successfully loaded into connection");
          } catch (e) {
            console.error("[AdapterPatch] Failed to load sqlite-vec into connection:", e);
          }
        }
        return conn;
      };
    }
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export const prisma = new PrismaClient({ adapter });

/**
 * Initializes the vector database by creating the virtual table.
 * Should be called once at application startup.
 */
export const initVectorDb = async (embeddingService?: EmbeddingService) => {
  try {
    // 1. Create the virtual table with the correct 768 dimensions for Bhasha model
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(
        messageId TEXT PRIMARY KEY,
        vector FLOAT[768]
      );
    `);

    // 2. SELF-HEAL: Check for dimension mismatch (e.g., if it was previously 384)
    try {
      const dummyVector = JSON.stringify(new Array(768).fill(0));
      await prisma.$executeRawUnsafe(
        `SELECT count(*) FROM vec_messages WHERE vector MATCH ? AND k=1`,
        dummyVector
      );
    } catch (e: any) {
      if (e.message.includes("Dimension mismatch")) {
        console.warn("[VectorDB] Dimension mismatch detected. Recreating table with 768 dims...");
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS vec_messages`);
        await prisma.$executeRawUnsafe(`
          CREATE VIRTUAL TABLE vec_messages USING vec0(
            messageId TEXT PRIMARY KEY,
            vector FLOAT[768]
          );
        `);
      }
    }

    console.log("[VectorDB] sqlite-vec table initialized successfully (768 dims)");

    // 3. Check if we need to sync existing vectors from MessageVector to vec_messages
    const vecCountRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*) as count FROM vec_messages`
    );
    const vecCount = Number(vecCountRaw[0]?.count || 0);
    const prismaCount = await prisma.messageVector.count();

    if (vecCount < prismaCount) {
      console.log(`[VectorDB] Syncing missing vectors (${vecCount} vs ${prismaCount})...`);
      if (embeddingService) {
        await embeddingService.syncVectors();
      }
    }
  } catch (err) {
    console.error("[VectorDB] Failed to initialize vector table:", err);
  }
};

export const usePrismaAuthState = async (): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> => {
  const readData = async (id: string) => {
    try {
      const data = await prisma.authState.findUnique({
        where: { id },
      });
      if (data && data.data) {
        return JSON.parse(data.data, BufferJSON.reviver);
      }
      return null;
    } catch (error) {
      console.error("Error reading auth state:", error);
      return null;
    }
  };

  const writeData = async (data: any, id: string) => {
    try {
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      await prisma.authState.upsert({
        where: { id },
        update: { data: serialized },
        create: { id, data: serialized },
      });
    } catch (error) {
      console.error("Error writing auth state:", error);
    }
  };

  const creds: AuthenticationCreds =
    (await readData("creds")) || initAuthCreds();
  const baseKeyStore = {
    get: async (type, ids) => {
      const data: { [key: string]: any } = {};
      await Promise.all(
        ids.map(async (id) => {
          let value = await readData(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value;
        })
      );
      return data as any;
    },
    set: async (data) => {
      // Aggregate ALL key mutations into a single prisma.$transaction() call.
      // This replaces N individual SQLite lock/write/unlock cycles with ONE,
      // which is the primary fix for the slow 1-5 message trickle on reconnect.
      const ops: any[] = [];
      for (const category in data) {
        for (const id in data[category as keyof typeof data]) {
          const value = data[category as keyof typeof data]?.[id];
          const key = `${category}-${id}`;
          if (value !== null && value !== undefined) {
            const serialized = JSON.stringify(value, BufferJSON.replacer);
            ops.push(
              prisma.authState.upsert({
                where: { id: key },
                update: { data: serialized },
                create: { id: key, data: serialized },
              })
            );
          } else {
            // deleteMany won't throw if the row doesn't exist
            ops.push(prisma.authState.deleteMany({ where: { id: key } }));
          }
        }
      }
      if (ops.length > 0) {
        try {
          await prisma.$transaction(ops);
        } catch (err) {
          console.error('[AuthState] Batch keystore transaction failed:', err);
        }
      }
    },
  };
  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(baseKeyStore),
    },
    saveCreds: () => {
      return writeData(creds, "creds");
    },
  };
};
