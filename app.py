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
import subprocess
import threading
import time
import re
import requests
import sqlite3
import chromadb
from datetime import datetime
from pathlib import Path
from pynput.keyboard import Controller, Key

# ─────────────────────────────────────────
# LOCAL DATABASES SETUP
# ─────────────────────────────────────────
chroma_client = chromadb.PersistentClient(path="./chroma_db_storage")
nova_memory = chroma_client.get_or_create_collection(name="nova_memory")

conn = sqlite3.connect('nova_database.db', check_same_thread=False)
cursor = conn.cursor()
cursor.execute('''
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
''')
conn.commit()

def save_sql_message(role, content):
    try:
        cursor.execute("INSERT INTO conversations (role, content) VALUES (?, ?)", (role, content))
        conn.commit()
    except Exception as e:
        print(f"[NOVA] SQLite ERROR: {e}")

def save_nova_memory(memory_text, category="general"):
    try:
        import time
        mem_id = str(int(time.time() * 1000))
        nova_memory.add(
            documents=[memory_text],
            metadatas=[{"category": category, "timestamp": datetime.now().strftime("%d %b %Y, %H:%M")}],
            ids=[mem_id]
        )
        return mem_id
    except Exception as e:
        print(f"[NOVA] Chroma save error: {e}")
        return None

def get_relevant_memories(query, n_results=2):
    try:
        if nova_memory.count() == 0:
            return []
        results = nova_memory.query(
            query_texts=[query],
            n_results=n_results
        )
        return results['documents'][0] if results and 'documents' in results and results['documents'] else []
    except Exception as e:
        print(f"[NOVA] Chroma search error: {e}")
        return []

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

typing_mode = False

SYSTEM_PROMPT = (
    "You are NOVA, a friendly and warm AI companion. "
    "Talk like a close friend — casual, fun, and supportive. "
    "Keep responses short and natural. "
    "When providing code, ALWAYS wrap it in markdown code fences with the language name, like ```python ... ``` or ```javascript ... ```. "
    "For inline code references, use single backticks. "
    "You may use **bold** for emphasis when helpful. "
    "Never use emojis."
)

# ─────────────────────────────────────────
# OLLAMA CONFIG
# ─────────────────────────────────────────

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2:1b"  # 1b is much faster than the full llama3.2

def is_ollama_running():
    try:
        r = requests.get("http://localhost:11434", timeout=2)
        return r.status_code == 200
    except Exception:
        return False

def is_internet_online():
    """Check internet connectivity by pinging a reliable host (Google)."""
    try:
        r = requests.get('https://www.google.com', timeout=2)
        return r.status_code == 200
    except Exception:
        return False

# ─────────────────────────────────────────
# CACHE SYSTEM
# ─────────────────────────────────────────

CACHE_FILE = Path("cache.json")

def load_cache():
    if CACHE_FILE.exists():
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)

def normalize(text):
    return re.sub(r'\s+', ' ', text.lower().strip())

def get_cached_response(prompt):
    cache = load_cache()
    key = normalize(prompt)
    return cache.get(key, None)

def save_to_cache(prompt, response):
    # Log to databases
    save_sql_message("user", prompt)
    save_sql_message("nova", response)
    save_nova_memory(f"User asked: {prompt} | Nova answered: {response}", category="conversation")
    
    cache = load_cache()
    key = normalize(prompt)
    cache[key] = {
        "response": response,
        "timestamp": datetime.now().strftime("%d %b %Y, %H:%M")
    }
    if len(cache) > 200:
        oldest_key = list(cache.keys())[0]
        del cache[oldest_key]
    save_cache(cache)

# ─────────────────────────────────────────
# SMART AI ROUTER
# Priority: Cache → Ollama Local → Groq API
# ─────────────────────────────────────────

def stream_ollama(messages):
    payload = {"model": OLLAMA_MODEL, "messages": messages, "stream": True}
    with requests.post(OLLAMA_URL, json=payload, stream=True, timeout=60) as r:
        for line in r.iter_lines(decode_unicode=True):
            if line:
                data = json.loads(line)
                delta = data.get("message", {}).get("content", "")
                if delta:
                    yield delta
                if data.get("done"):
                    break

def stream_groq(messages):
    stream = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        max_tokens=1024,
        stream=True,
        messages=messages
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta

