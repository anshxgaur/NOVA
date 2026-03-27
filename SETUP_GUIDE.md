# Setup Guide for NOVA AI Assistant Hackathon Project

## Prerequisites
Before you begin, make sure you have the following installed:
- **Node.js** (version >= 14.0.0)
- **Python** (version >= 3.7)
- **pip** (Python package installer)
- **git**

## Backend Setup

### 1. Clone repository
Open your terminal and run the following command:
```bash
git clone https://github.com/anshxgaur/MODEL-X.git
cd MODEL-X
```

### 2. Create virtual environment
```bash
python -m venv venv
```

### 3. Install dependencies
Activate the virtual environment:
- On Windows:
  ```bash
  venv\Scripts\activate
  ```
- On macOS/Linux:
  ```bash
  source venv/bin/activate
  ```
Then install the required dependencies:
```bash
pip install -r requirements.txt
```

### 4. Set environment variables
Create a `.env` file in the root directory and include the following line:
```
GROQ_API_KEY=your_api_key_here
```
Make sure to replace `your_api_key_here` with your actual GROQ API key.

### 5. Run Flask server
Finally, start the Flask server using:
```bash
python app.py
```

## Frontend Setup

### 1. Install Node dependencies
In a new terminal tab/window, navigate to the frontend directory and run:
```bash
npm install
```

### 2. Start development server
To start the frontend development server, use:
```bash
npm run dev
```

## Features Overview
- **Real-time user interaction** with the NOVA AI Assistant.
- **Data fetching** capabilities using GROQ with customizable templates.
- **Interactive UI** built with modern web technologies.

## Troubleshooting Section
- If you encounter issues with package installations, ensure Node.js and Python versions are correct.
- Verify your `.env` configuration if the server fails to start or returns errors related to API keys.

## Project Structure Explanation
- **/backend**: Contains all the backend code and dependencies.
- **/frontend**: Holds the frontend application with all its components.
- **/venv**: The virtual environment for the Python backend.
- **app.py**: Main entry point for the Flask application.