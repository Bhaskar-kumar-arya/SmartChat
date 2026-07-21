const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeline } = require('@xenova/transformers');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const pdfParse = require('pdf-parse');
const { pdfToPng } = require('pdf-to-png-converter');
const Tesseract = require('tesseract.js');

// Configure ffmpeg path if ffmpeg-static is present
if (ffmpegStatic) {
  const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  ffmpeg.setFfmpegPath(ffmpegPath);
}

let transcriber = null;

function ensureBuffer(val) {
  if (!val) return null;
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array) return Buffer.from(val.buffer, val.byteOffset, val.byteLength);
  if (typeof val === 'string') {
    if (/^[0-9a-fA-F]+$/.test(val) && val.length % 2 === 0) {
      return Buffer.from(val, 'hex');
    }
    return Buffer.from(val, 'base64');
  }
  if (typeof val === 'object') {
    const obj = val;
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return Buffer.from(obj.data);
    }
    if (Array.isArray(val)) {
      return Buffer.from(val);
    }
  }
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function decodeAudioToPcmf32(inputPath, log) {
  const outputPath = path.join(os.tmpdir(), `transcribe_${Date.now()}.raw`);
  
  log.info(`FFmpeg decoding started for input: ${inputPath}`);
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le') // 16-bit signed PCM (industry-standard, highly robust)
      .format('s16le')
      .output(outputPath)
      .on('end', () => {
        log.info('FFmpeg decoding finished successfully.');
        resolve();
      })
      .on('error', (err) => {
        log.error('FFmpeg decoding failed: ' + err.message);
        reject(err);
      })
      .run();
  });

  const buffer = fs.readFileSync(outputPath);
  log.info(`Decoded PCM file size: ${buffer.length} bytes`);
  try {
    fs.unlinkSync(outputPath);
  } catch (e) {}

  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const int16Samples = new Int16Array(ab);
  log.info(`Int16Array length: ${int16Samples.length}`);
  
  const float32Samples = new Float32Array(int16Samples.length);
  for (let i = 0; i < int16Samples.length; i++) {
    float32Samples[i] = int16Samples[i] / 32768.0;
  }
  
  log.info(`Float32Array length: ${float32Samples.length}`);
  log.info(`First 10 samples: ${Array.from(float32Samples.slice(0, 10)).join(', ')}`);
  
  return float32Samples;
}

