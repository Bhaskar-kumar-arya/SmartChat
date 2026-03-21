import {
  initAuthCreds,
  BufferJSON,
  AuthenticationState,
  AuthenticationCreds,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import { PrismaClient } from "@prisma/client";
import { join } from "path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";

// In dev, use the local db. In prod, use the userData dir
const dbPath = is.dev 
  ? join(__dirname, '../../prisma/dev.db') 
  : join(app.getPath("userData"), "dev.db");

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}?connection_limit=1&timeout=30000`,
    },
  },
});

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

  const removeData = async (id: string) => {
    try {
      await prisma.authState.delete({
        where: { id },
      });
    } catch (error) {
      // Ignore if not found
    }
  };

  const creds: AuthenticationCreds =
    (await readData("creds")) || initAuthCreds();
  const baseKeyStore = {
    get: async (type, ids) => {
      const data: { [key: string]: any } = {};
      await Promise.all(
        ids.map(async (id) => {
          const value = await readData(`${type}-${id}`);
          data[id] = value;
        })
      );
      return data as any;
    },
    set: async (data) => {
      // It's better to run these concurrently rather than strictly sequentially
      const tasks: Promise<void>[] = [];
      for (const category in data) {
        for (const id in data[category as keyof typeof data]) {
          const value = data[category as keyof typeof data]?.[id];
          const key = `${category}-${id}`;
          if (value) {
            tasks.push(writeData(value, key));
          } else {
            tasks.push(removeData(key));
          }
        }
      }
      await Promise.all(tasks);
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
