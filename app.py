from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq
import os
import json
import webbrowser
import psutil
import pyautogui
import platform
import threading
import time
import re
from datetime import datetime
from pathlib import Path
from pynput.keyboard import Controller, Key

# Optional volume control
try:
    from ctypes import POINTER, cast
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    devices = AudioUtilities.GetSpeakers()
    iface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    volume_iface = cast(iface, POINTER(IAudioEndpointVolume))
    HAS_PYCAW = True
except:
    HAS_PYCAW = False
    volume_iface = None

load_dotenv()

app = Flask(__name__)
CORS(app)

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
system_platform = platform.system()
keyboard = Controller()

# Typing mode state
typing_mode = False

SYSTEM_PROMPT = "You are NOVA, an advanced AI assistant with a sleek futuristic personality. Be helpful, concise, and slightly futuristic in tone."

# ─────────────────────────────────────────
# KEY MAPPING
# ─────────────────────────────────────────

KEY_MAP = {
    "windows": Key.cmd,
    "win": Key.cmd,
    "ctrl": Key.ctrl,
    "control": Key.ctrl,
    "alt": Key.alt,
    "shift": Key.shift,
    "enter": Key.enter,
    "return": Key.enter,
    "escape": Key.esc,
    "esc": Key.esc,
    "tab": Key.tab,
    "space": Key.space,
    "backspace": Key.backspace,
    "delete": Key.delete,
    "up": Key.up,
    "down": Key.down,
    "left": Key.left,
    "right": Key.right,
    "home": Key.home,
    "end": Key.end,
    "f1": Key.f1,
    "f2": Key.f2,
    "f3": Key.f3,
    "f4": Key.f4,
    "f5": Key.f5,
    "f6": Key.f6,
    "f7": Key.f7,
    "f8": Key.f8,
    "f9": Key.f9,
    "f10": Key.f10,
    "f11": Key.f11,
    "f12": Key.f12,
    "page up": Key.page_up,
    "page down": Key.page_down,
    "caps lock": Key.caps_lock,
    "print screen": Key.print_screen,
    "insert": Key.insert,
    "num lock": Key.num_lock,
}

# ─────────────────────────────────────────
# MEMORY SYSTEM
# ─────────────────────────────────────────

MEMORY_FILE = Path("memories.json")

def load_memories():
    if MEMORY_FILE.exists():
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    return []

def save_memories(memories):
    with open(MEMORY_FILE, "w") as f:
        json.dump(memories, f, indent=2)

@app.route('/api/memory', methods=['GET'])
def get_memories():
    return jsonify({"memories": load_memories()})

@app.route('/api/memory/add', methods=['POST'])
def add_memory():
    data = request.json
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "Empty memory"}), 400

    memories = load_memories()
    memory = {
        "id": str(int(time.time() * 1000)),
        "text": text,
        "timestamp": datetime.now().strftime("%d %b %Y, %H:%M"),
        "category": data.get("category", "general")
    }
    memories.insert(0, memory)
    memories = memories[:50]  # keep last 50 only
    save_memories(memories)
    return jsonify({"status": "Memory saved", "memory": memory})

@app.route('/api/memory/delete', methods=['POST'])
def delete_memory():
    data = request.json
    memory_id = data.get("id", "")
    memories = load_memories()
    memories = [m for m in memories if m["id"] != memory_id]
    save_memories(memories)
    return jsonify({"status": "Memory deleted"})

@app.route('/api/memory/clear', methods=['POST'])
def clear_memories():
    save_memories([])
    return jsonify({"status": "All memories cleared"})

# ─────────────────────────────────────────
# CHAT ROUTES
# ─────────────────────────────────────────

@app.route('/api/sonnet', methods=['POST'])
def handle_task():
    data = request.json
    user_prompt = data.get("prompt", "")

    def generate():
        stream = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ]
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/api/chat', methods=['POST'])
def handle_chat():
    data = request.json
    messages = data.get("messages", [])

    # Inject memories into system prompt so NOVA always knows user context
    memories = load_memories()
    memory_context = ""
    if memories:
        memory_context = "\n\nUser memories (use these to personalize your responses):\n"
        memory_context += "\n".join([f"- {m['text']}" for m in memories])

    def generate():
        stream = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT + memory_context},
                *messages
            ]
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "NOVA backend online ⚡"})

# ─────────────────────────────────────────
# VOLUME CONTROL
# ─────────────────────────────────────────