def smart_stream(messages, user_prompt):
    # ── STEP 1: Cache ──
    cached = get_cached_response(user_prompt)
    if cached:
        print("[NOVA] Cache hit ⚡")
        yield cached["response"]
        return

    # ── STEP 2: Prefer Groq when online ──
    online = is_internet_online()
    if online:
        print("[NOVA] Using Groq (online) 🌐")
        full_response = ""
        try:
            for chunk in stream_groq(messages):
                full_response += chunk
                yield chunk
            save_to_cache(user_prompt, full_response)
            return
        except Exception as e:
            print(f"[NOVA] Groq failed: {e}")
            if not is_ollama_running():
                yield "[Error: Groq request failed and Ollama is offline.]"
                return
            print("[NOVA] Falling back to Ollama...")

    # ── STEP 3: Ollama local fallback ──
    if is_ollama_running():
        print("[NOVA] Using Ollama local 🦙")
        full_response = ""
        try:
            for chunk in stream_ollama(messages):
                full_response += chunk
                yield chunk
            save_to_cache(user_prompt, full_response)
            return
        except Exception as e:
            print(f"[NOVA] Ollama failed: {e}")
    
    # ── STEP 4: No service available ──
    if not online:
        print("[NOVA] Offline and Ollama not running.")
        yield "[Error: You are offline and Ollama local service is not reachable.]"
    else:
        print("[NOVA] No AI service reachable.")
        yield "[Error: No AI service reachable. Please check your Groq API key or Ollama status.]"

# ─────────────────────────────────────────
# KEY MAPPING
# ─────────────────────────────────────────

KEY_MAP = {
    "windows": Key.cmd, "win": Key.cmd,
    "ctrl": Key.ctrl, "control": Key.ctrl,
    "alt": Key.alt, "shift": Key.shift,
    "enter": Key.enter, "return": Key.enter,
    "escape": Key.esc, "esc": Key.esc,
    "tab": Key.tab, "space": Key.space,
    "backspace": Key.backspace, "delete": Key.delete,
    "up": Key.up, "down": Key.down,
    "left": Key.left, "right": Key.right,
    "home": Key.home, "end": Key.end,
    "f1": Key.f1, "f2": Key.f2, "f3": Key.f3,
    "f4": Key.f4, "f5": Key.f5, "f6": Key.f6,
    "f7": Key.f7, "f8": Key.f8, "f9": Key.f9,
    "f10": Key.f10, "f11": Key.f11, "f12": Key.f12,
    "page up": Key.page_up, "page down": Key.page_down,
    "caps lock": Key.caps_lock, "print screen": Key.print_screen,
    "insert": Key.insert, "num lock": Key.num_lock,
}

# ─────────────────────────────────────────
# MEMORY SYSTEM (CHROMA + SQLITE)
# ─────────────────────────────────────────

@app.route('/api/memory', methods=['GET'])
def get_memories():
    try:
        data = nova_memory.get()
        memories = []
        if data and 'documents' in data:
            for idx, doc in enumerate(data['documents']):
                memories.append({
                    "id": data['ids'][idx] if 'ids' in data else str(idx),
                    "text": doc,
                    "timestamp": data['metadatas'][idx].get("timestamp", "") if 'metadatas' in data and data['metadatas'] else "",
                    "category": data['metadatas'][idx].get("category", "general") if 'metadatas' in data and data['metadatas'] else "general"
                })
        return jsonify({"memories": list(reversed(memories))[:50]})
    except Exception as e:
        print(f"Memory get err: {e}")
        return jsonify({"error": str(e), "memories": []})

@app.route('/api/memory/add', methods=['POST'])
def add_memory():
    data = request.json
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "Empty memory"}), 400
    mem_id = save_nova_memory(text, data.get("category", "general"))
    return jsonify({"status": "Memory saved", "memory": {"id": mem_id, "text": text}})

@app.route('/api/memory/delete', methods=['POST'])
def delete_memory():
    data = request.json
    memory_id = data.get("id", "")
    try:
        nova_memory.delete(ids=[memory_id])
        return jsonify({"status": "Memory deleted"})
    except:
        return jsonify({"error": "Could not delete"})

@app.route('/api/memory/clear', methods=['POST'])
def clear_memories():
    try:
        all_data = nova_memory.get()
        if all_data and 'ids' in all_data and all_data['ids']:
            nova_memory.delete(ids=all_data['ids'])
    except:
        pass
    try:
        cursor.execute("DELETE FROM conversations")
        conn.commit()
    except:
        pass
    return jsonify({"status": "All memories cleared"})

