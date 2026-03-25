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
import requests
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus
from pynput.keyboard import Controller, Key

# Optional Spotify API support
spotipy = None
SpotifyOAuth = None
spotify_client = None
SPOTIPY_AVAILABLE = False

try:
    import spotipy as spotipy_module
    from spotipy.oauth2 import SpotifyOAuth as SpotifyOAuthClass
    spotipy = spotipy_module
    SpotifyOAuth = SpotifyOAuthClass
    SPOTIPY_AVAILABLE = True
except ImportError:
    SPOTIPY_AVAILABLE = False

# Optional volume control
try:
    from ctypes import POINTER, cast
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    devices = AudioUtilities.GetSpeakers()  # type: ignore
    iface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)  # type: ignore
    volume_iface = cast(iface, POINTER(IAudioEndpointVolume))  # type: ignore
    HAS_PYCAW = True
except Exception as e:
    print(f"PyCAW not available: {e} - using keyboard volume controls")
    HAS_PYCAW = False
    volume_iface = None

load_dotenv()

app = Flask(__name__)
CORS(app)

groq_api_key = os.environ.get("GROQ_API_KEY")
if groq_api_key:
    client = Groq(api_key=groq_api_key)
else:
    client = None

system_platform = platform.system()
keyboard = Controller()

# Setup Spotify object (optional)
spotify_client = None
if SPOTIPY_AVAILABLE and spotipy is not None and SpotifyOAuth is not None:
    client_id = os.getenv("SPOTIPY_CLIENT_ID")
    client_secret = os.getenv("SPOTIPY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8888/callback")

    if client_id and client_secret and client_id != "your_spotify_client_id_here" and client_secret != "your_spotify_client_secret_here":
        try:
            spotify_client = spotipy.Spotify(auth_manager=SpotifyOAuth(
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=redirect_uri,
                scope="user-read-playback-state user-modify-playback-state"
            ))
        except Exception as e:
            print(f"Spotify client initialization failed: {e}")
            spotify_client = None
    else:
        print("Spotify API keys not properly configured - using fallback methods")

# Typing mode state
typing_mode = False
alarms = []

# One-time hello greeting state
hello_nova_greeted = False

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
CONVERSATIONS_FILE = Path("conversations.json")

def load_memories():
    if MEMORY_FILE.exists():
        with open(MEMORY_FILE, "r") as f:
            return json.load(f)
    return []

def save_memories(memories):
    with open(MEMORY_FILE, "w") as f:
        json.dump(memories, f, indent=2)

def load_conversations():
    if CONVERSATIONS_FILE.exists():
        with open(CONVERSATIONS_FILE, "r") as f:
            return json.load(f)
    return []

def save_conversations(conversations):
    with open(CONVERSATIONS_FILE, "w") as f:
        json.dump(conversations, f, indent=2)

def log_conversation(user_message, assistant_message):
    """Log a conversation exchange with timestamp"""
    conversations = load_conversations()
    
    # Detect sentiment
    sentiment = "neutral"
    positive = ["happy", "great", "awesome", "love", "excited", "thanks", "perfect"]
    negative = ["sad", "bad", "angry", "hate", "frustrated", "annoyed", "error"]
    user_lower = user_message.lower()
    
    pos_count = sum(1 for word in positive if word in user_lower)
    neg_count = sum(1 for word in negative if word in user_lower)
    
    if pos_count > neg_count:
        sentiment = "positive"
    elif neg_count > pos_count:
        sentiment = "negative"
    
    # Auto-detect topic
    topic = "general"
    if any(word in user_lower for word in ["code", "python", "javascript", "debug", "error", "function"]):
        topic = "coding"
    elif any(word in user_lower for word in ["work", "project", "meeting", "deadline", "task"]):
        topic = "work"
    elif any(word in user_lower for word in ["music", "song", "spotify", "play", "playlist"]):
        topic = "entertainment"
    elif any(word in user_lower for word in ["weather", "time", "date", "calendar"]):
        topic = "info"
    
    entry = {
        "id": str(int(time.time() * 1000)),
        "timestamp": datetime.now().isoformat(),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "time": datetime.now().strftime("%H:%M:%S"),
        "user": user_message,
        "assistant": assistant_message,
        "sentiment": sentiment,
        "topic": topic
    }
    conversations.append(entry)
    conversations = conversations[-500:]
    save_conversations(conversations)
    return entry