def control_volume_action(action, percent=None):
    if not HAS_PYCAW or not volume_iface:
        if action == "increase":
            presses = int((percent or 15) / 2)
            for _ in range(presses): pyautogui.press("volumeup")
            return jsonify({"status": f"Volume increased", "speak": "Volume increased."})
        elif action == "decrease":
            presses = int((percent or 15) / 2)
            for _ in range(presses): pyautogui.press("volumedown")
            return jsonify({"status": f"Volume decreased", "speak": "Volume decreased."})
        elif action == "mute":
            pyautogui.press("volumemute")
            return jsonify({"status": "Muted", "speak": "Muted."})
        elif action == "set" and percent is not None:
            for _ in range(50): pyautogui.press("volumedown")
            for _ in range(int(percent / 2)): pyautogui.press("volumeup")
            return jsonify({"status": f"Volume set to {percent}%", "speak": f"Volume set to {percent} percent."})

    try:
        curr = volume_iface.GetMasterVolumeLevelScalar()
        curr_pct = int(curr * 100)

        if action == "increase":
            change = (percent or 15) / 100
            new_vol = min(curr + change, 1.0)
            volume_iface.SetMasterVolumeLevelScalar(new_vol, None)
            return jsonify({
                "status": f"Volume increased to {int(new_vol * 100)}%",
                "speak": f"Volume increased to {int(new_vol * 100)} percent."
            })
        elif action == "decrease":
            change = (percent or 15) / 100
            new_vol = max(curr - change, 0.0)
            volume_iface.SetMasterVolumeLevelScalar(new_vol, None)
            return jsonify({
                "status": f"Volume decreased to {int(new_vol * 100)}%",
                "speak": f"Volume decreased to {int(new_vol * 100)} percent."
            })
        elif action == "mute":
            pyautogui.press("volumemute")
            return jsonify({"status": "Muted", "speak": "Audio muted."})
        elif action == "set" and percent is not None:
            volume_iface.SetMasterVolumeLevelScalar(percent / 100, None)
            return jsonify({
                "status": f"Volume set to {percent}%",
                "speak": f"Volume set to {percent} percent."
            })
        elif action == "get":
            return jsonify({
                "status": f"Volume is at {curr_pct}%",
                "speak": f"Current volume is {curr_pct} percent.",
                "level": curr_pct
            })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/volume', methods=['POST'])
def control_volume():
    data = request.json
    action = data.get("action", "")
    percent = data.get("percent", None)
    return control_volume_action(action, percent)

# ─────────────────────────────────────────
# TYPING CONTROL
# ─────────────────────────────────────────

