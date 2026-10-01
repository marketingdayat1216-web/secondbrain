// Otak AI.
// - "Cepat" = Workers AI (gratis, dipakai untuk hampir semua hal).
// - "Pintar" = Claude Opus lewat Anthropic API, hanya untuk pekerjaan berat
//   (menulis konten, bedah iklan, membaca foto). Tanpa ANTHROPIC_API_KEY atau
//   saat gagal, otomatis kembali ke Workers AI.

import Anthropic from '@anthropic-ai/sdk';
import { safeJson, b64 } from './util.js';
import { setSetting } from './db.js';

export const DEFAULT_FAST = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const DEFAULT_SMART = 'claude-opus-5-5';
export const DEFAULT_VISION = '@cf/llava-hf/llava-1.5-7b-hf';

export function fastModel(env) {
  return env.MODEL_FAST || DEFAULT_FAST;
}

export function smartModel(env) {
  return env.MODEL_SMART || DEFAULT_SMART;
}

export function hasSmart(env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

// Nama pendek untuk ditampilkan di Kantor 3D / log.
export function modelLabel(id = '') {
  const s = String(id).toLowerCase();
  if (s.includes('opus')) return 'Claude Opus';
  if (s.includes('sonnet')) return 'Claude Sonnet';
  if (s.includes('haiku')) return 'Claude Haiku';
  if (s.includes('gemma')) return 'Gemma';
  if (s.includes('llama')) return 'Llama';
  if (s.includes('qwen')) return 'Qwen';
  if (s.includes('mistral')) return 'Mistral';
  if (s.includes('llava')) return 'LLaVA';
  return id.split('/').pop() || 'AI';
}

function toWorkersMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    const content = typeof m.content === 'string'
      ? m.content
      : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    out.push({ role: m.role, content });
  }
  return out;
}

// Workers AI. messages: [{role, content}] (boleh ada role 'system').
export async function fastChat(env, messages, { maxTokens = 1500, temperature = 0.4, system } = {}) {
  const model = fastModel(env);
  const res = await env.AI.run(model, {
    messages: toWorkersMessages(system, messages),
    max_tokens: maxTokens,
    temperature,
  });
  let text = res?.response ?? res?.result?.response ?? '';
  if (typeof text !== 'string') text = JSON.stringify(text);
  return { text: text.trim(), model };
}

// Minta JSON dari Workers AI; satu kali coba ulang kalau balasan tidak bisa diurai.
export async function fastJson(env, messages, opts = {}) {
  const first = await fastChat(env, messages, { temperature: 0.2, ...opts });
  let data = safeJson(first.text);
  if (data) return { data, model: first.model, raw: first.text };
  const retry = await fastChat(
    env,
    [...messages, { role: 'assistant', content: first.text.slice(0, 2000) }, { role: 'user', content: 'Balasanmu bukan JSON valid. Ulangi dan balas HANYA dengan JSON valid sesuai format, tanpa teks lain.' }],
    { temperature: 0.1, ...opts },
  );
  data = safeJson(retry.text);
  return { data, model: retry.model, raw: retry.text };
}

let client;
function anthropic(env) {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const OPUS_REQUIRED = 'Analisa memakai Claude Opus: isi GitHub Secret ANTHROPIC_API_KEY, lalu jalankan ulang workflow Deploy.';

// Claude Opus untuk pekerjaan berat. messages memakai format Anthropic (content boleh berisi blok image).
// fallback: false = jangan pernah pindah ke Workers AI; lempar error kalau Opus tidak bisa dipakai.
export async function smartChat(env, { system, messages, maxTokens = 8000, effort = 'medium', fallback = true }) {
  if (!hasSmart(env) && !fallback) throw new Error(OPUS_REQUIRED);
  if (hasSmart(env)) {
    try {
      const resp = await anthropic(env).beta.messages.create({
        model: smartModel(env),
        max_tokens: maxTokens,
        system,
        messages,
        output_config: { effort },
        // Kalau Opus menolak karena filter keamanan, server mencoba model cadangan Anthropic.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      if (resp.stop_reason === 'refusal') throw new Error('Claude menolak permintaan ini');
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (!text) throw new Error('Balasan Claude kosong');
      await setSetting(env, 'ai_smart_status', { ok: true, at: Date.now(), model: resp.model }).catch(() => {});
      return { text, model: resp.model || smartModel(env), smart: true };
    } catch (e) {
      console.error('smartChat gagal:', e?.status, e?.message);
      await setSetting(env, 'ai_smart_status', { ok: false, at: Date.now(), error: String(e?.message || e).slice(0, 300) }).catch(() => {});
      if (!fallback) throw new Error(`Claude Opus gagal: ${String(e?.message || e).slice(0, 200)}`);
    }
  }
  const r = await fastChat(env, messages, { system, maxTokens: Math.min(maxTokens, 3500), temperature: 0.6 });
  return { ...r, smart: false };
}

// Claude Opus yang membalas JSON (analisa terstruktur). Tidak pernah memakai Workers AI.
export async function smartJson(env, { system, messages, maxTokens = 4000, effort = 'medium' }) {
  const first = await smartChat(env, { system, messages, maxTokens, effort, fallback: false });
  let data = safeJson(first.text);
  if (data) return { data, model: first.model };
  const retry = await smartChat(env, {
    system,
    messages: [...messages, { role: 'assistant', content: first.text.slice(0, 4000) }, { role: 'user', content: 'Balas ulang HANYA dengan JSON valid sesuai format, tanpa teks lain.' }],
    maxTokens,
    effort: 'low',
    fallback: false,
  });
  data = safeJson(retry.text);
  if (!data) throw new Error('Claude Opus tidak membalas JSON yang valid');
  return { data, model: retry.model };
}

// Teks dari voice note (Workers AI Whisper).
export async function transcribe(env, bytes) {
  try {
    const res = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64(bytes), language: 'id' });
    if (res?.text) return res.text.trim();
  } catch (e) {
    console.error('whisper turbo', e?.message);
  }
  const res = await env.AI.run('@cf/openai/whisper', { audio: Array.from(bytes) });
  return (res?.text || '').trim();
}

// Deskripsi/isi gambar. Pakai Claude kalau ada (jauh lebih akurat membaca teks), kalau tidak LLaVA.
export async function describeImage(env, bytes, mime = 'image/jpeg', prompt = '') {
  const instruction = `Jelaskan isi gambar ini dalam Bahasa Indonesia. Salin semua teks penting yang terlihat (angka, tanggal, nama, harga). ${prompt ? 'Konteks dari pengguna: ' + prompt : ''}`.trim();
  if (hasSmart(env) && bytes.length < 4_500_000) {
    const r = await smartChat(env, {
      system: 'Kamu membaca gambar untuk asisten pribadi. Ringkas dan faktual.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64(bytes) } },
          { type: 'text', text: instruction },
        ],
      }],
      maxTokens: 1500,
      effort: 'low',
    });
    if (r.smart) return { text: r.text, model: r.model };
  }
  const model = env.MODEL_VISION || DEFAULT_VISION;
  const res = await env.AI.run(model, { image: Array.from(bytes), prompt: instruction, max_tokens: 600 });
  return { text: (res?.description || res?.response || '').trim(), model };
}