def get_conversations_by_timeframe(timeframe):
    """Get conversations filtered by timeframe"""
    conversations = load_conversations()
    now = datetime.now()
    
    filtered = []
    for conv in conversations:
        conv_time = datetime.fromisoformat(conv["timestamp"])
        
        if timeframe == "today":
            if conv_time.date() == now.date():
                filtered.append(conv)
        elif timeframe == "yesterday":
            yesterday = now.date() - timedelta(days=1)
            if conv_time.date() == yesterday:
                filtered.append(conv)
        elif timeframe == "last_night":
            yesterday = now.date() - timedelta(days=1)
            if conv_time.date() == yesterday and conv_time.hour >= 18:
                filtered.append(conv)
            elif conv_time.date() == now.date() and conv_time.hour < 4:
                filtered.append(conv)
        elif timeframe == "this_week":
            days_diff = (now.date() - conv_time.date()).days
            if days_diff <= 7:
                filtered.append(conv)
        elif timeframe == "all":
            filtered.append(conv)
    
    return filtered

def summarize_conversation(conversations):
    """Generate a brief summary of conversations"""
    if not conversations:
        return "No conversations found for this timeframe."
    
    conv_text = ""
    for conv in conversations:
        conv_text += f"[{conv['time']}] User: {conv['user']}\n"
        conv_text += f"[{conv['time']}] NOVA: {conv['assistant']}\n\n"
    
    if client is None:
        # Fallback non-API summary
        return "Could not access API. Raw conversation text:\n" + conv_text

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=512,
            messages=[
                {"role": "system", "content": "You are NOVA. Summarize the following conversation concisely, highlighting key topics discussed and any important information shared."},
                {"role": "user", "content": f"Summarize this conversation:\n\n{conv_text}"}
            ]
        )
        return response.choices[0].message.content
    except Exception:
        return "Could not generate summary. Here are the conversations:\n" + conv_text

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
    memories = memories[:50]
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

@app.route('/api/conversations', methods=['GET'])
def get_conversations():
    timeframe = request.args.get('timeframe', 'all')
    conversations = get_conversations_by_timeframe(timeframe)
    return jsonify({"conversations": conversations, "count": len(conversations)})

@app.route('/api/conversations/summary', methods=['POST'])
def get_conversation_summary():
    data = request.json
    timeframe = data.get("timeframe", "all")
    conversations = get_conversations_by_timeframe(timeframe)
    
    if not conversations:
        return jsonify({
            "summary": f"No conversations found for {timeframe}.",
            "count": 0
        })
    
    summary = summarize_conversation(conversations)
    return jsonify({
        "summary": summary,
        "count": len(conversations),
        "timeframe": timeframe
    })

@app.route('/api/conversations/clear', methods=['POST'])
def clear_conversations():
    save_conversations([])
    return jsonify({"status": "All conversations cleared"})

# ─────────────────────────────────────────
# QUICK STATS & ANALYTICS
# ─────────────────────────────────────────

@app.route('/api/stats', methods=['GET'])
def get_quick_stats():
    """Get quick conversation statistics"""
    return jsonify(compute_quick_stats())

def compute_quick_stats():
    """Compute quick conversation statistics"""
    conversations = load_conversations()
    
    if not conversations:
        return {
            "total_conversations": 0,
            "today_count": 0,
            "streak_days": 0,
            "badge": None
        }
    
    # Count by date
    date_counts = {}
    for conv in conversations:
        date = conv['date']
        date_counts[date] = date_counts.get(date, 0) + 1
    
    # Calculate streak
    today = datetime.now().date()
    streak = 0
    current_date = today
    
    while True:
        date_str = current_date.strftime("%Y-%m-%d")
        if date_str in date_counts:
            streak += 1
            current_date = current_date - timedelta(days=1)
        else:
            break
    
    # Today's count
    today_str = today.strftime("%Y-%m-%d")
    today_count = date_counts.get(today_str, 0)
    
    # Award badges
    badge = None
    if streak >= 7:
        badge = "🔥 Week Warrior!"
    elif streak >= 3:
        badge = "⚡ 3-Day Streak!"
    elif today_count >= 20:
        badge = "💬 Chatty Today!"
    elif today_count >= 10:
        badge = "🗣️ Active User!"
    elif len(conversations) >= 100:
        badge = "🏆 Century Club!"
    
    return {
        "total_conversations": len(conversations),
        "today_count": today_count,
        "streak_days": streak,
        "badge": badge,
        "most_active_day": max(date_counts, key=lambda k: date_counts.get(k, 0)) if date_counts else None
    }

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    """Get detailed analytics"""
    convs = load_conversations()
    
    if not convs:
        return jsonify({"message": "No data yet"})
    
    # Hour distribution
    hour_counts = {}
    for conv in convs:
        hour = datetime.fromisoformat(conv['timestamp']).hour
        hour_counts[hour] = hour_counts.get(hour, 0) + 1
    
    # Topic distribution
    topic_counts = {}
    for conv in convs:
        topic = conv.get('topic', 'general')
        topic_counts[topic] = topic_counts.get(topic, 0) + 1
    
    # Sentiment distribution
    sentiment_counts = {"positive": 0, "neutral": 0, "negative": 0}
    for conv in convs:
        sentiment = conv.get('sentiment', 'neutral')
        sentiment_counts[sentiment] = sentiment_counts.get(sentiment, 0) + 1
    
    return jsonify({
        "total_conversations": len(convs),
        "busiest_hour": max(hour_counts, key=lambda k: hour_counts.get(k, 0)) if hour_counts else 0,
        "hourly_distribution": hour_counts,
        "topic_distribution": topic_counts,
        "sentiment_distribution": sentiment_counts,
        "average_response_length": sum(len(c['assistant']) for c in convs) // len(convs)
    })

