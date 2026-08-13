/** One OpenAI-compatible provider for the assistant and Qodo Mail AI. */

let client = null;

export const aiBaseUrl = () => String(process.env.QODO_AI_BASE_URL || '').trim();

export const aiModel = () =>
  String(process.env.QODO_AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

export const aiConfigured = () => Boolean(aiBaseUrl() || process.env.OPENAI_API_KEY);

export const aiProviderName = () => (aiBaseUrl() ? 'qodo-compatible' : 'openai');

export async function getAiClient() {
  if (client) return client;
  const { default: OpenAI } = await import('openai');
  const baseURL = aiBaseUrl();
  // Never forward an OpenAI credential to a custom endpoint. A compatible
  // Qodo server gets only its own key (or a harmless local placeholder).
  const apiKey = baseURL
    ? String(process.env.QODO_AI_API_KEY || 'qodo-local')
    : String(process.env.OPENAI_API_KEY || '');
  client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  return client;
}
