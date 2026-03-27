// API client for backend integration

import axios from 'axios';

const API_BASE_URL = 'https://api.yourservice.com/';

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
});

// Chat endpoint
export const chatApi = {
    sendMessage: (message) => apiClient.post('/chat/send', { message }),
    fetchMessages: () => apiClient.get('/chat/messages'),
};

// Memory endpoint
export const memoryApi = {
    saveMemory: (memory) => apiClient.post('/memory/save', { memory }),
    fetchMemories: () => apiClient.get('/memory/all'),
};

// Conversations endpoint
export const conversationApi = {
    startConversation: (participants) => apiClient.post('/conversations/start', { participants }),
    getConversations: () => apiClient.get('/conversations/all'),
};

// Stats endpoint
export const statsApi = {
    getStats: () => apiClient.get('/stats'),
};

// Analytics endpoint
export const analyticsApi = {
    getAnalytics: () => apiClient.get('/analytics'),
};

// Command endpoint
export const commandApi = {
    executeCommand: (command) => apiClient.post('/command/execute', { command }),
};