# ─────────────────────────────────────────
# CHAT ROUTES
# ─────────────────────────────────────────

@app.route('/api/sonnet', methods=['POST'])
def handle_task():
    data = request.json
    user_prompt = data.get("prompt", "")
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]
    return Response(
        stream_with_context(smart_stream(messages, user_prompt)),
        mimetype='text/plain'
    )

@app.route('/api/chat', methods=['POST'])
def handle_chat():
    data = request.json
    messages = data.get("messages", [])

    user_prompt = messages[-1]["content"] if messages else ""

    memory_context = ""
    if user_prompt:
        relevant = get_relevant_memories(user_prompt, n_results=3)
        if relevant:
            memory_context = "\n\nRelevant Context from Past Conversations (Use this to answer questions about the past):\n"
            memory_context += "\n".join([f"- {m}" for m in relevant])

    full_messages = [
        {"role": "system", "content": SYSTEM_PROMPT + memory_context},
        *messages
    ]

    return Response(
        stream_with_context(smart_stream(full_messages, user_prompt)),
        mimetype='text/plain'
    )

@app.route('/health', methods=['GET'])
def health():
    ollama_status = "online 🦙" if is_ollama_running() else "offline ❌"
    return jsonify({
        "status": "NOVA backend online ⚡",
        "ollama": ollama_status,
        "model": OLLAMA_MODEL
    })

# ─────────────────────────────────────────
# CACHE ROUTES
# ─────────────────────────────────────────

@app.route('/api/cache/stats', methods=['GET'])
def cache_stats():
    cache = load_cache()
    return jsonify({"total_entries": len(cache), "status": "Cache active ⚡"})

@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    save_cache({})
    return jsonify({"status": "Cache cleared"})

# ─────────────────────────────────────────
# VOLUME CONTROL
# ─────────────────────────────────────────

def control_volume_action(action, percent=None):
    if not HAS_PYCAW or not volume_iface:
        if action == "increase":
            presses = int((percent or 15) / 2)
            for _ in range(presses): pyautogui.press("volumeup")
            return jsonify({"status": "Volume increased", "speak": "Volume increased."})
        elif action == "decrease":
            presses = int((percent or 15) / 2)
            for _ in range(presses): pyautogui.press("volumedown")
            return jsonify({"status": "Volume decreased", "speak": "Volume decreased."})
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
            return jsonify({"status": f"Volume up to {int(new_vol*100)}%", "speak": f"Volume increased to {int(new_vol*100)} percent."})
        elif action == "decrease":
            change = (percent or 15) / 100
            new_vol = max(curr - change, 0.0)
            volume_iface.SetMasterVolumeLevelScalar(new_vol, None)
            return jsonify({"status": f"Volume down to {int(new_vol*100)}%", "speak": f"Volume decreased to {int(new_vol*100)} percent."})
        elif action == "mute":
            pyautogui.press("volumemute")
            return jsonify({"status": "Muted", "speak": "Audio muted."})
        elif action == "set" and percent is not None:
            volume_iface.SetMasterVolumeLevelScalar(percent / 100, None)
            return jsonify({"status": f"Volume set to {percent}%", "speak": f"Volume set to {percent} percent."})
        elif action == "get":
            return jsonify({"status": f"Volume is at {curr_pct}%", "speak": f"Current volume is {curr_pct} percent.", "level": curr_pct})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/volume', methods=['POST'])
def control_volume():
    data = request.json
    action = data.get("action", "")
    percent = data.get("percent", None)
    return control_volume_action(action, percent)

# ─────────────────────────────────────────
# WINDOW CONTROL
# ─────────────────────────────────────────

def close_active_window():
    """Close the currently active/foreground window."""
    try:
        if system_platform == "Windows":
            pyautogui.hotkey('alt', 'F4')
        elif system_platform == "Darwin":
            pyautogui.hotkey('command', 'w')
        else:
            pyautogui.hotkey('alt', 'F4')
        return True
    except Exception as e:
        print(f"[NOVA] Close window error: {e}")
        return False

def minimize_active_window():
    """Minimize the currently active/foreground window."""
    try:
        if system_platform == "Windows":
            pyautogui.hotkey('win', 'down')
        elif system_platform == "Darwin":
            pyautogui.hotkey('command', 'm')
        else:
            pyautogui.hotkey('super', 'h')
        return True
    except Exception as e:
        print(f"[NOVA] Minimize window error: {e}")
        return False

