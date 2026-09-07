import { Worker } from 'worker_threads';
import type { GroupMetadata } from '@whiskeysockets/baileys';
import { IWACommandSender } from './IWACommandSender';
import { ISocketUserContext } from '../../services/contacts/IContactService';
import { IMediaSocket } from '../../services/messages/IMediaService';
import { IWAEventBus } from '../../services/whatsapp/IWAEventBus';
import { WAEventMap } from '../../services/whatsapp/WAEventTypes';
import { WorkerCommandMessage, WorkerEventMessage } from '../whatsapp/whatsappWorker.types';
import { IWindowEventEmitter } from './IWindowEventEmitter';

/**
 * Per-command reply timeout. If the worker thread wedges without exiting (stuck
 * in a long synchronous Baileys/Prisma call, a deadlock on the shared SQLite
 * file, a dropped message), every `sendCommand` caller would otherwise hang
 * forever and leak its `pendingReplies` entry. A rejection lets callers surface
 * an error instead.
 */
const COMMAND_TIMEOUT_MS = 30_000;

/**
 * WAWorkerBridge
 * ==============
 * Coordinates spawning, lifecycle management, and communication with the background
 * WhatsApp worker thread. Re-emits domain events from the worker process on the Main
 * process WAEventBus and implements ISocketUserContext and IMediaSocket for UI/services dependency injection.
 */
export class WAWorkerBridge implements IWACommandSender, ISocketUserContext, IMediaSocket {
  private worker: Worker | null = null;
  private readonly pendingReplies = new Map<
    string,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private currentUser: { id: string; name?: string | null; lid?: string | null } | null | undefined = null;
  private commandCounter = 0;
  /** True while `stop()` is intentionally terminating the worker — suppresses the
   *  unexpected-exit supervision path. */
  private stopping = false;
  private unexpectedExitHandler: ((code: number) => void) | null = null;

  constructor(
    private readonly workerPath: string,
    private readonly dbPath: string,
    private readonly userDataPath: string,
    private readonly getBus: () => IWAEventBus | null,
    private readonly windowEmitter: IWindowEventEmitter
  ) {}

  public get user(): { id: string; name?: string | null; lid?: string | null } | null | undefined {
    return this.currentUser;
  }

  /**
   * Register a supervisor callback invoked when the worker thread exits
   * unexpectedly (non-zero code, not via `stop()`). Lets
   * `WhatsAppConnectionManager` drive a bounded reconnect instead of leaving
   * WhatsApp permanently dead until an app restart.
   */
  public setUnexpectedExitHandler(handler: (code: number) => void): void {
    this.unexpectedExitHandler = handler;
  }

  public isRunning(): boolean {
    return this.worker !== null;
  }

  public readonly signalRepository = {
    lidMapping: {
      getPNForLID: async (lid: string): Promise<string | null | undefined> => {
        return this.sendCommand<string | null | undefined>('get_pn_for_lid', { lid });
      }
    }
  };

  public readonly profilePictureUrl = async (
    jid: string,
    type: 'preview' | 'image'
  ): Promise<string | undefined> => {
    return this.sendCommand<string | undefined>('profile_picture_url', { jid, type });
  };

