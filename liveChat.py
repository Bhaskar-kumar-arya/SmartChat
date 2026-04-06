import asyncio
import inspect
import logging
import traceback
import sys
import os
from google import genai
from google.genai import types

# Configure logging to only show warnings/errors for a cleaner UI
logging.basicConfig(level=logging.WARNING, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class GeminiLive:
    """
    Handles the interaction with the Gemini Live API.
    """
    def __init__(self, api_key, model, input_sample_rate=16000, tools=None, tool_mapping=None):
        """
        Initializes the GeminiLive client.

        Args:
            api_key (str): The Gemini API Key.
            model (str): The model name to use.
            input_sample_rate (int): The sample rate for audio input.
            tools (list, optional): List of tools to enable. Defaults to None.
            tool_mapping (dict, optional): Mapping of tool names to functions. Defaults to None.
        """
        self.api_key = api_key
        self.model = model
        self.input_sample_rate = input_sample_rate
        # For the live preview, we often use v1alpha
        self.client = genai.Client(api_key=api_key, http_options={'api_version': 'v1alpha'})
        self.tools = tools or []
        self.tool_mapping = tool_mapping or {}

    async def start_session(self, audio_input_queue, video_input_queue, text_input_queue, audio_output_callback, audio_interrupt_callback=None):
        """
        Starts the Live session and handles bidirectional streaming.
        """
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            ),
            system_instruction=types.Content(parts=[types.Part(text="You are a helpful AI assistant. Keep your responses concise. Speak in a friendly Irish accent. You can see the user's camera or screen which is shared as realtime input images with you.")]),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                turn_coverage="TURN_INCLUDES_ONLY_ACTIVITY",
            ),
            tools=self.tools,
        )
        
        logger.info(f"Connecting to Gemini Live with model={self.model}")
        try:
            async with self.client.aio.live.connect(model=self.model, config=config) as session:
                logger.info("Gemini Live session opened successfully")
                
                async def send_audio():
                    try:
                        while True:
                            chunk = await audio_input_queue.get()
                            await session.send_realtime_input(
                                audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={self.input_sample_rate}")
                            )
                    except asyncio.CancelledError:
                        logger.debug("send_audio task cancelled")
                    except Exception as e:
                        logger.error(f"send_audio error: {e}\n{traceback.format_exc()}")

                async def send_video():
                    try:
                        while True:
                            chunk = await video_input_queue.get()
                            logger.info(f"Sending video frame to Gemini: {len(chunk)} bytes")
                            await session.send_realtime_input(
                                video=types.Blob(data=chunk, mime_type="image/jpeg")
                            )
                    except asyncio.CancelledError:
                        logger.debug("send_video task cancelled")
                    except Exception as e:
                        logger.error(f"send_video error: {e}\n{traceback.format_exc()}")

                async def send_text():
                    try:
                        while True:
                            text = await text_input_queue.get()
                            logger.info(f"Sending text to Gemini: {text}")
                            await session.send_realtime_input(text=text)
                    except asyncio.CancelledError:
                        logger.debug("send_text task cancelled")
                    except Exception as e:
                        logger.error(f"send_text error: {e}\n{traceback.format_exc()}")

                event_queue = asyncio.Queue()

                async def receive_loop():
                    try:
                        while True:
                            async for response in session.receive():
                                logger.debug(f"Received response from Gemini: {response}")
                                
                                # Log flags for debugging
                                if response.go_away:
                                    logger.warning(f"Received GoAway from Gemini: {response.go_away}")
                                if response.session_resumption_update:
                                    logger.info(f"Session resumption update: {response.session_resumption_update}")
                                
                                server_content = response.server_content
                                tool_call = response.tool_call
                                
                                if server_content:
                                    if server_content.model_turn:
                                        for part in server_content.model_turn.parts:
                                            # Handle audio data
                                            if part.inline_data:
                                                if inspect.iscoroutinefunction(audio_output_callback):
                                                    await audio_output_callback(part.inline_data.data)
                                                else:
                                                    audio_output_callback(part.inline_data.data)
                                            # Handle direct text parts if any
                                            if part.text:
                                                await event_queue.put({"type": "gemini", "text": part.text})
                                    
                                    # Handle transcriptions
                                    if server_content.input_transcription and server_content.input_transcription.text:
                                        await event_queue.put({"type": "user", "text": server_content.input_transcription.text})
                                    
                                    if server_content.output_transcription and server_content.output_transcription.text:
                                        await event_queue.put({"type": "gemini", "text": server_content.output_transcription.text})
                                    
                                    if server_content.turn_complete:
                                        await event_queue.put({"type": "turn_complete"})
                                    
                                    if server_content.interrupted:
                                        if audio_interrupt_callback:
                                            if inspect.iscoroutinefunction(audio_interrupt_callback):
                                                await audio_interrupt_callback()
                                            else:
                                                audio_interrupt_callback()
                                        await event_queue.put({"type": "interrupted"})

                                if tool_call:
                                    function_responses = []
                                    for fc in tool_call.function_calls:
                                        func_name = fc.name
                                        args = fc.args or {}
                                        
                                        if func_name in self.tool_mapping:
                                            try:
                                                tool_func = self.tool_mapping[func_name]
                                                if inspect.iscoroutinefunction(tool_func):
                                                    result = await tool_func(**args)
                                                else:
                                                    loop = asyncio.get_running_loop()
                                                    result = await loop.run_in_executor(None, lambda: tool_func(**args))
                                            except Exception as e:
                                                result = f"Error: {e}"
                                            
                                            function_responses.append(types.FunctionResponse(
                                                name=func_name,
                                                id=fc.id,
                                                response={"result": result}
                                            ))
                                            await event_queue.put({"type": "tool_call", "name": func_name, "args": args, "result": result})
                                    
                                    await session.send_tool_response(function_responses=function_responses)
                            
                            logger.debug("Gemini receive iterator completed, re-entering receive loop")

                    except asyncio.CancelledError:
                        logger.debug("receive_loop task cancelled")
                    except Exception as e:
                        logger.error(f"receive_loop error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
                        await event_queue.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
                    finally:
                        logger.info("receive_loop exiting")
                        await event_queue.put(None)

                send_audio_task = asyncio.create_task(send_audio())
                send_video_task = asyncio.create_task(send_video())
                send_text_task = asyncio.create_task(send_text())
                receive_task = asyncio.create_task(receive_loop())

                try:
                    while True:
                        event = await event_queue.get()
                        if event is None:
                            break
                        yield event
                finally:
                    logger.info("Cleaning up Gemini Live session tasks")
                    send_audio_task.cancel()
                    send_video_task.cancel()
                    send_text_task.cancel()
                    receive_task.cancel()
        except Exception as e:
            logger.error(f"Gemini Live session error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
            raise
        finally:
            logger.info("Gemini Live session closed")

async def main():
    # Attempt to get API key from environment
    API_KEY = os.environ.get("GOOGLE_API_KEY") or "AIzaSyB-pig4Fwo3LsdOmnwcqiv21p9otSDEaf8"
    MODEL = "gemini-3.1-flash-live-preview"

    if not API_KEY or "YOUR_API_KEY" in API_KEY:
        print("Error: API Key not set. Please set the GOOGLE_API_KEY environment variable.")
        return

    # Create the Gemini Live handler
    handler = GeminiLive(api_key=API_KEY, model=MODEL)

    # Prepare queues
    audio_in = asyncio.Queue()
    video_in = asyncio.Queue()
    text_in = asyncio.Queue()

    def audio_out_callback(data):
        # This is where PCM audio data would be played back
        # In a CLI, we just log its arrival
        logger.debug(f"Received {len(data)} bytes of audio data")

    is_first_part = True
    # User enters their input; we'll handle the prompt in a dedicated print.
    # We clear any leftover newlines before starting.
    print("\n" + "="*40)
    print(" GEMINI LIVE CHAT BOT (Terminal Mode)")
    print("="*40)
    print(f"Model: {MODEL}")
    # Instructions
    print("Instructions: Type your message and press Enter.")
    print("Type 'exit' to quit.\n")
    print("> ", end="", flush=True)

    # Task to handle interactive terminal input
    async def input_loop():
        try:
            while True:
                # Use to_thread for blocking input() — we've already printed the prompt
                line = await asyncio.to_thread(input, "")
                if line.lower() in ["exit", "quit", "q"]:
                    break
                if line.strip():
                    await text_in.put(line)
                else:
                    # If empty text, reprint the prompt
                    print("> ", end="", flush=True)
        except EOFError:
            pass
        except asyncio.CancelledError:
            pass

    input_task = asyncio.create_task(input_loop())

    try:
        # Start the session and process events
        async for event in handler.start_session(audio_in, video_in, text_in, audio_out_callback):
            event_type = event.get("type")
            
            if event_type == "user":
                # Transcription of user voice input (if used)
                print(f"[User Transcription]: {event['text']}")
            
            elif event_type == "gemini":
                # Print text as it streams, without an immediate newline
                if is_first_part:
                    print("\nGemini: ", end="", flush=True)
                    is_first_part = False
                print(event['text'], end="", flush=True)
            
            elif event_type == "turn_complete":
                # Reset turn flag and ensure the next prompt starts on a new line
                is_first_part = True
                print("\n> ", end="", flush=True)
            
            elif event_type == "tool_call":
                print(f"\n[Tool Call]: {event['name']} with args {event['args']}")
                print(f"[Result]: {event['result']}")
                print("> ", end="", flush=True)
            
            elif event_type == "error":
                print(f"\n[Error]: {event['error']}")
                break
            
            elif event_type == "turn_complete":
                # Session ready for next input
                pass

    except KeyboardInterrupt:
        print("\nSession interrupted by user.")
    except Exception as e:
        print(f"\nCaught Exception: {e}")
    finally:
        input_task.cancel()
        print("\nExiting. Goodbye!")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
