const { parentPort } = require('node:worker_threads');
const { WorkerPluginRuntime } = require('@smartchat/sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

if (!parentPort) {
  throw new Error('This plugin must be run inside a Node.js Worker thread.');
}

const manifest = require('./manifest.json');
const runtime = new WorkerPluginRuntime(parentPort, manifest);
const ctx = runtime.getContext();

let transcriberPipeline = null;

ctx.onActivate(async () => {
  ctx.log.info('Voice Transcriber plugin activated');
});

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

ctx.contributions.registerMessageAction('transcribe', async (actionCtx) => {
  const chatJid = (actionCtx && actionCtx.chatJid) || 'test@s.whatsapp.net';
  const msgId = actionCtx && actionCtx.messageId;

  if (!msgId) {
    await ctx.ui?.toast('[Transcribe] No message specified', 'warning');
    throw new Error('Message ID is required');
  }

  let messages = [];
  try {
    messages = await ctx.messages?.getMessages(chatJid, 1, 50);
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
    await ctx.ui?.toast('⚠️ Target message is not an audio message.', 'warning');
    return { success: false, reason: 'NOT_AUDIO' };
  }

  // Launch overlay modal IMMEDIATELY with loading status
  let overlay = null;
  try {
    overlay = await ctx.ui?.showOverlay({
      panel: 'overlays/transcription.html',
      title: 'Audio Transcription',
      width: 520,
      height: 380,
      context: {
        status: 'loading',
        message: 'Preparing audio message...',
        chatJid,
        messageId: msgId
      },
      mode: 'handle'
    });
  } catch (err) {
    console.error('[VoiceTranscriber] Failed to show overlay handle:', err);
  }

  // Update progress state on overlay
  overlay?.send?.('status', {
    state: 'loading',
    message: 'Downloading audio message...'
  });

  let resolvedPath = null;
  try {
    const downloadRes = await ctx.messages?.downloadMedia(msgId);
    if (downloadRes && downloadRes.filePath && fs.existsSync(downloadRes.filePath)) {
      resolvedPath = downloadRes.filePath;
    } else if (downloadRes && downloadRes.localURI) {
      resolvedPath = resolveLocalMediaPath(downloadRes.localURI);
    }
  } catch (err) {
    console.warn('[VoiceTranscriber] downloadMedia fallback:', err);
  }

  if (!resolvedPath) {
    const localURI = rawContent.audioMessage?.localURI || targetMsg?.localURI;
    resolvedPath = resolveLocalMediaPath(localURI);
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    const errorMsg = 'Unable to download or locate audio file for transcription.';
    await ctx.ui?.toast(`⚠️ ${errorMsg}`, 'warning');
    overlay?.send?.('status', {
      state: 'error',
      message: errorMsg
    });
    return { success: false, reason: 'MEDIA_NOT_DOWNLOADED' };
  }

  overlay?.send?.('status', {
    state: 'loading',
    message: 'Transcribing speech with Whisper AI...'
  });

  let transcribedText = '';
  try {
    transcribedText = await transcribeAudioFile(resolvedPath);
  } catch (err) {
    console.error('[VoiceTranscriber] Speech recognition error:', err);
    await ctx.ui?.toast(`❌ Audio transcription failed: ${err.message}`, 'error');
    overlay?.send?.('status', {
      state: 'error',
      message: err.message || 'Speech recognition failed.'
    });
    throw err;
  }

  if (!transcribedText) {
    transcribedText = '(No audible English speech detected)';
  }

  const record = {
    id: 'trans-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    text: transcribedText,
    chatJid,
    messageId: msgId,
    timestamp: Date.now()
  };

  try {
    if (ctx.storage) {
      const history = (await ctx.storage.get('transcriptions')) || [];
      const list = Array.isArray(history) ? history : [];
      list.unshift(record);
      await ctx.storage.set('transcriptions', list);
    }
  } catch (err) {
    console.error('[VoiceTranscriber] Failed to persist transcription to storage:', err);
  }

  // Push final completion payload into the live overlay modal
  overlay?.send?.('status', {
    state: 'complete',
    text: transcribedText
  });

  await ctx.ui?.toast('✨ Audio transcribed!', 'success');

  return { success: true, transcription: transcribedText };
});
