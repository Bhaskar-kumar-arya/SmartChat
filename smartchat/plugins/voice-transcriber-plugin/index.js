const { parentPort } = require('node:worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

if (!parentPort) {
  throw new Error('This plugin must be run inside a Node.js Worker thread.');
}

const pendingRequests = new Map();
let transcriberPipeline = null;

function sendRequest(type, payload) {
  const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    parentPort.postMessage({ id, type, payload });
  });
}

function respondSuccess(id, payload) {
  parentPort.postMessage({ id, ok: true, payload });
}

function respondError(id, code, message) {
  parentPort.postMessage({ id, ok: false, error: { code, message } });
}

/**
 * Resolves local app://media/ URIs or raw filenames to the actual absolute filesystem path on disk.
 */
function resolveLocalMediaPath(localURI) {
  if (!localURI || typeof localURI !== 'string') return null;
  
  if (fs.existsSync(localURI)) return localURI;

  const fileName = localURI.replace(/^app:\/\/media\//, '').replace(/^app:\/\//, '');
  if (!fileName) return null;

  const candidateDirs = [
    path.join(process.env.APPDATA || '', 'smartchat', 'media'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'smartchat', 'media'),
    path.join(os.homedir(), 'Library', 'Application Support', 'smartchat', 'media'),
    path.join(os.homedir(), '.config', 'smartchat', 'media'),
    path.join(process.cwd(), 'media')
  ];

  for (const dir of candidateDirs) {
    const fullPath = path.join(dir, fileName);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Locates FFmpeg binary path from system or npm packages.
 */
function getFFmpegBinaryPath() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch (e) {}

  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  const rootFFmpeg = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', exeName);
  if (fs.existsSync(rootFFmpeg)) return rootFFmpeg;

  const pluginFFmpeg = path.join(__dirname, 'node_modules', 'ffmpeg-static', exeName);
  if (fs.existsSync(pluginFFmpeg)) return pluginFFmpeg;

  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path && fs.existsSync(installer.path)) return installer.path;
  } catch (e) {}

  return 'ffmpeg';
}

/**
 * Decodes input audio file (Ogg/Opus/WebM/MP3) to 16kHz mono Float32Array audio buffer for Whisper model.
 */
function decodeAudioTo16kFloat32(filePath) {
  return new Promise((resolve, reject) => {
    const ffmpegBin = getFFmpegBinaryPath();
    const args = [
      '-i', filePath,
      '-f', 's16le',
      '-ac', '1',
      '-ar', '16000',
      'pipe:1'
    ];

    const proc = spawn(ffmpegBin, args);
    const chunks = [];

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', () => {});
    proc.on('error', (err) => reject(err));

    proc.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        return reject(new Error(`FFmpeg decoding failed with code ${code}`));
      }
      const buffer = Buffer.concat(chunks);
      const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }
      resolve(float32Array);
    });
  });
}

/**
 * Safely resolves @xenova/transformers from plugin node_modules or host application node_modules.
 */
function getTransformersModule() {
  try {
    return require('@xenova/transformers');
  } catch (e) {}

  const candidates = [
    path.join(__dirname, 'node_modules', '@xenova', 'transformers'),
    path.join(process.cwd(), 'node_modules', '@xenova', 'transformers')
  ];

  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) {
        return require(cand);
      }
    } catch (e) {}
  }

  throw new Error("Cannot find module '@xenova/transformers'");
}

/**
 * Transcribes English audio file using @xenova/transformers Whisper model.
 */
async function transcribeAudioFile(filePath) {
  const transformers = getTransformersModule();

  if (!transcriberPipeline) {
    transcriberPipeline = await transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
  }

  const audioBuffer = await decodeAudioTo16kFloat32(filePath);
  const result = await transcriberPipeline(audioBuffer);

  if (result && typeof result.text === 'string') {
    return result.text.trim();
  }
  return '';
}

