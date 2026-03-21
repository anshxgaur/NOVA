# NOVA Interface v2.0 — AI Assistant
<p align="center">
  <b>Ansh Gaur</b><br>
  <i>A futuristic AI assistant powered by Groq's ultra-fast LPU inference</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-TypeScript-blue?style=for-the-badge&logo=react"/>
  <img src="https://img.shields.io/badge/AI-Groq_LPU-orange?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Model-Llama_3.3_70B-purple?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Status-Active_Development-green?style=for-the-badge"/>
</p>

---

## ⚡ What is NOVA?

NOVA is a sleek, futuristic AI assistant interface built with React + TypeScript, powered by **Groq's LPU (Language Processing Unit)** for lightning-fast responses. It features a stunning cyber-aesthetic UI with a glowing orb, real-time system log, and a smart auto-expanding input.

---

## 🔥 Features

| Feature | Description |
|---------|-------------|
| **⚡ Ultra-Fast AI** | Powered by Groq LPU — 750+ tokens/sec |
| **🌐 Multilingual** | Speaks Hindi, French, English and more |
| **🎨 Cyber UI** | Glowing orb, animated bars, futuristic theme |
| **📜 System Log** | Real-time scrollable conversation panel |
| **📝 Smart Input** | Auto-expanding textarea like ChatGPT |
| **🔒 Secure** | API key stored in `.env`, never exposed |

---

## 🚀 Quick Start
```bash
# 1. Clone Repo
git clone https://github.com/anshxgaur/MODEL-X.git
cd MODEL-X

# 2. Install Node Dependencies
npm install

# 3. Create Virtual Environment
python -m venv venv

# Activate Environment
source venv/Scripts/activate   # Git Bash / Linux / macOS
venv\Scripts\activate          # Windows CMD / PowerShell

# 4. Install Python Dependencies
pip install -r requirements.txt

# 5. Setup Environment Variables
# Create a .env file in the root folder:
VITE_GROQ_API_KEY=your_groq_api_key_here
GROQ_API_KEY=your_groq_api_key_here
# Get your FREE API key at: https://console.groq.com

# 6. Run Python Backend
python app.py

# 7. Run Frontend (new terminal)
npm run dev

# 8. Open Browser
# Go to http://localhost:5173
```

---

## 🏗️ Project Structure
```
MODEL-X/
├── src/
│   ├── components/
│   │   ├── NovaInterface.tsx   # Main futuristic UI
│   │   ├── ChatTab.tsx         # Chat component
│   │   ├── VisionTab.tsx       # Camera + VLM
│   │   └── VoiceTab.tsx        # Voice pipeline
│   ├── styles/
│   │   └── NovaTheme.css       # Cyber aesthetic CSS
│   ├── App.tsx                 # App root
│   └── main.tsx                # React entry point
├── app.py                      # Flask backend (Groq API)
├── .env                        # API keys (never commit!)
├── .gitignore                  # Protects .env from GitHub
└── package.json
```

---

## 🔥 PROJECTS

<p align="center">
  <b>Ansh Gaur</b><br>
  <i>Showcasing specialized work in AI, Healthcare Intelligence & Voice Automation</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.9+-blue?style=for-the-badge&logo=python"/>
  <img src="https://img.shields.io/badge/Focus-AI_&_Automation-teal?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Status-Active_Development-green?style=for-the-badge"/>
</p>

---

<table width="100%">
<tr>
<td width="33%" align="center">

## 🤖 MODEL-X (NOVA)
<img src="https://img.shields.io/badge/Domain-AI_Assistant-00eaff?style=flat-square"/>
<img src="https://img.shields.io/badge/Tech-React_+_Groq-blueviolet?style=flat-square"/>

</td>
<td width="33%" align="center">

## 🌼 DAISY
<img src="https://img.shields.io/badge/Domain-Healthcare-red?style=flat-square"/>
<img src="https://img.shields.io/badge/Tech-Streamlit-FF4B4B?style=flat-square"/>

</td>
<td width="33%" align="center">

## 🗣️ NOVA Voice
<img src="https://img.shields.io/badge/Domain-Voice_Automation-blueviolet?style=flat-square"/>
<img src="https://img.shields.io/badge/Tech-PyAutoGUI-green?style=flat-square"/>

</td>
</tr>
<tr>
<td valign="top">

### Futuristic AI Assistant
A React + TypeScript AI assistant with a stunning cyber UI powered by Groq's ultra-fast LPU inference engine.

**🔥 Key Features**
- **Ultra-Fast:** Groq LPU 750+ tok/s
- **Cyber UI:** Glowing orb & animations
- **Multilingual:** Hindi, French, English
- **Secure:** `.env` protected API keys

</td>
<td valign="top">

### Healthcare Data Intelligence
An end-to-end AI framework designed to analyze complex medical datasets, predict disease outbreaks, and optimize hospital resource allocation.

**🏥 Key Features**
- **Disease Prediction:** Heart Disease & Diabetes risk modeling
- **Interactive Dashboard:** Real-time patient vitals via Streamlit
- **Risk Stratification:** Categorizing patients by urgency

</td>
<td valign="top">

### Intelligent Voice Assistant
A desktop automation companion that listens, understands, and acts. Control your system through voice commands.

**🎙️ Key Features**
- **System Control:** Voice-activated Volume & Brightness
- **Web Automation:** Google Search & YouTube playback
- **Hands-Free:** Mouse control & voice typing

</td>
</tr>
<tr>
<td valign="top">

<details>
<summary><b>⚙️ How to Run MODEL-X</b></summary>
```bash
git clone https://github.com/anshxgaur/MODEL-X.git
cd MODEL-X
npm install
npm run dev
```
</details>

<details>
<summary><b>🛠️ Tech Stack</b></summary>

- `react`
- `typescript`
- `groq`
- `flask`
- `vite`
</details>

</td>
<td valign="top">

<details>
<summary><b>⚙️ How to Run DAISY</b></summary>
```bash
git clone https://github.com/anshxgaur/DAISY.git
cd DAISY
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```
</details>

<details>
<summary><b>🛠️ Tech Stack</b></summary>

- `pandas`
- `numpy`
- `scikit-learn`
- `plotly`
- `seaborn`
- `streamlit`
</details>

</td>
<td valign="top">

<details>
<summary><b>⚙️ How to Run NOVA Voice</b></summary>
```bash
git clone https://github.com/anshxgaur/NOVA.git
cd NOVA
python -m venv venv
cd src 
source venv/Scripts/activate
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
</details>

<details>
<summary><b>🛠️ Tech Stack</b></summary>

- `speech_recognition`
- `pyttsx3`
- `pyautogui`
- `pyaudio`
</details>

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

<p align="center">
  <img src="https://img.shields.io/badge/React-18-blue?style=for-the-badge&logo=react"/>
  <img src="https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript"/>
  <img src="https://img.shields.io/badge/Groq-LPU-orange?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Flask-Python-black?style=for-the-badge&logo=flask"/>
  <img src="https://img.shields.io/badge/Vite-5-purple?style=for-the-badge&logo=vite"/>
</p>

---

## 🔒 Security

- API keys stored in `.env` — **never committed to GitHub**
- `.env` is listed in `.gitignore`
- Use `VITE_GROQ_API_KEY` for frontend, `GROQ_API_KEY` for backend

---

## 📄 License

MIT

---

<p align="center">Made with ❤️ by <b>Ansh Gaur</b></p>
