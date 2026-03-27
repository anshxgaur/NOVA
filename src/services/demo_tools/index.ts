// ─────────────────────────────────────────
// NOVA DEMO TOOLS — No SDK required
// Plain TypeScript tool definitions
// ─────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
  }[];
}

type ToolExecutor = (args: Record<string, any>) => Promise<Record<string, any>>;

export const ALL_DEMO_TOOLS: { def: ToolDefinition; executor: ToolExecutor }[] = [
  {
    def: {
      name: 'get_weather',
      description: 'Gets the current weather for a city.',
      category: 'Utility',
      parameters: [
        { name: 'location', type: 'string', description: 'City name e.g. "Mumbai"', required: true },
      ],
    },
    executor: async (args) => {
      const city = args.location ?? 'Unknown';
      const conditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Rainy', 'Windy', 'Foggy'];
      const temp = Math.round(20 + Math.random() * 20);
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      return { location: city, temperature_c: temp, condition, humidity_pct: Math.round(30 + Math.random() * 60) };
    },
  },
  {
    def: {
      name: 'calculate',
      description: 'Evaluates a mathematical expression.',
      category: 'Math',
      parameters: [
        { name: 'expression', type: 'string', description: 'Math expression e.g. "2 + 3 * 4"', required: true },
      ],
    },
    executor: async (args) => {
      const expr = args.expression ?? '0';
      try {
        const sanitized = expr.replace(/[^0-9+\-*/().%\s^]/g, '');
        const val = Function(`"use strict"; return (${sanitized})`)();
        return { result: Number(val), expression: expr };
      } catch {
        return { error: `Invalid expression: ${expr}` };
      }
    },
  },
  {
    def: {
      name: 'get_time',
      description: 'Returns the current date and time.',
      category: 'Utility',
      parameters: [
        { name: 'timezone', type: 'string', description: 'IANA timezone e.g. "Asia/Kolkata"', required: false },
      ],
    },
    executor: async (args) => {
      const tz = args.timezone ?? 'Asia/Kolkata';
      try {
        const now = new Date();
        const formatted = now.toLocaleString('en-IN', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
        return { datetime: formatted, timezone: tz };
      } catch {
        return { datetime: new Date().toISOString(), timezone: 'UTC' };
      }
    },
  },
  {
    def: {
      name: 'random_number',
      description: 'Generates a random integer between min and max.',
      category: 'Math',
      parameters: [
        { name: 'min', type: 'number', description: 'Minimum value', required: true },
        { name: 'max', type: 'number', description: 'Maximum value', required: true },
      ],
    },
    executor: async (args) => {
      const min = Number(args.min) ?? 1;
      const max = Number(args.max) ?? 100;
      const value = Math.floor(Math.random() * (max - min + 1)) + min;
      return { value, min, max };
    },
  },
];