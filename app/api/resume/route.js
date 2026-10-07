import { readResume, MAX_BYTES } from '@/lib/resume';
import { saveResume, resumeMeta } from '@/lib/service';
import { handler, json } from '@/lib/http';

const refuse = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

// multipart upload: field "file". Everything that is not a real resume is refused with a reason.
export const POST = handler(async (req, { user }) => {
  if (Number(req.headers.get('content-length')) > MAX_BYTES + 65536) throw refuse(`That file is too large. Resumes must be under ${MAX_BYTES / 1048576} MB.`, 413);
  let form;
  try { form = await req.formData(); } catch { throw refuse('Upload your resume as a file (PDF, DOCX or TXT).'); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw refuse('Choose a resume file to upload (PDF, DOCX or TXT).');
  if (file.size > MAX_BYTES) throw refuse(`That file is ${(file.size / 1048576).toFixed(1)} MB. Resumes must be under ${MAX_BYTES / 1048576} MB.`, 413);
  const { text, profile } = await readResume(Buffer.from(await file.arrayBuffer()), file.name);
  const resume = { name: String(file.name || 'resume').replace(/[^\w.\- ()]+/g, '_').slice(0, 100), size: file.size, at: Date.now(), text, ...profile };
  await saveResume(user.uid, resume);
  return json({ resume: resumeMeta(resume) });
}, { limit: ['resume', 10, 60 * 60_000] });

export const DELETE = handler(async (_req, { user }) => { await saveResume(user.uid, null); return json({ ok: true }); });
