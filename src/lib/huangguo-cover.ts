import { createDecipheriv } from 'node:crypto';

function imageType(bytes: Buffer): string | null {
  const hex = bytes.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('52494646') && bytes.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  if (
    bytes
      .subarray(0, 6)
      .toString()
      .match(/^GIF8[79]a$/)
  )
    return 'image/gif';
  return null;
}

export function decodeHuangguoCover(input: Uint8Array) {
  let bytes = Buffer.from(input);
  let type = imageType(bytes);
  if (type) return { bytes, type };
  if (!bytes.length || bytes.length % 16) throw new Error('封面格式无效');
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from('f5d965df75336270'),
    Buffer.from('97b60394abc2fbe1'),
  );
  decipher.setAutoPadding(false);
  bytes = Buffer.concat([decipher.update(bytes), decipher.final()]);
  type = imageType(bytes);
  if (!type) throw new Error('封面解密失败');
  const padding = bytes[bytes.length - 1];
  if (
    padding > 0 &&
    padding <= 16 &&
    bytes.subarray(-padding).every((value) => value === padding)
  )
    bytes = bytes.subarray(0, -padding);
  if (type === 'image/jpeg') {
    const end = bytes.lastIndexOf(Buffer.from('ffd9', 'hex'));
    if (end !== -1) bytes = bytes.subarray(0, end + 2);
  } else if (type === 'image/png') {
    const end = bytes.lastIndexOf(Buffer.from('49454e44ae426082', 'hex'));
    if (end !== -1) bytes = bytes.subarray(0, end + 8);
  }
  return { bytes, type };
}