@app.route('/api/greeting', methods=['GET'])
def smart_greeting():
    """Time-aware smart greeting"""
    hour = datetime.now().hour
    conversations = load_conversations()
    stats = compute_quick_stats()
    
    if hour < 12:
        greeting = "Good morning"
    elif hour < 17:
        greeting = "Good afternoon"
    else:
        greeting = "Good evening"
    
    # Add personalization
    if stats['streak_days'] >= 3:
        greeting += f"! 🔥 {stats['streak_days']}-day streak!"
    elif stats['today_count'] > 0:
        greeting += f"! We've chatted {stats['today_count']} times today."
    else:
        greeting += "! Great to see you again."
    
    return jsonify({"greeting": greeting})

@app.route('/api/daily-briefing', methods=['GET'])
def daily_briefing():
    """Generate daily briefing"""
    return jsonify(compute_daily_briefing())

def compute_daily_briefing():
    """Compute daily briefing"""
    today_convs = get_conversations_by_timeframe("today")
    yesterday_convs = get_conversations_by_timeframe("yesterday")
    memories = load_memories()
    stats = compute_quick_stats()
    
    briefing = f"""📊 Daily Briefing for {datetime.now().strftime('%B %d, %Y')}

✨ Quick Stats:
• Yesterday: {len(yesterday_convs)} conversations
• Today so far: {len(today_convs)} conversations  
• Active memories: {len(memories)}
• Current streak: {stats['streak_days']} days {stats['badge'] or ''}

"""
    
    if yesterday_convs:
        summary = summarize_conversation(yesterday_convs[-5:])  # Last 5 from yesterday
        briefing += f"\n📝 Yesterday's Highlights:\n{summary}\n"
    
    return {"briefing": briefing}

# ─────────────────────────────────────────
# CHAT ROUTES
# ─────────────────────────────────────────

@app.route('/api/sonnet', methods=['POST'])
def handle_task():
    if client is None:
        return jsonify({"status": "Groq API key not configured", "speak": "AI completion is unavailable because GROQ_API_KEY is not set."}), 503

    data = request.json
    user_prompt = data.get("prompt", "")

    def generate():
        stream = client.chat.completions.create(  # type: ignore
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

    memories = load_memories()
    memory_context = ""
    if memories:
        memory_context = "\n\nUser memories (use these to personalize your responses):\n"
        memory_context += "\n".join([f"- {m['text']}" for m in memories])
    
    # Add conversation history context
    conversations = load_conversations()
    conversation_context = ""
    if conversations:
        last_conv = conversations[-1]
        first_conv = conversations[0]
        conversation_context = f"\n\nConversation History Info:\n"
        conversation_context += f"- First conversation: {first_conv['date']} at {first_conv['time']}\n"
        conversation_context += f"- Last conversation: {last_conv['date']} at {last_conv['time']}\n"
        conversation_context += f"- Total conversations: {len(conversations)}\n"
        
        # Add recent conversation times (last 5)
        recent = conversations[-5:]
        conversation_context += f"- Recent conversation times:\n"
        for conv in recent:
            conversation_context += f"  • {conv['date']} at {conv['time']}\n"
    
    # Add stats context
    stats = compute_quick_stats()
    stats_context = f"\n\nUser Stats:\n"
    stats_context += f"- Today's chats: {stats['today_count']}\n"
    stats_context += f"- Current streak: {stats['streak_days']} days\n"
    if stats['badge']:
        stats_context += f"- Achievement: {stats['badge']}\n"

    full_response = ""
    user_message = messages[-1]["content"] if messages else ""

    if client is None:
        return jsonify({"status": "Groq API key not configured", "speak": "AI conversation is unavailable because GROQ_API_KEY is not set."}), 503

    def generate():
        nonlocal full_response
        stream = client.chat.completions.create(  # type: ignore
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT + memory_context + conversation_context + stats_context},
                *messages
            ]
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                full_response += delta
                yield delta
        
        if user_message and full_response:
            log_conversation(user_message, full_response)

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "NOVA backend online ⚡"})

