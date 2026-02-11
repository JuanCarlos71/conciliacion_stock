import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import * as nextjs from '@genkit-ai/next';

export const genkitAi = genkit({
  plugins: [googleAI(), nextjs.default()],
  model: 'googleai/gemini-2.5-flash',
});