module.exports = async function (ctx) {
  ctx.log.info('Audio Transcriber Bot loading...');

  // Initialize pipeline lazily or on activation
  ctx.onActivate(async () => {
    ctx.log.info('Initializing Whisper transcription model (English)...');
    try {
      // Load small English whisper model via Transformers.js
      transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny.en'
      );
      ctx.log.info('Transcriber model loaded successfully.');
    } catch (err) {
      ctx.log.error('Failed to load transcription model:', err.message);
    }
  });

  if (!ctx.events) {
    ctx.log.warn('Events permission not granted.');
    return;
  }

  // Subscribe to incoming messages
  const unsub = ctx.events.on('message:incoming', async (payload) => {
    // Ignore messages sent by yourself
    if (payload.fromMe) return;

    const enriched = payload.enriched;
    if (!enriched) return;

    // Check if the message is an audio message or voice note
    const isAudio =
      enriched.messageType === 'audioMessage' ||
      enriched.messageType === 'ptvMessage';

    // Parse raw message content
    const rawContent = enriched.content ? JSON.parse(enriched.content) : null;

    // Check for PDF document
    const documentMessage = rawContent ? (
      rawContent.documentMessage || 
      (rawContent.documentWithCaptionMessage && 
       rawContent.documentWithCaptionMessage.message && 
       rawContent.documentWithCaptionMessage.message.documentMessage)
    ) : null;

    const isPdf = documentMessage && documentMessage.mimetype === 'application/pdf';

    if (!isAudio && !isPdf) return;

    ctx.log.info(`Detected incoming ${isAudio ? 'audio' : 'PDF'} message in chat ${payload.chatJid}`);

    if (isAudio) {
      try {
        const audioMessage = rawContent ? (rawContent.audioMessage || rawContent.ptvMessage) : null;
        if (!audioMessage) {
          ctx.log.warn('No audio message body found in payload content.');
          return;
        }

        ctx.log.info('Downloading audio from WhatsApp CDN...');
        
        const downloadable = {
          mediaKey: ensureBuffer(audioMessage.mediaKey),
          directPath: audioMessage.directPath,
          url: audioMessage.url
        };

        if (!downloadable.mediaKey || !downloadable.directPath) {
          ctx.log.warn('Missing mediaKey or directPath required to download the audio.');
          return;
        }

        const stream = await downloadContentFromMessage(downloadable, 'audio');
        const audioBuffer = await streamToBuffer(stream);

        if (audioBuffer.length === 0) {
          throw new Error('Downloaded audio stream was 0 bytes');
        }

        // Write download buffer to a temporary file
        const tempInputPath = path.join(os.tmpdir(), `input_${Date.now()}.ogg`);
        fs.writeFileSync(tempInputPath, audioBuffer);

        ctx.log.info('Decoding audio to 16kHz Float32 PCM...');
        const float32Samples = await decodeAudioToPcmf32(tempInputPath, ctx.log);

        // Clean up temp input file
        try {
          fs.unlinkSync(tempInputPath);
        } catch (e) {}

        // 2. Perform transcription
        ctx.log.info('Transcribing audio...');
        const result = await transcriber(float32Samples); // No options (English-only model doesn't support multilingual params)

        const transcribedText = result.text.trim();
        ctx.log.info('Transcription result:', transcribedText);

        // 3. Notify user or send a reply back to the chat using tools if available
        if (ctx.ui) {
          ctx.ui.toast(`Audio Transcribed: ${transcribedText.slice(0, 50)}...`, 'info');
        }

        if (ctx.tools) {
          await ctx.tools.call('sendMessage', {
            jid: payload.chatJid,
            text: `📝 *Audio Transcription:* \n${transcribedText}`,
          });
        }
      } catch (err) {
        ctx.log.error('Error processing audio transcription:', err.message);
      }
    }

    if (isPdf) {
      try {
        ctx.log.info('Downloading PDF from WhatsApp CDN...');
        const downloadable = {
          mediaKey: ensureBuffer(documentMessage.mediaKey),
          directPath: documentMessage.directPath,
          url: documentMessage.url
        };

        if (!downloadable.mediaKey || !downloadable.directPath) {
          ctx.log.warn('Missing mediaKey or directPath required to download the PDF.');
          return;
        }

        if (ctx.ui) {
          ctx.ui.toast('Downloading PDF and extracting text...', 'info');
        }

        const stream = await downloadContentFromMessage(downloadable, 'document');
        const pdfBuffer = await streamToBuffer(stream);

        if (pdfBuffer.length === 0) {
          throw new Error('Downloaded PDF stream was 0 bytes');
        }

        // 1. Attempt native extraction
        ctx.log.info('Attempting native text extraction from PDF...');
        const parsed = await pdfParse(pdfBuffer);
        let text = parsed.text ? parsed.text.trim() : '';

        ctx.log.info(`Native extraction retrieved ${text.length} characters.`);

        // 2. OCR Fallback if text is empty/short
        if (text.length < 20) {
          ctx.log.info('Low character count detected. Running Tesseract OCR fallback...');
          if (ctx.ui) {
            ctx.ui.toast('PDF is scanned. Running OCR (Tesseract)...', 'info');
          }

          ctx.log.info('Converting PDF pages to PNG buffers...');
          const pngPages = await pdfToPng(pdfBuffer, { viewportScale: 2.0 });
          ctx.log.info(`PDF converted to ${pngPages.length} image pages.`);

          let ocrText = '';
          for (let i = 0; i < pngPages.length; i++) {
            ctx.log.info(`Running Tesseract OCR on page ${i + 1}/${pngPages.length}...`);
            const { data: { text: pageText } } = await Tesseract.recognize(
              pngPages[i].content,
              'eng',
              {
                logger: m => {
                  if (m.status === 'recognizing text') {
                    ctx.log.info(`Page ${i + 1} OCR Progress: ${(m.progress * 100).toFixed(0)}%`);
                  }
                }
              }
            );
            ocrText += `--- Page ${i + 1} ---\n${pageText}\n\n`;
          }
          text = ocrText.trim();
        }

        if (!text) {
          text = "(No text could be extracted or OCR'd from this PDF.)";
        }

        ctx.log.info('PDF OCR/extraction complete.');

        if (ctx.ui) {
          ctx.ui.toast('PDF Text Extracted Successfully!', 'success');
        }

        if (ctx.tools) {
          const fileName = documentMessage.fileName || 'document.pdf';
          await ctx.tools.call('sendMessage', {
            jid: payload.chatJid,
            text: `📄 *PDF Content Extracted [${fileName}]:* \n\n${text}`,
          });
        }
      } catch (err) {
        ctx.log.error('Error processing PDF OCR/extraction:', err.message);
        if (ctx.ui) {
          ctx.ui.toast(`PDF processing failed: ${err.message}`, 'error');
        }
      }
    }
  });

  ctx.onDeactivate(async () => {
    ctx.log.info('Audio Transcriber Bot deactivated.');
    unsub();
  });
};