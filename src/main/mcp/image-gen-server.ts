/**
 * Image Generation MCP Server
 *
 * Exposes a single tool `generate_image` that calls OpenAI's image API
 * (default model `gpt-image-2`) and writes the result into the workspace's
 * `images/` directory. Returns the saved path so the chat can render a preview.
 *
 * Required env: OPENAI_API_KEY
 * Optional env: OPENAI_BASE_URL (default https://api.openai.com), WORKSPACE_DIR,
 *               IMAGE_GEN_MODEL (override default model name).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { writeMCPLog } from './mcp-logger';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const DEFAULT_MODEL = process.env.IMAGE_GEN_MODEL || 'gpt-image-2';
const DEFAULT_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(
  /\/+$/,
  ''
);

const ALLOWED_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const ALLOWED_QUALITY = new Set(['low', 'medium', 'high', 'auto']);
const ALLOWED_BACKGROUND = new Set(['transparent', 'opaque', 'auto']);
const ALLOWED_OUTPUT_FORMAT = new Set(['png', 'jpeg', 'webp']);

interface GenerateImageArgs {
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
  background?: string;
  output_format?: string;
  filename_hint?: string;
}

interface OpenAIImageResponseItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface OpenAIImageResponse {
  created?: number;
  data?: OpenAIImageResponseItem[];
  error?: { message?: string; type?: string };
}

function slugify(input: string, maxLen = 40): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return cleaned || 'image';
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function ensureImagesDir(): Promise<string> {
  const dir = path.join(WORKSPACE_DIR, 'images');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function validateArgs(raw: unknown): GenerateImageArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Arguments must be an object');
  }
  const args = raw as Record<string, unknown>;
  const prompt = args.prompt;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('`prompt` is required and must be a non-empty string');
  }

  const out: GenerateImageArgs = { prompt: prompt.trim() };

  if (args.size !== undefined) {
    if (typeof args.size !== 'string' || !ALLOWED_SIZES.has(args.size)) {
      throw new Error(`Invalid size. Allowed: ${Array.from(ALLOWED_SIZES).join(', ')}`);
    }
    out.size = args.size;
  }
  if (args.quality !== undefined) {
    if (typeof args.quality !== 'string' || !ALLOWED_QUALITY.has(args.quality)) {
      throw new Error(`Invalid quality. Allowed: ${Array.from(ALLOWED_QUALITY).join(', ')}`);
    }
    out.quality = args.quality;
  }
  if (args.n !== undefined) {
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      throw new Error('`n` must be an integer between 1 and 4');
    }
    out.n = n;
  }
  if (args.background !== undefined) {
    if (typeof args.background !== 'string' || !ALLOWED_BACKGROUND.has(args.background)) {
      throw new Error(`Invalid background. Allowed: ${Array.from(ALLOWED_BACKGROUND).join(', ')}`);
    }
    out.background = args.background;
  }
  if (args.output_format !== undefined) {
    if (typeof args.output_format !== 'string' || !ALLOWED_OUTPUT_FORMAT.has(args.output_format)) {
      throw new Error(
        `Invalid output_format. Allowed: ${Array.from(ALLOWED_OUTPUT_FORMAT).join(', ')}`
      );
    }
    out.output_format = args.output_format;
  }
  if (args.filename_hint !== undefined) {
    if (typeof args.filename_hint !== 'string') {
      throw new Error('`filename_hint` must be a string');
    }
    out.filename_hint = args.filename_hint;
  }

  return out;
}

async function callImageApi(args: GenerateImageArgs, apiKey: string): Promise<OpenAIImageResponse> {
  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    prompt: args.prompt,
    n: args.n ?? 1,
  };
  if (args.size) body.size = args.size;
  if (args.quality) body.quality = args.quality;
  if (args.background) body.background = args.background;
  if (args.output_format) body.output_format = args.output_format;

  const url = `${DEFAULT_BASE_URL}/v1/images/generations`;

  writeMCPLog(
    `[image-gen] POST ${url} model=${DEFAULT_MODEL} prompt="${args.prompt.slice(0, 80)}"`
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: OpenAIImageResponse;
  try {
    json = JSON.parse(text) as OpenAIImageResponse;
  } catch {
    throw new Error(`Non-JSON response from API (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const apiMsg = json.error?.message || text.slice(0, 300);
    throw new Error(`OpenAI image API failed (HTTP ${res.status}): ${apiMsg}`);
  }
  return json;
}

async function saveImages(
  response: OpenAIImageResponse,
  args: GenerateImageArgs
): Promise<Array<{ absPath: string; relPath: string }>> {
  const data = response.data || [];
  if (data.length === 0) {
    throw new Error('API returned empty data array');
  }

  const dir = await ensureImagesDir();
  const ext = args.output_format || 'png';
  const slug = slugify(args.filename_hint || args.prompt);
  const ts = timestamp();

  const saved: Array<{ absPath: string; relPath: string }> = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const suffix = data.length > 1 ? `-${i + 1}` : '';
    const filename = `${ts}-${slug}${suffix}.${ext}`;
    const absPath = path.join(dir, filename);

    if (item.b64_json) {
      const buf = Buffer.from(item.b64_json, 'base64');
      await fs.writeFile(absPath, buf);
    } else if (item.url) {
      // Some providers may return a URL instead of b64. Download it.
      const r = await fetch(item.url);
      if (!r.ok) throw new Error(`Failed to download image from URL: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.writeFile(absPath, buf);
    } else {
      throw new Error(`Image ${i + 1} has neither b64_json nor url`);
    }

    saved.push({ absPath, relPath: path.relative(WORKSPACE_DIR, absPath) });
  }

  return saved;
}

const server = new Server(
  { name: 'image-gen-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_image',
      description:
        `Generate one or more images from a text prompt using the ${DEFAULT_MODEL} model. ` +
        'Images are saved to <workspace>/images/ and returned as workspace-relative paths so the chat can preview them. ' +
        'Use this when the user asks to draw, illustrate, create a picture, or generate visual content.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'Detailed description of the image to generate. Be specific about subject, style, lighting, composition.',
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1024x1536', '1536x1024', 'auto'],
            description: 'Image dimensions. Default 1024x1024.',
          },
          quality: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'auto'],
            description: 'Generation quality. Higher = better detail, slower, more expensive.',
          },
          n: {
            type: 'number',
            description: 'Number of images to generate (1-4). Default 1.',
          },
          background: {
            type: 'string',
            enum: ['transparent', 'opaque', 'auto'],
            description: 'Background style. Use transparent for logo/icon use cases.',
          },
          output_format: {
            type: 'string',
            enum: ['png', 'jpeg', 'webp'],
            description: 'File format. Default png.',
          },
          filename_hint: {
            type: 'string',
            description:
              'Short hint for the saved filename (e.g. "logo", "hero-banner"). Optional.',
          },
        },
        required: ['prompt'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'generate_image') {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      content: [
        {
          type: 'text',
          text: 'OPENAI_API_KEY is not set. Configure it in the MCP server environment to enable image generation.',
        },
      ],
      isError: true,
    };
  }

  try {
    const args = validateArgs(request.params.arguments);
    const response = await callImageApi(args, apiKey);
    const saved = await saveImages(response, args);

    const previews = saved.map((s) => `![generated](${s.relPath})`).join('\n');
    const pathsList = saved
      .map((s, i) => `${i + 1}. \`${s.relPath}\` (abs: \`${s.absPath}\`)`)
      .join('\n');
    const revised = response.data?.[0]?.revised_prompt;

    const text =
      `Generated ${saved.length} image(s) with ${DEFAULT_MODEL}:\n` +
      `${pathsList}\n\n` +
      (revised ? `Revised prompt used by model: ${revised}\n\n` : '') +
      previews;

    writeMCPLog(`[image-gen] OK — saved ${saved.length} file(s)`);

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeMCPLog(`[image-gen] FAIL — ${msg}`);
    return { content: [{ type: 'text', text: `Image generation failed: ${msg}` }], isError: true };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  writeMCPLog('='.repeat(60));
  writeMCPLog(`Image Generation MCP Server v1.0.0 (model=${DEFAULT_MODEL})`);
  writeMCPLog(`Workspace: ${WORKSPACE_DIR}`);
  writeMCPLog(`Base URL: ${DEFAULT_BASE_URL}`);
  writeMCPLog(`API key: ${process.env.OPENAI_API_KEY ? 'set' : 'NOT SET'}`);
  writeMCPLog('Tool: generate_image');
  writeMCPLog('='.repeat(60));
}

main().catch((error) => {
  writeMCPLog('Failed to start Image Generation MCP server:', error);
  process.exit(1);
});