# helper: force media key play/pause toggle in local OS
def force_playback_media_key():
    try:
        pyautogui.press("playpause")
        time.sleep(0.2)
        pyautogui.press("playpause")
    except Exception:
        pass

# ─────────────────────────────────────────
# VOLUME CONTROL
# ─────────────────────────────────────────

def control_volume_action(action, percent=None):
    # Try Spotify API volume if available and playback is active
    if spotify_client is not None:
        try:
            sp = spotify_client
            playback = sp.current_playback()
            if playback and playback.get("is_playing") is not None:
                current_volume = playback.get("device", {}).get("volume_percent")
                if current_volume is None:
                    current_volume = 50

                if action == "get":
                    return jsonify({"status": f"Spotify volume is at {current_volume}%", "speak": f"Current Spotify volume is {current_volume} percent.", "level": current_volume})

                if action == "increase":
                    new_volume = min(current_volume + (percent or 15), 100)
                    sp.volume(new_volume)
                    return jsonify({"status": f"Spotify volume increased to {new_volume}%", "speak": f"Spotify volume increased to {new_volume} percent."})

                if action == "decrease":
                    new_volume = max(current_volume - (percent or 15), 0)
                    sp.volume(new_volume)
                    return jsonify({"status": f"Spotify volume decreased to {new_volume}%", "speak": f"Spotify volume decreased to {new_volume} percent."})

                if action == "set" and percent is not None:
                    new_volume = min(max(int(percent), 0), 100)
                    sp.volume(new_volume)
                    return jsonify({"status": f"Spotify volume set to {new_volume}%", "speak": f"Spotify volume set to {new_volume} percent."})

        except Exception as e:
            print("Spotify volume control fallback: ", str(e))

    if not HAS_PYCAW or not volume_iface:
        if action == "increase":
            presses = int((percent or 15) / 2)
            for _ in range(presses): 
                pyautogui.press("volumeup")
            return jsonify({"status": "Volume increased", "speak": "Volume increased."})
        elif action == "decrease":
            presses = int((percent or 15) / 2)
            for _ in range(presses): 
                pyautogui.press("volumedown")
            return jsonify({"status": "Volume decreased", "speak": "Volume decreased."})
        elif action == "mute":
            pyautogui.press("volumemute")
            return jsonify({"status": "Muted", "speak": "Muted."})
        elif action == "set" and percent is not None:
            for _ in range(50): 
                pyautogui.press("volumedown")
            for _ in range(int(percent / 2)): 
                pyautogui.press("volumeup")
            return jsonify({"status": f"Volume set to {percent}%", "speak": f"Volume set to {percent} percent."})

    try:
        curr = volume_iface.GetMasterVolumeLevelScalar()  # type: ignore
        curr_pct = int(curr * 100)

        if action == "increase":
            change = (percent or 15) / 100
            new_vol = min(curr + change, 1.0)
            volume_iface.SetMasterVolumeLevelScalar(new_vol, None)  # type: ignore
            return jsonify({
                "status": f"Volume increased to {int(new_vol * 100)}%",
                "speak": f"Volume increased to {int(new_vol * 100)} percent."
            })
        elif action == "decrease":
            change = (percent or 15) / 100
            new_vol = max(curr - change, 0.0)
            volume_iface.SetMasterVolumeLevelScalar(new_vol, None)  # type: ignore
            return jsonify({
                "status": f"Volume decreased to {int(new_vol * 100)}%",
                "speak": f"Volume decreased to {int(new_vol * 100)} percent."
            })
        elif action == "mute":
            pyautogui.press("volumemute")
            return jsonify({"status": "Muted", "speak": "Audio muted."})
        elif action == "set" and percent is not None:
            volume_iface.SetMasterVolumeLevelScalar(percent / 100, None)  # type: ignore
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

    return jsonify({"error": "Unknown volume action"}), 400

