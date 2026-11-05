'use strict';
// Fake credentials for the redaction tests, assembled at runtime from parts so no
// token-shaped literal ever sits in the repo (GitHub push protection and other
// secret scanners flag those even when they are fake). None of these are real.

const j = (...p) => p.join('');
const body = (n) => 'FAKE0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'.repeat(3).slice(0, n);

const SECRETS = {
  anthropic: j('sk', '-ant-', 'api03-', body(40), '-xyz'),
  openai: j('sk', '-proj-', body(26)),
  github: j('gh', 'p_', body(36)),
  githubPat: j('github', '_pat_', '11', body(20), '_', body(59)),
  aws: j('AK', 'IA', 'FAKE0123456789AB'),
  google: j('AI', 'za', body(35)),
  stripe: j('sk', '_live_', body(24)),
  slack: j('xo', 'xb-', '1234567890-', body(12)),
  npm: j('np', 'm_', body(36)),
  jwt: j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', body(17)),
  hf: j('h', 'f_', body(34)),
};

const PASSWORDS = {
  url: j('Fake', 'Passw0rd', '99'),
  commit: j('Hun', 'ter2', 'Hun', 'ter2xx'),
  short: j('hun', 'ter2', 'hun', 'ter2'),
  urlInline: j('Sup3r', 'S3cret'),
};

// The transcript the redaction tests ingest, one JSON object per line.
function secretsTranscript() {
  const at = (s) => `2026-10-03T12:0${s}:00.000Z`;
  const cwd = 'C:\\work\\api-server';
  const user = (s, content) => ({ type: 'user', timestamp: at(s), cwd, message: { role: 'user', content } });
  return [
    user(0, `use ANTHROPIC_API_KEY=${SECRETS.anthropic} for the client`),
    user(1, `the github token is ${SECRETS.github} rotate it`),
    user(2, `connect to postgres://admin:${PASSWORDS.url}@db.internal:5432/app`),
    { type: 'ai-title', aiTitle: `Configure AWS key ${SECRETS.aws}`, timestamp: '2026-10-03T12:02:05.000Z' },
    user(3, [{ type: 'tool_result', tool_use_id: 't1', content: `[main abc1234] chore: set password=${PASSWORDS.commit} in env example` }]),
    user(4, 'keep the token budget at 6000 and fix the auth middleware'),
  ].map((o) => JSON.stringify(o)).join('\n') + '\n';
}

module.exports = { SECRETS, PASSWORDS, secretsTranscript };