  public start(syncFullHistory: boolean, shouldSyncHistory: boolean): void {
    if (this.worker) {
      console.warn('[WAWorkerBridge] Worker already running, not starting again.');
      return;
    }

    console.log(`[WAWorkerBridge] Spawning WhatsApp worker from: ${this.workerPath}`);
    this.stopping = false;
    this.worker = new Worker(this.workerPath);

    this.worker.on('message', (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const event = msg as WorkerEventMessage;

      switch (event.type) {
        case 'reply': {
          const pending = this.pendingReplies.get(event.correlationId);
          if (pending) {
            pending.resolve(event.payload.result);
            this.pendingReplies.delete(event.correlationId);
          }
          break;
        }
        case 'reply_error': {
          const pending = this.pendingReplies.get(event.correlationId);
          if (pending) {
            pending.reject(new Error(event.error));
            this.pendingReplies.delete(event.correlationId);
          }
          break;
        }
        case 'domain_event': {
          const { event: domainEvent, data } = event.payload;

          if (domainEvent === 'connection.update') {
            const update = data as { creds?: { me?: { id: string; name?: string | null; lid?: string | null } } } | null;
            if (update?.creds?.me) {
              this.currentUser = {
                id: update.creds.me.id,
                name: update.creds.me.name || null,
                lid: update.creds.me.lid || null
              };
            }
          }

          if (
            domainEvent === 'wa-qr' ||
            domainEvent === 'wa-logged-out' ||
            domainEvent === 'wa-connected' ||
            domainEvent === 'wa-sync-progress' ||
            domainEvent === 'wa-sync-status' ||
            domainEvent === 'wa-sync-complete'
          ) {
            this.windowEmitter.send(domainEvent, data);
          }

          const bus = this.getBus();
          if (bus) {
            const typedEventName = domainEvent as keyof WAEventMap;
            let busPayload = data;
            if (data && typeof data === 'object') {
              if (
                typedEventName === 'message:incoming' ||
                typedEventName === 'messages:append' ||
                typedEventName === 'message:edited' ||
                typedEventName === 'message:decrypted' ||
                typedEventName === 'presence:update' ||
                typedEventName === 'receipt:update' ||
                typedEventName === 'reaction:update'
              ) {
                busPayload = { ...(data as object), sock: this };
              }
            }
            bus.emit(typedEventName, busPayload as WAEventMap[typeof typedEventName]).catch((err: unknown) => {
              console.error(`[WAWorkerBridge] Failed to emit domain event ${domainEvent} on Main process bus:`, err);
            });
          }
          break;
        }
      }
    });

    this.worker.on('error', (err: Error) => {
      console.error('[WAWorkerBridge] Worker critical error:', err);
    });

    this.worker.on('exit', (code: number) => {
      console.log(`[WAWorkerBridge] Worker exited with code: ${code}`);
      const wasStopping = this.stopping;
      this.worker = null;
      this.currentUser = null;
      for (const [correlationId, pending] of this.pendingReplies.entries()) {
        pending.reject(new Error(`Worker exited with code ${code} before replying`));
        this.pendingReplies.delete(correlationId);
      }

      // Unsupervised worker death: without this, WhatsApp goes permanently dead
      // (no reconnect, no QR, no UI signal) until the user restarts the app.
      if (!wasStopping && code !== 0) {
        try {
          this.windowEmitter.send('wa-disconnected', { code });
        } catch (err) {
          console.error('[WAWorkerBridge] Failed to emit wa-disconnected:', err);
        }
        try {
          this.unexpectedExitHandler?.(code);
        } catch (err) {
          console.error('[WAWorkerBridge] Unexpected-exit handler threw:', err);
        }
      }
    });

    this.worker.postMessage({
      type: 'init',
      correlationId: 'init-call',
      payload: {
        dbPath: this.dbPath,
        userDataPath: this.userDataPath,
        syncFullHistory,
        shouldSyncHistory
      }
    } as WorkerCommandMessage);
  }

  public async stop(): Promise<void> {
    if (!this.worker) return;
    console.log('[WAWorkerBridge] Stopping worker thread...');
    this.stopping = true;
    await this.worker.terminate();
    this.worker = null;
    this.currentUser = null;
  }

  private async sendCommand<T>(type: string, payload?: unknown): Promise<T> {
    if (!this.worker) {
      throw new Error('Worker thread is not running');
    }
    const correlationId = `cmd-${++this.commandCounter}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingReplies.delete(correlationId)) {
          reject(new Error(`[WAWorkerBridge] Command "${type}" timed out after ${COMMAND_TIMEOUT_MS}ms (worker unresponsive)`));
        }
      }, COMMAND_TIMEOUT_MS);

      this.pendingReplies.set(correlationId, {
        resolve: (val: unknown) => {
          clearTimeout(timer);
          (resolve as (val: unknown) => void)(val);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        }
      });

      const message = {
        type,
        correlationId,
        payload
      } as WorkerCommandMessage;

      this.worker?.postMessage(message);
    });
  }

  public async sendMessage(
    jid: string,
    content: unknown,
    options?: unknown
  ): Promise<unknown> {
    return this.sendCommand('send_message', { jid, content, options });
  }

  public async readMessages(keys: unknown[]): Promise<void> {
    await this.sendCommand('read_messages', { keys });
  }

  public async chatModify(modification: unknown, jid: string): Promise<void> {
    await this.sendCommand('chat_modify', { jid, modification });
  }

  public async groupFetchAllParticipating(): Promise<Record<string, GroupMetadata>> {
    return this.sendCommand<Record<string, GroupMetadata>>('group_fetch_all');
  }

  public async groupMetadata(jid: string): Promise<GroupMetadata> {
    return this.sendCommand<GroupMetadata>('group_metadata', { jid });
  }

  public async logout(): Promise<void> {
    await this.sendCommand<void>('logout');
  }

  public async skipSync(): Promise<void> {
    await this.sendCommand<void>('skip_sync');
  }

  public async updateMediaMessage(msg: unknown): Promise<unknown> {
    return this.sendCommand('update_media_message', { msg });
  }
}
