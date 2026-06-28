import {
  initAuthCreds,
  BufferJSON,
  AuthenticationState,
  AuthenticationCreds,
  makeCacheableSignalKeyStore,
  proto,
  SignalKeyStore,
  SignalDataTypeMap
} from "@whiskeysockets/baileys";
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Standalone, worker-compatible Baileys AuthState provider.
 * Interacts with the database using the provided PrismaClient instance.
 * Does not depend on Electron or main-process specific modules.
 */
export const useLocalPrismaAuthState = async (
  prisma: PrismaClient
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> => {
  const readData = async (id: string): Promise<unknown | null> => {
    try {
      const data = await prisma.authState.findUnique({
        where: { id },
      });
      if (data && data.data) {
        return JSON.parse(data.data, BufferJSON.reviver);
      }
      return null;
    } catch (error: unknown) {
      console.error("[LocalAuthState] Error reading auth state:", error);
      return null;
    }
  };

  const writeData = async (data: unknown, id: string): Promise<void> => {
    try {
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      await prisma.authState.upsert({
        where: { id },
        update: { data: serialized },
        create: { id, data: serialized },
      });
    } catch (error: unknown) {
      console.error("[LocalAuthState] Error writing auth state:", error);
    }
  };

  const creds: AuthenticationCreds =
    (await readData("creds") as AuthenticationCreds) || initAuthCreds();

  const baseKeyStore: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};
      await Promise.all(
        ids.map(async (id) => {
          let value = await readData(`${type}-${id}`);
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
          }
          data[id] = value as SignalDataTypeMap[T];
        })
      );
      return data;
    },
    set: async (data): Promise<void> => {
      const ops: Prisma.PrismaPromise<unknown>[] = [];
      for (const category in data) {
        const categoryData = data[category];
        if (!categoryData) continue;

        for (const id in categoryData) {
          const value = categoryData[id];
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
            ops.push(prisma.authState.deleteMany({ where: { id: key } }));
          }
        }
      }
      if (ops.length > 0) {
        try {
          await prisma.$transaction(ops);
        } catch (err: unknown) {
          console.error("[LocalAuthState] Batch keystore transaction failed:", err);
        }
      }
    },
  };

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(baseKeyStore),
    },
    saveCreds: async (): Promise<void> => {
      await writeData(creds, "creds");
    },
  };
};
