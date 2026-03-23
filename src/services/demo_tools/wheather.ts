// This file handles the logic for the weather tool
export const weatherTool = {
  def: {
    name: 'get_weather',
    description: 'Gets the current weather for a city. Returns temperature in Fahrenheit and a short condition.',
    parameters: [
      { name: 'location', type: 'string', description: 'City name (e.g. "San Francisco")', required: true },
    ],
    category: 'Utility',
  },
  executor: async (args: { location?: string }) => {
    // In a real app, you would fetch from an API like OpenWeather here
    // For now, we use the logic from your original ToolsTab
    const city = args.location ?? 'Unknown';
    const conditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Rainy', 'Windy', 'Foggy'];
    const temp = Math.round(45 + Math.random() * 50);
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    
    return {
      location: city,
      temperature_f: temp,
      condition: condition,
      humidity_pct: Math.round(30 + Math.random() * 60),
    };
  },
};
