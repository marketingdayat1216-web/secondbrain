// Ringkasan profil dari jawaban wawancara /profil (dipakai di semua prompt AI).

import { fastChat } from './ai.js';
import { getProfile, setProfileSummary, PROFILE_QUESTIONS } from './store.js';
import { remember } from './memory.js';

export async function summarizeProfile(env) {
  const p = await getProfile(env);
  const qa = PROFILE_QUESTIONS.filter((q) => p.answers[q.key]).map((q) => `T: ${q.q}\nJ: ${p.answers[q.key]}`).join('\n\n');
  if (!qa) {
    await setProfileSummary(env, '');
    return '';
  }
  const r = await fastChat(env, [{
    role: 'user',
    content: `Ringkas jawaban wawancara berikut menjadi profil padat (maks 120 kata) tentang ${env.OWNER_NAME || 'pemilik'}: siapa dia, bisnisnya, pelanggan, target, kompetitor, ritme kerja, dan gaya komunikasi yang disukai. Tulis sebagai orang ketiga, poin-poin singkat, Bahasa Indonesia. Jangan menambah info yang tidak ada.\n\n${qa}`,
  }], { maxTokens: 500, temperature: 0.2 });
  await setProfileSummary(env, r.text);
  return r.text;
}

// Jawaban penting juga disimpan sebagai memori supaya muncul di pencarian makna.
export async function rememberAnswer(env, key, answer) {
  const label = {
    bisnis: 'Bisnis/pekerjaan',
    pelanggan: 'Pelanggan ideal',
    target: 'Target 3 bulan',
    kompetitor: 'Kompetitor yang dipantau',
    ritme: 'Ritme kerja',
    gaya: 'Gaya komunikasi yang disukai',
  }[key];
  if (!label || !answer) return;
  await remember(env, `${label} ${env.OWNER_NAME || 'pemilik'}: ${answer}`, { category: key === 'gaya' || key === 'ritme' ? 'preferensi' : key === 'target' ? 'target' : 'bisnis', source: 'profil' });
}
