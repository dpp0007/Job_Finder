// Reads an uploaded resume file (PDF, DOCX or plain text) into clean text, and refuses anything else with a plain reason.
// Server only: uses node:zlib and the pdf reader.
import { inflateRawSync } from 'node:zlib';
import { buildProfile, checkResumeText } from './profile.js';

export const MAX_BYTES = 4 * 1024 * 1024;   // hosts like Vercel cap request bodies near 4.5 MB
const MAX_TEXT = 30000;

const bad = message => Object.assign(new Error(message), { status: 400 });
const ext = name => (String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';

// What the bytes really are, whatever the file name claims.
function sniff(b) {
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf';
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (at(0, 0xd0, 0xcf, 0x11, 0xe0)) return 'doc';
  if (at(0, 0x89, 0x50, 0x4e, 0x47) || at(0, 0xff, 0xd8, 0xff) || at(0, 0x47, 0x49, 0x46, 0x38) || (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))) return 'image';
  if (at(0, 0x4d, 0x5a) || at(0, 0x7f, 0x45, 0x4c, 0x46)) return 'program';
  if (b.subarray(0, 4096).includes(0)) return 'binary';
  return 'text';
}

// A .docx is a zip; word/document.xml holds the text. Reads just that entry.
function docxText(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad('This file is damaged. Save the resume again as a DOCX or PDF and retry.');
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && p + 46 <= b.length && b.readUInt32LE(p) === 0x02014b50; k++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nlen = b.readUInt16LE(p + 28), elen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    if (b.toString('utf8', p + 46, p + 46 + nlen) === 'word/document.xml') {
      const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
      const raw = b.subarray(start, start + csize);
      const xml = (method === 8 ? inflateRawSync(raw, { maxOutputLength: 25 * 1024 * 1024 }) : raw).toString('utf8');
      return xml.replace(/<\/w:p>|<w:br[^>]*\/>|<w:cr\/>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

async function pdfText(b) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  let pdf;
  try { pdf = await getDocumentProxy(new Uint8Array(b)); }
  catch { throw bad('Couldn’t open this PDF. It may be password-protected or damaged. Export it again without a password and retry.'); }
  if (pdf.numPages > 8) throw bad(`This PDF has ${pdf.numPages} pages. A resume is one to three pages: upload your resume, not a longer document.`);
  // a crafted PDF must not be able to hold the server: give the reader a fixed time
  const { text } = await Promise.race([extractText(pdf, { mergePages: true }), new Promise((_, no) => setTimeout(() => no(bad('This PDF took too long to read. Export it again as a simple PDF, or upload a DOCX.')), 15000))]);
  return text;
}

const tidy = t => t.replace(/\r/g, '').replace(/[   ]/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();

// buffer + file name in, { text, profile, words } out; throws an Error with status 400 and a message meant for the person.
export async function readResume(buffer, name = '') {
  if (!buffer?.length) throw bad('That file is empty.');
  if (buffer.length > MAX_BYTES) throw bad(`That file is ${(buffer.length / 1048576).toFixed(1)} MB. Resumes must be under ${MAX_BYTES / 1048576} MB.`);
  const kind = sniff(buffer), e = ext(name);
  if (kind === 'image') throw bad('That’s an image, not a document. Upload your resume as a PDF, DOCX or TXT file (a photo of a page can’t be read).');
  if (kind === 'doc') throw bad('Old .doc files aren’t supported. Open it and save as DOCX or PDF, then upload that.');
  if (kind === 'program' || kind === 'binary') throw bad('That file isn’t a resume. Upload a PDF, DOCX or TXT file.');
  if (e && !['pdf', 'docx', 'txt', 'md', 'text'].includes(e)) throw bad(`A “.${e}” file can’t be used as a resume. Upload a PDF, DOCX or TXT file.`);
  let raw;
  if (kind === 'pdf') raw = await pdfText(buffer);
  else if (kind === 'zip') {
    raw = (() => { try { return docxText(buffer); } catch (err) { if (err.status) throw err; return null; } })();
    if (raw == null) throw bad('That’s a compressed archive, not a document. Upload your resume as a PDF, DOCX or TXT file.');
  } else {
    if (/^\s*[<{]/.test(buffer.toString('utf8', 0, 200)) || /^%!PS|^\{\\rtf/.test(buffer.toString('latin1', 0, 8))) throw bad('That file looks like code or markup, not a resume. Upload a PDF, DOCX or TXT file.');
    raw = buffer.toString('utf8');
  }
  const text = tidy(raw).slice(0, MAX_TEXT);
  if (!text) throw bad(kind === 'pdf' ? 'This PDF has no selectable text (it is probably a scan or an image). Export it from Word or Google Docs as a PDF, or upload a DOCX.' : 'No text could be read from this file.');
  const verdict = checkResumeText(text);
  if (!verdict.ok) throw bad(verdict.reason);
  return { text, profile: buildProfile(text), words: verdict.words };
}