def close_app_by_name(app_name: str):
    """Try to find and kill a process by name."""
    name_lower = app_name.lower().strip()
    killed = []
    for proc in psutil.process_iter(['name', 'pid']):
        try:
            pname = proc.info['name'].lower()
            if name_lower in pname or pname in name_lower:
                proc.kill()
                killed.append(proc.info['name'])
        except Exception:
            pass
    return killed

@app.route('/api/window', methods=['POST'])
def window_control():
    data = request.json
    action = data.get("action", "")
    app_name = data.get("app", "")
    if action == "close":
        if app_name:
            killed = close_app_by_name(app_name)
            if killed:
                return jsonify({"status": f"Closed {', '.join(killed)}", "speak": f"Closed {app_name}."})
            return jsonify({"status": "App not found", "speak": f"Could not find {app_name} to close."})
        close_active_window()
        return jsonify({"status": "Window closed", "speak": "Window closed."})
    elif action == "minimize":
        minimize_active_window()
        return jsonify({"status": "Window minimized", "speak": "Window minimized."})
    return jsonify({"error": "Unknown action"}), 400

# ─────────────────────────────────────────
# YOUTUBE OPEN / PLAY
# ─────────────────────────────────────────

@app.route('/api/youtube', methods=['POST'])
def youtube_control():
    data = request.json
    action = data.get("action", "")
    query = data.get("query", "")

    if action == "open":
        webbrowser.open("https://www.youtube.com")
        return jsonify({"status": "YouTube opened", "speak": "Opening YouTube now."})

    if action == "play" and query:
        # Use the video filter (&sp=EgIQAQ) to show only videos
        search_url = f"https://www.youtube.com/results?search_query={requests.utils.quote(query)}&sp=EgIQAQ%253D%253D"
        webbrowser.open(search_url)
        return jsonify({
            "status": f"Playing {query} on YouTube",
            "speak": f"Playing {query} on YouTube now!"
        })

    return jsonify({"error": "Missing action or query"}), 400

# ─────────────────────────────────────────
# TYPING CONTROL
# ─────────────────────────────────────────

@app.route('/api/type', methods=['POST'])
def type_text():
    data = request.json
    text = data.get("text", "")
    delay = data.get("delay", 0.05)
    try:
        time.sleep(0.5)
        pyautogui.typewrite(text, interval=delay)
        return jsonify({"status": f"Typed: {text}", "speak": f"Done. I typed: {text}"})
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
        return jsonify({"status": f"Pressed {key_str}", "speak": f"Pressed {key_str}."})
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
# SHUTDOWN / RESTART
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
    match = re.search(r'(\d+)\s*(?:percent|%)', command)
    return int(match.group(1)) if match else None

def parse_shortcut_from_command(command):
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

def extract_app_name(command: str, keyword: str) -> str:
    """Extract app name after a keyword like 'close' or 'open'."""
    idx = command.find(keyword)
    if idx == -1:
        return ""
    after = command[idx + len(keyword):].strip()
    # Remove filler words
    for filler in ["the", "app", "application", "window", "tab"]:
        after = after.replace(filler, "").strip()
    return after.strip()