@app.route('/api/type', methods=['POST'])
def type_text():
    data = request.json
    text = data.get("text", "")
    delay = data.get("delay", 0.05)

    try:
        time.sleep(0.5)  # small delay so user can focus window
        pyautogui.typewrite(text, interval=delay)
        return jsonify({
            "status": f"Typed: {text}",
            "speak": f"Done. I typed: {text}"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─────────────────────────────────────────
# SHORTCUT KEYS
# ─────────────────────────────────────────

@app.route('/api/shortcut', methods=['POST'])
def press_shortcut():
    data = request.json
    keys = data.get("keys", [])

    try:
        mapped = []
        for k in keys:
            k_lower = k.lower()
            if k_lower in KEY_MAP:
                mapped.append(KEY_MAP[k_lower])
            elif len(k) == 1:
                mapped.append(k)
            else:
                mapped.append(k)

        if len(mapped) == 1:
            pyautogui.press(str(mapped[0]).replace("Key.", ""))
        else:
            pyautogui.hotkey(*[
                str(k).replace("<Key.", "").replace(">", "").replace("Key.", "")
                if not isinstance(k, str) else k
                for k in mapped
            ])

        key_str = " + ".join(keys)
        return jsonify({
            "status": f"Pressed {key_str}",
            "speak": f"Pressed {key_str}."
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─────────────────────────────────────────
# ALARMS
# ─────────────────────────────────────────

alarms = []

def alarm_thread(alarm_time_str, label=""):
    while True:
        now = datetime.now().strftime("%H:%M")
        if now == alarm_time_str:
            pyautogui.alert(
                text=f"⏰ NOVA ALARM: {label or alarm_time_str}",
                title="NOVA Alarm",
                button="Dismiss"
            )
            break
        time.sleep(15)

@app.route('/api/alarm', methods=['POST'])
def set_alarm():
    data = request.json
    alarm_time = data.get("time", "")
    label = data.get("label", "")
    try:
        datetime.strptime(alarm_time, "%H:%M")
        alarms.append(alarm_time)
        threading.Thread(target=alarm_thread, args=(alarm_time, label), daemon=True).start()
        return jsonify({"status": f"Alarm set for {alarm_time}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/alarm', methods=['GET'])
def get_alarms():
    return jsonify({"alarms": alarms})

# ─────────────────────────────────────────
# SHUTDOWN
# ─────────────────────────────────────────

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    data = request.json
    delay = data.get("delay", 10)

    def do_shutdown():
        time.sleep(2)
        if system_platform == "Windows":
            os.system(f"shutdown /s /t {delay}")
        else:
            os.system("shutdown -h now")

    threading.Thread(target=do_shutdown, daemon=True).start()
    return jsonify({"status": f"Shutting down in {delay} seconds"})

@app.route('/api/shutdown/cancel', methods=['POST'])
def cancel_shutdown():
    if system_platform == "Windows":
        os.system("shutdown /a")
    return jsonify({"status": "Shutdown cancelled"})

# ─────────────────────────────────────────
# MOUSE CONTROL
# ─────────────────────────────────────────

@app.route('/api/mouse', methods=['POST'])
def mouse_control():
    data = request.json
    action = data.get("action", "")
    x = data.get("x", None)
    y = data.get("y", None)

    try:
        if action == "move" and x is not None and y is not None:
            pyautogui.moveTo(int(x), int(y), duration=0.3)
            return jsonify({"status": f"Mouse moved to {x},{y}"})
        elif action == "click":
            pyautogui.click()
            return jsonify({"status": "Mouse clicked"})
        elif action == "right_click":
            pyautogui.rightClick()
            return jsonify({"status": "Right clicked"})
        elif action == "double_click":
            pyautogui.doubleClick()
            return jsonify({"status": "Double clicked"})
        elif action == "center":
            w, h = pyautogui.size()
            pyautogui.moveTo(w // 2, h // 2, duration=0.3)
            return jsonify({"status": "Mouse moved to center"})
        elif action == "scroll_up":
            pyautogui.scroll(3)
            return jsonify({"status": "Scrolled up"})
        elif action == "scroll_down":
            pyautogui.scroll(-3)
            return jsonify({"status": "Scrolled down"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"error": "Unknown action"}), 400

# ─────────────────────────────────────────
# SMART COMMAND PARSER
# ─────────────────────────────────────────

def parse_percent(command):
    """Extract percentage from command e.g. 'decrease volume 30 percent' → 30"""
    match = re.search(r'(\d+)\s*(?:percent|%)', command)
    return int(match.group(1)) if match else None

def parse_shortcut_from_command(command):
    """
    Parse shortcut keys from natural language
    e.g. 'press ctrl c' → ['ctrl', 'c']
    e.g. 'press windows plus alt f4' → ['win', 'alt', 'f4']
    """
    clean = command.replace("press", "").replace("hit", "").replace("shortcut", "")
    clean = clean.replace(" plus ", " ").replace("+", " ").strip()

    words = clean.split()
    keys = []
    i = 0
    while i < len(words):
        if i + 1 < len(words):
            two_word = words[i] + " " + words[i+1]
            if two_word in KEY_MAP:
                keys.append(two_word)
                i += 2
                continue
        word = words[i]
        if word in KEY_MAP or len(word) == 1:
            keys.append(word)
        i += 1

    return keys if keys else None

@app.route('/api/command', methods=['POST'])
def parse_command():
    global typing_mode
    data = request.json
    command = data.get("command", "").lower()

    # ── Memory Commands ──
    if command.startswith("remember ") or command.startswith("nova remember "):
        mem_text = command.replace("nova remember ", "").replace("remember ", "").strip()
        memories = load_memories()
        memory = {
            "id": str(int(time.time() * 1000)),
            "text": mem_text,
            "timestamp": datetime.now().strftime("%d %b %Y, %H:%M"),
            "category": "general"
        }
        memories.insert(0, memory)
        memories = memories[:50]
        save_memories(memories)
        return jsonify({
            "status": f"Memory saved: {mem_text}",
            "speak": f"Got it. I'll remember that {mem_text}."
        })

    if "what do you remember" in command or "show memories" in command:
        memories = load_memories()
        count = len(memories)
        return jsonify({
            "status": f"{count} memories stored",
            "speak": f"I have {count} memories stored. Check the memory panel on the left."
        })

    if "clear memories" in command or "forget everything" in command:
        save_memories([])
        return jsonify({
            "status": "All memories cleared",
            "speak": "All memories have been cleared."
        })

    # ── Typing Mode ──
    if any(w in command for w in ["start writing", "start typing", "type for me", "nova type", "nova write"]):
        typing_mode = True
        return jsonify({
            "status": "Typing mode ON",
            "speak": "Typing mode activated. Tell me what to type."
        })

    if any(w in command for w in ["stop writing", "stop typing", "stop type"]):
        typing_mode = False
        return jsonify({
            "status": "Typing mode OFF",
            "speak": "Typing mode deactivated."
        })

    if typing_mode or command.startswith("type ") or command.startswith("write "):
        text = command
        for prefix in ["type ", "write ", "nova type ", "nova write "]:
            if text.startswith(prefix):
                text = text[len(prefix):]
                break
        time.sleep(0.5)
        pyautogui.typewrite(text, interval=0.04)
        return jsonify({
            "status": f"Typed: {text}",
            "speak": f"Typed: {text}"
        })

    # ── Shortcut Keys ──
    if command.startswith("press ") or "shortcut" in command or " plus " in command:
        keys = parse_shortcut_from_command(command)
        if keys:
            try:
                pyautogui.hotkey(*keys)
                key_str = " + ".join(keys)
                return jsonify({
                    "status": f"Pressed {key_str}",
                    "speak": f"Pressed {key_str}."
                })
            except Exception as e:
                return jsonify({"error": str(e), "speak": "Could not execute that shortcut."}), 500

    # ── Volume ──
    percent = parse_percent(command)
    if any(w in command for w in ["increase volume", "volume up", "louder"]):
        return control_volume_action("increase", percent)
    elif any(w in command for w in ["decrease volume", "volume down", "quieter", "lower volume"]):
        return control_volume_action("decrease", percent)
    elif any(w in command for w in ["set volume", "volume to"]):
        return control_volume_action("set", percent)
    elif "what is the volume" in command or "current volume" in command:
        return control_volume_action("get")
    elif "mute" in command:
        return control_volume_action("mute")
    elif "unmute" in command:
        pyautogui.press("volumemute")
        return jsonify({"status": "Unmuted", "speak": "Audio unmuted."})

    # ── Shutdown ──
    elif "shutdown" in command or "shut down" in command:
        threading.Thread(
            target=lambda: (time.sleep(2), os.system("shutdown /s /t 10")),
            daemon=True
        ).start()
        return jsonify({
            "status": "Shutting down in 10 seconds",
            "speak": "Shutting down your PC in 10 seconds."
        })
    elif "cancel shutdown" in command:
        os.system("shutdown /a")
        return jsonify({
            "status": "Shutdown cancelled",
            "speak": "Shutdown cancelled."
        })
    elif "restart" in command or "reboot" in command:
        threading.Thread(
            target=lambda: (time.sleep(2), os.system("shutdown /r /t 10")),
            daemon=True
        ).start()
        return jsonify({
            "status": "Restarting in 10 seconds",
            "speak": "Restarting your PC in 10 seconds."
        })

    # ── Mouse ──
    elif any(w in command for w in ["move mouse", "center mouse"]):
        w, h = pyautogui.size()
        pyautogui.moveTo(w // 2, h // 2, duration=0.3)
        return jsonify({"status": "Mouse centered", "speak": "Mouse moved to center."})
    elif "scroll up" in command:
        pyautogui.scroll(3)
        return jsonify({"status": "Scrolled up", "speak": "Scrolling up."})
    elif "scroll down" in command:
        pyautogui.scroll(-3)
        return jsonify({"status": "Scrolled down", "speak": "Scrolling down."})
    elif "right click" in command:
        pyautogui.rightClick()
        return jsonify({"status": "Right clicked", "speak": "Right clicked."})
    elif "double click" in command:
        pyautogui.doubleClick()
        return jsonify({"status": "Double clicked", "speak": "Double clicked."})
    elif "click" in command:
        pyautogui.click()
        return jsonify({"status": "Clicked", "speak": "Mouse clicked."})

    # ── Alarm ──
    elif "set alarm" in command or "alarm for" in command:
        words = command.split()
        for word in words:
            if ":" in word:
                try:
                    datetime.strptime(word, "%H:%M")
                    alarms.append(word)
                    threading.Thread(target=alarm_thread, args=(word,), daemon=True).start()
                    return jsonify({
                        "status": f"Alarm set for {word}",
                        "speak": f"Alarm set for {word}."
                    })
                except:
                    pass
        return jsonify({
            "status": "Could not parse alarm time",
            "speak": "Please say the time in H H colon M M format."
        })

    # ── Not a system command ──
    return jsonify({"status": "not_a_command"})


if __name__ == '__main__':
    app.run(port=5000, debug=True)
