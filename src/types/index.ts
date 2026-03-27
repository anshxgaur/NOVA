// src/types/index.ts

export interface Message {
    id: string;
    senderId: string;
    recipientId: string;
    content: string;
    timestamp: Date;
}

export interface Memory {
    id: string;
    userId: string;
    data: any;
    createdAt: Date;
}

export interface Conversation {
    id: string;
    participants: string[];
    messages: Message[];
    createdAt: Date;
}

export interface Stats {
    totalMessages: number;
    activeUsers: number;
    conversationCount: number;
}

export interface Analytics {
    userId: string;
    statistics: Stats;
    generatedAt: Date;
}

export interface CommandResponse {
    command: string;
    response: string;
    success: boolean;
}

export interface Greeting {
    message: string;
    user: string;
    timestamp: Date;
}

export interface DailyBriefing {
    date: Date;
    summary: string;
    actionItems: string[];
}