parentPort.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  // Handle kernel responses to plugin requests
  if (msg.id && typeof msg.ok === 'boolean') {
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.payload);
      } else {
        pending.reject(new Error(msg.error ? msg.error.message : 'Request failed'));
      }
    }
    return;
  }

  // Handle incoming requests sent to plugin from kernel
  if (msg.id && typeof msg.type === 'string') {
    const { id, type, payload } = msg;

    try {
      if (type === 'plugin:activate') {
        parentPort.postMessage({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: 'kernel:log',
          payload: { level: 'info', message: 'Voice Transcriber plugin activated' }
        });
        respondSuccess(id);
        return;
      }

      if (type === 'plugin:deactivate') {
        respondSuccess(id);
        return;
      }

      if (type.startsWith('contribution:execute:message-action')) {
        const actionId = (payload && payload.id) || type.split(':')[3];
        if (actionId === 'transcribe') {
          const chatJid = (payload && payload.context && payload.context.chatJid) || 'test@s.whatsapp.net';
          const msgId = payload && payload.context && payload.context.messageId;

          if (!msgId) {
            await sendRequest('kernel:ui:toast', { message: '[Transcribe] No message specified', level: 'warning' });
            respondError(id, 'INVALID_ARGUMENT', 'Message ID is required');
            return;
          }

          // Fetch messages for this chat to find the target message
          let messages = [];
          try {
            messages = await sendRequest('kernel:messages:getMessages', { jid: chatJid, page: 1, limit: 50 });
          } catch (e) {
            console.error('[VoiceTranscriber] Failed to fetch chat messages:', e);
          }

          const msgList = Array.isArray(messages) ? messages : [];
          const targetMsg = msgList.find((m) => m.id === msgId);

          let isAudio = false;
          let rawContent = {};
          if (targetMsg) {
            const mType = targetMsg.messageType || '';
            if (mType === 'audioMessage' || mType === 'audio' || mType === 'ptvMessage') {
              isAudio = true;
            }
            if (targetMsg.content) {
              try {
                rawContent = typeof targetMsg.content === 'string' ? JSON.parse(targetMsg.content) : targetMsg.content;
                if (rawContent.audioMessage || rawContent.ptvMessage) {
                  isAudio = true;
                }
              } catch (e) {}
            }
          }

          if (!isAudio) {
            await sendRequest('kernel:ui:toast', {
              message: '⚠️ Target message is not an audio message.',
              level: 'warning'
            });
            respondSuccess(id, { success: false, reason: 'NOT_AUDIO' });
            return;
          }

          // Call microkernel downloadMedia API to automatically download media if needed
          let resolvedPath = null;
          try {
            const downloadRes = await sendRequest('kernel:messages:downloadMedia', { messageId: msgId });
            if (downloadRes && downloadRes.filePath && fs.existsSync(downloadRes.filePath)) {
              resolvedPath = downloadRes.filePath;
            } else if (downloadRes && downloadRes.localURI) {
              resolvedPath = resolveLocalMediaPath(downloadRes.localURI);
            }
          } catch (err) {
            console.warn('[VoiceTranscriber] kernel:messages:downloadMedia fallback:', err);
          }

          if (!resolvedPath) {
            const localURI = rawContent.audioMessage?.localURI || targetMsg?.localURI;
            resolvedPath = resolveLocalMediaPath(localURI);
          }

          if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            await sendRequest('kernel:ui:toast', {
              message: '⚠️ Unable to download or locate audio file for transcription.',
              level: 'warning'
            });
            respondSuccess(id, { success: false, reason: 'MEDIA_NOT_DOWNLOADED' });
            return;
          }

          // Notify user that transcription is starting
          await sendRequest('kernel:ui:toast', {
            message: '⏳ Transcribing English audio message...',
            level: 'info'
          });

          let transcribedText = '';
          try {
            transcribedText = await transcribeAudioFile(resolvedPath);
          } catch (err) {
            console.error('[VoiceTranscriber] Speech recognition error:', err);
            await sendRequest('kernel:ui:toast', {
              message: `❌ Audio transcription failed: ${err.message}`,
              level: 'error'
            });
            respondError(id, 'TRANSCRIPTION_FAILED', err.message);
            return;
          }

          if (!transcribedText) {
            transcribedText = '(No audible English speech detected)';
          }

          const formattedMessage = `🎤 Audio Transcription (English):\n"${transcribedText}"`;

          // Send transcription to the same chat JID
          await sendRequest('kernel:messages:send', {
            jid: chatJid,
            text: formattedMessage,
            quotedMsgId: msgId
          });

          // Show notifications
          try {
            await sendRequest('kernel:ui:notify', {
              title: 'Audio Transcribed',
              body: `Transcription sent to chat: "${transcribedText.slice(0, 40)}..."`
            });
          } catch (e) {}

          await sendRequest('kernel:ui:toast', {
            message: '✨ Audio transcribed and sent to chat!',
            level: 'success'
          });

          respondSuccess(id, { success: true, transcription: transcribedText });
        } else {
          respondError(id, 'NOT_FOUND', `Message action '${actionId}' not found`);
        }
        return;
      }

      respondError(id, 'NOT_FOUND', `Unhandled type '${type}'`);
    } catch (err) {
      respondError(id, 'INTERNAL_ERROR', err ? err.message : 'Unknown worker error');
    }
  }
});