@app.route('/api/volume', methods=['POST'])
def control_volume():
    data = request.json
    action = data.get("action", "")
    percent = data.get("percent", None)
    return control_volume_action(action, percent)

# ─────────────────────────────────────────
# ALARM FUNCTION
# ─────────────────────────────────────────

def alarm_thread(alarm_time):
    while True:
        now = datetime.now().strftime("%H:%M")
        if now == alarm_time and alarm_time in alarms:
            for _ in range(5):
                print(f"\a🔔 ALARM! {alarm_time}")
                time.sleep(1)
            alarms.remove(alarm_time)
            break
        time.sleep(30)

# ─────────────────────────────────────────
# MOUSE CONTROL
# ─────────────────────────────────────────

@app.route('/api/mouse', methods=['POST'])
def control_mouse():
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

def initiate_spotify_play(song_query):
    """Background worker to initiate Spotify playback without blocking the HTTP response."""
    try:
        if spotify_client is not None:
            sp = spotify_client
            search_result = sp.search(q=song_query, type="track", limit=1)
            if search_result and search_result.get("tracks", {}).get("items"):
                track = search_result["tracks"]["items"][0]
                track_uri = track["uri"]
                track_id = track["id"]
                try:
                    devices_response = sp.devices()
                    devices = devices_response.get("devices", []) if isinstance(devices_response, dict) else []
                    if devices:
                        device_id = devices[0]["id"]
                        try:
                            sp.transfer_playback(device_id=device_id, force_play=True)
                        except Exception:
                            pass
                        sp.start_playback(device_id=device_id, uris=[track_uri])
                        return
                except Exception as e:
                    print(f"Spotify API playback failed: {e}")

                # If Spotify API could not start, open on web and hit play/pause key event
                track_url = f"https://open.spotify.com/track/{track_id}"
                if system_platform == "Windows":
                    os.system(f"start {track_url}")
                elif system_platform == "Darwin":
                    os.system(f"open {track_url}")
                else:
                    webbrowser.open(track_url)

                time.sleep(1)
                force_playback_media_key()
                return

    except Exception as e:
        print(f"Spotify API search failed: {e}")

    # Fallback, deep link search if everything else fails
    try:
        if system_platform == "Windows":
            os.system("start spotify:")
            time.sleep(1)
            deep_url = f"spotify:search:{quote_plus(song_query)}"
            os.system(f"start {deep_url}")
        elif system_platform == "Darwin":
            os.system("open -a Spotify")
            time.sleep(1)
            deep_url = f"spotify:search:{quote_plus(song_query)}"
            os.system(f'open "{deep_url}"')
        else:
            search_url = f"https://open.spotify.com/search/{quote_plus(song_query)}"
            webbrowser.open(search_url)

        time.sleep(1)
        force_playback_media_key()
    except Exception as e:
        print(f"Fallback Spotify opening failed: {e}")


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