@app.route('/api/command', methods=['POST'])
def parse_command():
    global typing_mode
    data = request.json
    command = data.get("command", "").lower().strip()

    # ── Memory Commands ──
    if command.startswith("remember ") or command.startswith("nova remember "):
        mem_text = command.replace("nova remember ", "").replace("remember ", "").strip()
        save_nova_memory(mem_text, category="general")
        return jsonify({"status": f"Memory saved: {mem_text}", "speak": f"Got it. I'll remember that {mem_text}."})

    if "what do you remember" in command or "show memories" in command:
        try:
            count = nova_memory.count()
        except:
            count = 0
        return jsonify({"status": f"{count} memories stored", "speak": f"I have {count} memories stored."})

    if "clear memories" in command or "forget everything" in command:
        try:
            all_data = nova_memory.get()
            if all_data and 'ids' in all_data and all_data['ids']:
                nova_memory.delete(ids=all_data['ids'])
            cursor.execute("DELETE FROM conversations")
            conn.commit()
        except:
            pass
        return jsonify({"status": "All memories cleared", "speak": "All memories have been cleared."})

    # ── YouTube Commands ──
    if command == "open youtube" or (
        "open youtube" in command and "play" not in command
    ):
        webbrowser.open("https://www.youtube.com")
        return jsonify({"status": "YouTube opened", "speak": "Opening YouTube now."})

    # Play YouTube: extract video name if provided inline e.g. "play believer on youtube"
    if any(p in command for p in ["play youtube", "play on youtube", "play music", "play a song", "play a video", "search youtube"]):
        # Try to extract video name from command
        for trigger in ["play youtube", "play on youtube", "search youtube", "play music", "play a song", "play a video"]:
            if trigger in command:
                after = command.replace(trigger, "").replace("play", "").strip()
                # Remove prepositions
                for filler in ["on youtube", "youtube", "the song", "the video", "a song called", "called"]:
                    after = after.replace(filler, "").strip()
                if after and len(after) > 2:
                    # We have the song name, play directly
                    search_url = f"https://www.youtube.com/results?search_query={requests.utils.quote(after)}&sp=EgIQAQ%253D%253D"
                    webbrowser.open(search_url)
                    return jsonify({
                        "status": f"Playing {after} on YouTube",
                        "speak": f"Playing {after} on YouTube now!",
                        "action": "youtube_play"
                    })
                else:
                    # No song name: ask the user
                    return jsonify({
                        "status": "waiting_for_video",
                        "speak": "Okay! Tell me the name of the song or video you want to hear.",
                        "action": "ask_video_name"
                    })

    # ── Close Window / App ──
    if any(w in command for w in ["close this window", "close the window", "close window", "close app", "close application", "close this tab"]):
        # Check if a specific app is named
        app_name = ""
        for trigger in ["close app", "close application", "close the app", "close"]:
            if trigger in command:
                potential = extract_app_name(command, trigger)
                if potential and potential not in ["this", "window", "tab", ""]:
                    app_name = potential
                    break

        if app_name:
            killed = close_app_by_name(app_name)
            if killed:
                return jsonify({"status": f"Closed {app_name}", "speak": f"Closed {app_name}."})
            return jsonify({"status": f"App not found: {app_name}", "speak": f"I couldn't find {app_name} running."})
        else:
            time.sleep(0.3)
            close_active_window()
            return jsonify({"status": "Window closed", "speak": "Closing this window now."})

    # ── Minimize Window ──
    if "minimize" in command or "minimise" in command:
        time.sleep(0.3)
        minimize_active_window()
        return jsonify({"status": "Window minimized", "speak": "Window minimized."})

    # ── Open specific apps ──
    APP_URLS = {
        "google": "https://google.com",
        "github": "https://github.com",
        "gmail": "https://mail.google.com",
        "twitter": "https://twitter.com",
        "reddit": "https://reddit.com",
        "netflix": "https://netflix.com",
        "spotify": "https://open.spotify.com",
        "chatgpt": "https://chat.openai.com",
        "instagram": "https://instagram.com",
        "whatsapp": "https://web.whatsapp.com",
        "linkedin": "https://linkedin.com",
    }

    if command.startswith("open "):
        target = command.replace("open ", "").strip()
        if target in APP_URLS:
            webbrowser.open(APP_URLS[target])
            return jsonify({"status": f"Opened {target}", "speak": f"Opening {target} now."})
        # Try as executable / desktop app
        try:
            if system_platform == "Windows":
                os.startfile(target)
            elif system_platform == "Darwin":
                subprocess.Popen(["open", "-a", target])
            else:
                subprocess.Popen([target])
            return jsonify({"status": f"Opened {target}", "speak": f"Opening {target}."})
        except Exception as e:
            return jsonify({"status": f"Could not open {target}", "speak": f"I couldn't open {target}. It might not be installed."})

    # ── Typing Mode ──
    if any(w in command for w in ["start writing", "start typing", "type for me", "nova type", "nova write"]):
        typing_mode = True
        return jsonify({"status": "Typing mode ON", "speak": "Typing mode activated."})

    if any(w in command for w in ["stop writing", "stop typing", "stop type"]):
        typing_mode = False
        return jsonify({"status": "Typing mode OFF", "speak": "Typing mode deactivated."})

    if typing_mode or command.startswith("type ") or command.startswith("write "):
        text = command
        for prefix in ["type ", "write ", "nova type ", "nova write "]:
            if text.startswith(prefix):
                text = text[len(prefix):]
                break
        time.sleep(0.5)
        pyautogui.typewrite(text, interval=0.04)
        return jsonify({"status": f"Typed: {text}", "speak": f"Typed: {text}"})

    # ── Shortcut Keys ──
    if command.startswith("press ") or "shortcut" in command or " plus " in command:
        keys = parse_shortcut_from_command(command)
        if keys:
            try:
                pyautogui.hotkey(*keys)
                key_str = " + ".join(keys)
                return jsonify({"status": f"Pressed {key_str}", "speak": f"Pressed {key_str}."})
            except Exception as e:
                return jsonify({"error": str(e), "speak": "Could not execute that shortcut."}), 500

    # ── Volume ──
    percent = parse_percent(command)
    if ("increase" in command or "turn up" in command or "louder" in command) and "volume" in command:
        return control_volume_action("increase", percent)
    elif ("decrease" in command or "turn down" in command or "lower" in command or "quieter" in command) and "volume" in command:
        return control_volume_action("decrease", percent)
    elif any(w in command for w in ["set volume", "volume to"]):
        return control_volume_action("set", percent)
    elif "what is the volume" in command or "current volume" in command:
        return control_volume_action("get")
    elif "unmute" in command:
        pyautogui.press("volumemute")
        return jsonify({"status": "Unmuted", "speak": "Audio unmuted."})
    elif "mute" in command:
        return control_volume_action("mute")

    # ── Brightness ──
    elif ("increase" in command or "turn up" in command or "brighter" in command) and "brightness" in command:
        try:
            result = subprocess.run(
                ['powershell', '-Command',
                 '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, [Math]::Min(100, (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness + 20))'],
                capture_output=True, text=True, timeout=5
            )
            return jsonify({"status": "Brightness increased", "speak": "Brightness increased."})
        except:
            # Fallback: use keyboard
            for _ in range(4): pyautogui.hotkey('fn', 'f12') if system_platform != "Windows" else None
            return jsonify({"status": "Brightness increased", "speak": "Brightness increased."})

    elif ("decrease" in command or "turn down" in command or "lower" in command or "dimmer" in command) and "brightness" in command:
        try:
            result = subprocess.run(
                ['powershell', '-Command',
                 '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, [Math]::Max(0, (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness - 20))'],
                capture_output=True, text=True, timeout=5
            )
            return jsonify({"status": "Brightness decreased", "speak": "Brightness decreased."})
        except:
            return jsonify({"status": "Brightness decreased", "speak": "Brightness decreased."})

    elif "set brightness" in command:
        pct = parse_percent(command)
        if pct is not None:
            try:
                subprocess.run(
                    ['powershell', '-Command',
                     f'(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, {pct})'],
                    capture_output=True, text=True, timeout=5
                )
                return jsonify({"status": f"Brightness set to {pct}%", "speak": f"Brightness set to {pct} percent."})
            except:
                return jsonify({"status": "Could not set brightness", "speak": "Could not set brightness."})

    # ── Shutdown / Restart ──
    elif "cancel shutdown" in command:
        os.system("shutdown /a")
        return jsonify({"status": "Shutdown cancelled", "speak": "Shutdown cancelled."})
    elif "shutdown" in command or "shut down" in command:
        threading.Thread(target=lambda: (time.sleep(2), os.system("shutdown /s /t 10")), daemon=True).start()
        return jsonify({"status": "Shutting down in 10 seconds", "speak": "Shutting down your PC in 10 seconds."})
    elif "restart" in command or "reboot" in command:
        threading.Thread(target=lambda: (time.sleep(2), os.system("shutdown /r /t 10")), daemon=True).start()
        return jsonify({"status": "Restarting in 10 seconds", "speak": "Restarting your PC in 10 seconds."})

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
                    return jsonify({"status": f"Alarm set for {word}", "speak": f"Alarm set for {word}."})
                except:
                    pass
        return jsonify({"status": "Could not parse alarm time", "speak": "Please say the time in HH:MM format."})

    return jsonify({"status": "not_a_command"})


if __name__ == '__main__':
    print("⚡ NOVA Backend Starting...")
    print(f"🦙 Ollama status: {'online' if is_ollama_running() else 'offline'}")
    print(f"🧠 Model: {OLLAMA_MODEL}")
    print(f"💾 Cache: {len(load_cache())} entries loaded")
    app.run(port=5000, debug=True)