@app.route('/api/command', methods=['POST'])
def parse_command():
    global typing_mode
    data = request.json
    command = data.get("command", "").lower()

    # Memory Commands
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

    global hello_nova_greeted

    if "hello nova" in command or "hi nova" in command or "hello there" in command:
        if not hello_nova_greeted:
            hello_nova_greeted = True
            current_hour = datetime.now().hour
            if current_hour < 6:
                greet = "Good night"
            elif current_hour < 12:
                greet = "Good morning"
            elif current_hour < 18:
                greet = "Good afternoon"
            elif current_hour < 22:
                greet = "Good evening"
            else:
                greet = "Good night"
            return jsonify({"status": "First greeting", "speak": f"{greet}! How can I help you today?"})
        else:
            return jsonify({"status": "Repeat greeting", "speak": "Hello again! Ready when you are."})

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

    # Conversation Summary Commands
    if any(phrase in command for phrase in ["conversation last night", "what did we talk about last night", "brief of last night", "summary of last night"]):
        conversations = get_conversations_by_timeframe("last_night")
        if conversations:
            summary = summarize_conversation(conversations)
            return jsonify({
                "status": "Generating summary",
                "speak": f"Here's what we discussed last night: {summary}",
                "summary": summary
            })
        else:
            return jsonify({
                "status": "No conversations found",
                "speak": "I don't have any record of conversations from last night."
            })
    
    if any(phrase in command for phrase in ["conversation yesterday", "what did we talk about yesterday", "yesterday's conversation"]):
        conversations = get_conversations_by_timeframe("yesterday")
        if conversations:
            summary = summarize_conversation(conversations)
            return jsonify({
                "status": "Generating summary",
                "speak": f"Here's what we discussed yesterday: {summary}",
                "summary": summary
            })
        else:
            return jsonify({
                "status": "No conversations found",
                "speak": "I don't have any conversations from yesterday."
            })
    
    if any(phrase in command for phrase in ["conversation today", "what did we talk about today", "today's conversation"]):
        conversations = get_conversations_by_timeframe("today")
        if conversations:
            summary = summarize_conversation(conversations)
            return jsonify({
                "status": "Generating summary",
                "speak": f"Here's what we discussed today: {summary}",
                "summary": summary
            })
        else:
            return jsonify({
                "status": "No conversations found",
                "speak": "We haven't had any conversations today yet."
            })
    
    if any(phrase in command for phrase in ["all conversations", "entire conversation history", "full conversation"]):
        conversations = get_conversations_by_timeframe("all")
        if conversations:
            summary = summarize_conversation(conversations)
            return jsonify({
                "status": "Generating summary",
                "speak": f"Here's a summary of all our conversations: {summary}",
                "summary": summary
            })
        else:
            return jsonify({
                "status": "No conversations found",
                "speak": "I don't have any conversation history stored."
            })

    # Typing Mode
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

    # Shortcut Keys
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

    # Volume
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

    # Shutdown
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

    # Mouse
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

    # Spotify & Music Control
    elif "open spotify" in command or "start spotify" in command:
        try:
            if system_platform == "Windows":
                os.system("start spotify:")
            elif system_platform == "Darwin":  # macOS
                os.system("open -a Spotify")
            else:  # Linux
                os.system("spotify &")
            return jsonify({
                "status": "Opening Spotify",
                "speak": "Opening Spotify for you."
            })
        except:
            return jsonify({"error": "Could not open Spotify"}), 500

    elif "play" in command and ("music" in command or "song" in command or "spotify" in command):
        song_query = command.lower()
        for phrase in ["play", "on spotify", "spotify", "music", "song"]:
            song_query = song_query.replace(phrase, "")
        song_query = song_query.strip()

        if not song_query:
            return jsonify({"status": "No song specified", "speak": "Please tell me which song to play."})

        # Start music playback in background thread
        threading.Thread(target=initiate_spotify_play, args=(song_query,), daemon=True).start()

        # Return response without speak to avoid interrupting music
        return jsonify({
            "status": f"Playing {song_query}",
            "speak": ""  # Empty speak to prevent audio interruption
        })


    
    elif "pause music" in command or "pause spotify" in command:
        pyautogui.press("playpause")
        return jsonify({"status": "Music paused", "speak": "Music paused."})
    
    elif "resume music" in command or "play music" in command:
        pyautogui.press("playpause")
        return jsonify({"status": "Music resumed", "speak": "Music resumed."})
    
    elif "next song" in command or "skip song" in command:
        pyautogui.press("nexttrack")
        return jsonify({"status": "Next song", "speak": "Playing next song."})
    
    elif "previous song" in command or "last song" in command:
        pyautogui.press("prevtrack")
        return jsonify({"status": "Previous song", "speak": "Playing previous song."})

    # Quick Stats
    elif "my stats" in command or "show stats" in command or "conversation stats" in command:
        stats = compute_quick_stats()
        speak = f"You have {stats['total_conversations']} total conversations. "
        speak += f"You've chatted {stats['today_count']} times today. "
        if stats['streak_days'] > 0:
            speak += f"Your current streak is {stats['streak_days']} days! "
        if stats['badge']:
            speak += f"You earned: {stats['badge']}"
        
        return jsonify({
            "status": "Stats retrieved",
            "speak": speak,
            "data": stats
        })
    
    # Daily Briefing
    elif "daily briefing" in command or "morning briefing" in command or "brief me" in command:
        briefing_data = compute_daily_briefing()
        return jsonify({
            "status": "Daily briefing ready",
            "speak": briefing_data['briefing'][:500],  # First 500 chars for speech
            "data": briefing_data
        })

    # Alarm
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

    return jsonify({"status": "not_a_command"})


if __name__ == '__main__':
    app.run(port=5000, debug=True)
